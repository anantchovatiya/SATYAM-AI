/**
 * /api/webhook/whatsapp
 *
 * GET  — Meta webhook verification handshake
 * POST — Incoming WhatsApp message pipeline:
 *
 *   1. Parse & validate Meta payload
 *   2. Deduplicate (idempotent on waMessageId)
 *   3. Upsert lead by phone number → MongoDB leads collection
 *   4. Save raw message → whatsapp_messages collection
 *   5. Run AI analysis (dual-window prompt: leadScore from last 5 messages via Gemini when configured)
 *   6. Update lead status + score in MongoDB; after outbound replies, refresh score from Gemini on last 5
 *   7a. needsHuman  → flag lead, log HANDOVER event, stop
 *   7b. autoReply off → log SKIPPED event, stop
 *   7c. autoReply on  → generate reply → send via WhatsApp Graph API
 *   8. Save outgoing message + log REPLIED event
 *   9. All events stored in webhook_logs collection
 *
 * Storage: MongoDB Atlas (not Supabase — project uses MongoDB throughout)
 */

import { NextRequest, NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { getDb }               from "@/lib/mongodb";
import { leadsCollection }     from "@/lib/models/lead";
import {
  getOrCreateSettings,
  findSettingsByPhoneNumberId,
  findSettingsByVerifyToken,
} from "@/lib/models/settings";
import { usersCollection } from "@/lib/models/user";
import { ensureTenantIndexes } from "@/lib/models/tenant-indexes";
import {
  webhookLogsCollection,
  waMessagesCollection,
  ensureIndexes,
  type WebhookEvent,
  type WebhookLog,
} from "@/lib/models/webhook-log";
import {
  parseWebhookPayload,
  resolveWhatsAppRuntimeConfig,
  sendTextMessage,
  markAsRead,
  type ParsedWaMessage,
  type WhatsAppRuntimeConfig,
} from "@/lib/whatsapp";
import { analyzeChat, generateReply } from "@/lib/ai";
import { clampAiInterestScore0to100 } from "@/lib/interest-score";
import { refreshLeadInterestScoreFromWaThread } from "@/lib/lead-interest-gemini";
import { syncAutoFollowupQueueFromLead } from "@/lib/auto-followup-queue";
import { getConversationStatus, shouldEscalateConversation } from "@/lib/conversation-status";
import { getQrSnapshot, sendQrTextMessage } from "@/lib/whatsapp-qr-connector";
import { getEffectiveKnowledge } from "@/lib/knowledge";
import {
  findLeadByCanonicalPhone,
  formatLeadPhoneFromRaw,
  canonicalWaContactKey,
  mongoMatchStoredWaFromForUser,
} from "@/lib/wa-phone";

// ── GET — Meta webhook verification ──────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  try {
    const db = await getDb();
    const matched = token ? await findSettingsByVerifyToken(db, token) : null;
    const envFallback = process.env.WHATSAPP_VERIFY_TOKEN ?? "satyam_ai_verify";
    const okToken =
      Boolean(token) &&
      (Boolean(matched?.whatsapp?.verifyToken && matched.whatsapp.verifyToken === token) ||
        token === envFallback);
    if (mode === "subscribe" && okToken && challenge) {
      console.log("[WhatsApp Webhook] Verification successful");
      return new NextResponse(challenge, { status: 200 });
    }
  } catch {
    const envFallback = process.env.WHATSAPP_VERIFY_TOKEN ?? "satyam_ai_verify";
    if (mode === "subscribe" && token === envFallback && challenge) {
      return new NextResponse(challenge, { status: 200 });
    }
  }

  console.warn("[WhatsApp Webhook] Verification failed", { mode, token });
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

function countWebhookIncomingMessages(body: unknown): number {
  try {
    const b = body as {
      entry?: { changes?: { value?: { messages?: unknown[] } }[] }[];
    };
    let n = 0;
    for (const e of b.entry ?? []) {
      for (const c of e.changes ?? []) {
        n += c.value?.messages?.length ?? 0;
      }
    }
    return n;
  } catch {
    return 0;
  }
}

async function resolveOwnerUserIdForInbound(db: Db, msg: ParsedWaMessage): Promise<ObjectId | null> {
  const doc = await findSettingsByPhoneNumberId(db, msg.phoneNumberId);
  if (doc?.userId) return doc.userId;
  if (
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_PHONE_NUMBER_ID === msg.phoneNumberId
  ) {
    const u = await usersCollection(db).findOne({});
    return u?._id ?? null;
  }
  return null;
}

// ── POST — incoming message pipeline ──────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startAt = Date.now();
  let rawBody: unknown;

  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messages = parseWebhookPayload(rawBody);

  if (messages.length === 0) {
    const rawCount = countWebhookIncomingMessages(rawBody);
    if (rawCount > 0) {
      console.warn(
        "[WhatsApp Webhook] Meta sent",
        rawCount,
        "message(s) but none were parsed (unsupported type or empty body). Check extractInboundTextFromWebhookMessage."
      );
    }
    return NextResponse.json({ ok: true, processed: 0 });
  }

  console.log("[WhatsApp Webhook] Parsed inbound count:", messages.length);

  const db = await getDb();
  await ensureIndexes(db).catch(() => {}); // best-effort index creation
  await ensureTenantIndexes(db).catch(() => {});

  const results = await Promise.allSettled(
    messages.map((msg) => processMessage(msg, db))
  );

  const processed = results.filter((r) => r.status === "fulfilled").length;
  const errors    = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => String(r.reason));

  return NextResponse.json({
    ok: true,
    processed,
    errors: errors.length ? errors : undefined,
    durationMs: Date.now() - startAt,
  });
}

// ── Pipeline for a single message ─────────────────────────────────────────────

async function processMessage(msg: ParsedWaMessage, db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never) {
  const logsCol     = webhookLogsCollection(db);
  const messagesCol = waMessagesCollection(db);
  const leadsCol    = leadsCollection(db);

  const ownerUserId = await resolveOwnerUserIdForInbound(db, msg);
  if (!ownerUserId) {
    console.warn("[Webhook] Unknown tenant for phone_number_id", msg.phoneNumberId);
    return { skipped: true, reason: "unknown_tenant" };
  }
  const ownerHex = ownerUserId.toHexString();

  const events: WebhookEvent[] = [];
  function addEvent(type: WebhookEvent["type"], data?: Record<string, unknown>, durationMs?: number) {
    events.push({ type, timestamp: new Date(), data, durationMs });
  }

  // ── 1. Deduplicate ──────────────────────────────────────────────────────────
  const existing = await logsCol.findOne({ userId: ownerUserId, waMessageId: msg.waMessageId });
  if (existing) {
    console.log(`[Webhook] Duplicate message ${msg.waMessageId} — skipping`);
    return { skipped: true, reason: "duplicate" };
  }

  addEvent("received", {
    from:          msg.from,
    senderName:    msg.senderName,
    text:          msg.text,
    phoneNumberId: msg.phoneNumberId,
  });

  // ── 2. Upsert lead by phone ─────────────────────────────────────────────────
  const t2 = Date.now();
  const displayPhone = formatLeadPhoneFromRaw(msg.from);

  const existingLead = await findLeadByCanonicalPhone(leadsCol, ownerUserId, msg.from);
  let leadId: string;
  let leadName: string;
  const leadFilter = existingLead
    ? { _id: existingLead._id }
    : { userId: ownerUserId, phone: displayPhone };

  if (existingLead) {
    leadId   = existingLead._id!.toHexString();
    leadName = existingLead.name;
    await leadsCol.updateOne(
      { _id: existingLead._id },
      {
        $set: {
          lastMessage: msg.text,
          lastFollowup: "Just now",
          lastInboundAt: msg.timestamp,
          updatedAt: new Date(),
        },
      }
    );
    addEvent("lead_updated", { leadId, leadName }, Date.now() - t2);
  } else {
    // Auto-create lead from WhatsApp contact
    const now = new Date();
    const result = await leadsCol.insertOne({
      userId:        ownerUserId,
      name:          msg.senderName,
      phone:         displayPhone,
      source:        "WhatsApp",
      status:        "New",
      conversationStatus: "new_inquiry",
      lastMessage:   msg.text,
      interestScore: 10,
      assignedTo:    "Unassigned",
      lastFollowup:  "Just now",
      lastInboundAt: msg.timestamp,
      createdAt:     now,
      updatedAt:     now,
    });
    leadId   = result.insertedId.toHexString();
    leadName = msg.senderName;
    addEvent("lead_created", { leadId, leadName, phone: displayPhone }, Date.now() - t2);
  }

  // ── 3. Claim inbound message atomically (idempotency lock) ──────────────────
  const inboundClaim = await messagesCol.updateOne(
    { userId: ownerUserId, waMessageId: msg.waMessageId },
    {
      $setOnInsert: {
        userId:        ownerUserId,
        waMessageId:   msg.waMessageId,
        from:          msg.from,
        senderName:    msg.senderName,
        text:          msg.text,
        timestamp:     msg.timestamp,
        direction:     "in",
        phoneNumberId: msg.phoneNumberId,
      },
    },
    { upsert: true }
  ).catch(() => null);
  if (!inboundClaim || inboundClaim.upsertedCount === 0) {
    console.log(`[Webhook] Message ${msg.waMessageId} already claimed — skipping AI reply generation`);
    return { skipped: true, reason: "already_claimed" };
  }

  // ── 4. Load settings ────────────────────────────────────────────────────────
  const settings = await getOrCreateSettings(db, ownerUserId);
  const waConfig: WhatsAppRuntimeConfig | undefined =
    resolveWhatsAppRuntimeConfig(settings);
  const qrConnected = getQrSnapshot(ownerHex).state === "connected";

  if (existingLead?.needsHuman) {
    addEvent("reply_skipped", { reason: "human handover active; waiting for team reply" });
    await leadsCol.updateOne(
      leadFilter,
      {
        $set: {
          needsHuman: true,
          conversationStatus: "awaiting_team_reply",
          updatedAt: new Date(),
        },
      }
    ).catch(() => {});
    const leadHandoverEarly = await leadsCol.findOne(leadFilter);
    if (leadHandoverEarly) {
      await syncAutoFollowupQueueFromLead(db, ownerUserId, leadHandoverEarly, settings).catch(() => {});
    }
    await refreshLeadInterestScoreFromWaThread(db, ownerUserId, msg.from, displayPhone).catch(() => {});
    await persistLog({ userId: ownerUserId, logsCol, msg, leadId, leadName, events, status: "handover" });
    return { leadId, status: "handover" };
  }

  if (qrConnected) {
    addEvent("reply_skipped", { reason: "QR auto-reply active; skipping webhook auto-reply to avoid duplicates" });
    const leadQrSkip = await leadsCol.findOne(leadFilter);
    if (leadQrSkip) {
      await syncAutoFollowupQueueFromLead(db, ownerUserId, leadQrSkip, settings).catch(() => {});
    }
    await persistLog({ userId: ownerUserId, logsCol, msg, leadId, leadName, events, status: "skipped" });
    return { leadId, status: "skipped" };
  }

  // Mark as read (non-blocking)
  markAsRead(msg.waMessageId, waConfig).catch(() => {});

  // ── 5. Fetch recent conversation for context ────────────────────────────────
  const recentMessages = await messagesCol
    .find(
      mongoMatchStoredWaFromForUser(
        ownerUserId,
        canonicalWaContactKey(msg.from) || String(msg.from)
      )
    )
    .sort({ timestamp: -1 })
    .limit(20)
    .toArray();

  const contextMessages = recentMessages
    .reverse()
    .map((m) => ({ text: m.text, direction: m.direction, timestamp: m.timestamp.toISOString() }));

  // ── 6. AI analysis ──────────────────────────────────────────────────────────
  const t6 = Date.now();
  const analysis = await analyzeChat(contextMessages, settings.humanHandoverKeywords);
  const shouldEscalate = shouldEscalateConversation({
    latestText: msg.text,
    keywords: settings.humanHandoverKeywords,
  });

  const interestScore = clampAiInterestScore0to100(analysis.leadScore);

  addEvent("analyzed", {
    language:   analysis.language,
    sentiment:  analysis.sentiment,
    leadScore:  analysis.leadScore,
    interestScore,
    stage:      analysis.stage,
    needsHuman: analysis.needsHuman,
    confidence: analysis.confidence,
    engine:     analysis.engine,
  }, Date.now() - t6);

  // ── 7. Update lead score + status ────────────────────────────────────────────
  const newStatus =
    interestScore >= 75 ? "Hot" :
    interestScore >= 35 ? "New" : "Silent";
  const conversationStatus = getConversationStatus({
    lastInboundAt: msg.timestamp,
    lastOutboundAt: existingLead?.lastOutboundAt,
    needsHuman: shouldEscalate,
  });

  await leadsCol.updateOne(
    leadFilter,
    {
      $set: {
        interestScore,
        status: newStatus,
        preferredLanguage: analysis.language,
        needsHuman: shouldEscalate,
        conversationStatus,
        updatedAt: new Date(),
      },
    }
  ).catch(() => {});

  const leadAfterScore = await leadsCol.findOne(leadFilter);
  if (leadAfterScore) {
    await syncAutoFollowupQueueFromLead(db, ownerUserId, leadAfterScore, settings).catch(() => {});
  }

  // ── 8. Handover check ────────────────────────────────────────────────────────
  if (shouldEscalate) {
    addEvent("handover_flagged", {
      reason: `Handover keywords or anger/frustration pattern in the latest message`,
      leadId,
      leadName,
    });

    // Mark lead as needing human
    await leadsCol.updateOne(
      leadFilter,
      {
        $set: {
          status: "New",
          needsHuman: true,
          conversationStatus: "escalated",
          updatedAt: new Date(),
        },
      }
    ).catch(() => {});

    await persistLog({ userId: ownerUserId, logsCol, msg, leadId, leadName, events, status: "handover" });
    return { leadId, status: "handover" };
  }

  // ── 9. Auto-reply gate ───────────────────────────────────────────────────────
  if (!settings.autoReply) {
    addEvent("reply_skipped", { reason: "autoReply is disabled in settings" });
    await persistLog({ userId: ownerUserId, logsCol, msg, leadId, leadName, events, status: "skipped" });
    return { leadId, status: "skipped" };
  }

  const alreadyReplied = await messagesCol.findOne({
    ...mongoMatchStoredWaFromForUser(
      ownerUserId,
      canonicalWaContactKey(msg.from) || String(msg.from)
    ),
    direction: "out",
    timestamp: { $gte: msg.timestamp },
  });
  if (alreadyReplied) {
    addEvent("reply_skipped", { reason: "Outbound reply already exists for this inbound window" });
    await persistLog({ userId: ownerUserId, logsCol, msg, leadId, leadName, events, status: "skipped" });
    return { leadId, status: "skipped" };
  }

  // ── 10. Generate reply ───────────────────────────────────────────────────────
  const t10 = Date.now();
  const kb = getEffectiveKnowledge(settings);
  const replyResult = await generateReply(msg.text, {
    aiTone:          settings.aiTone,
    leadName,
    context:         contextMessages,
    handoverKeywords: settings.humanHandoverKeywords,
    companyInformation: kb.companyInformation,
    productCatalogueInformation: kb.productCatalogueInformation,
    catalogueLink: kb.catalogueLink,
    restrictToKnowledgeBase: kb.restrictToKnowledgeBase,
    autoShareCatalogue: settings.autoShareCatalogue,
  });
  const safeReplyText = coerceCompleteReply(replyResult.reply, leadName);
  if (safeReplyText !== replyResult.reply.trim().replace(/\s+/g, " ")) {
    console.warn("[auto-reply] replaced incomplete model response", {
      original: replyResult.reply,
      replaced: safeReplyText,
    });
  }

  // ── 11. Send via WhatsApp ────────────────────────────────────────────────────
  const cloudConfigured = Boolean(waConfig?.token && waConfig?.phoneNumberId);
  let sendResult: Awaited<ReturnType<typeof sendTextMessage>>;
  let sendChannel: "cloud" | "qr";

  if (cloudConfigured) {
    sendResult = await sendTextMessage(msg.from, safeReplyText, waConfig);
    sendChannel = "cloud";
    if ((!sendResult.ok || sendResult.mode === "dry-run") && qrConnected) {
      const qrSend = await sendQrTextMessage(ownerHex, msg.from, safeReplyText);
      if (qrSend.ok) {
        sendResult = { ok: true, messageId: qrSend.messageId, mode: "live" };
        sendChannel = "qr";
      }
    }
  } else if (qrConnected) {
    const qrSend = await sendQrTextMessage(ownerHex, msg.from, safeReplyText);
    if (qrSend.ok) {
      sendResult = { ok: true, messageId: qrSend.messageId, mode: "live" };
      sendChannel = "qr";
    } else {
      sendResult = await sendTextMessage(msg.from, safeReplyText, waConfig);
      sendChannel = "cloud";
    }
  } else {
    sendResult = await sendTextMessage(msg.from, replyResult.reply, waConfig);
    sendChannel = "cloud";
  }

  if ((!sendResult.ok || sendResult.mode === "dry-run") && !cloudConfigured && qrConnected) {
    addEvent("send_error", {
      error: "QR send failed and Cloud API is not configured.",
      mode: sendResult.mode,
      durationMs: Date.now() - t10,
    });
    await persistLog({ userId: ownerUserId, logsCol, msg, leadId, leadName, events, status: "error" });
    return { leadId, status: "send_error", error: "QR send failed and Cloud API is not configured." };
  }

  if (!sendResult.ok || sendResult.mode === "dry-run") {
    addEvent("send_error", {
      error:  sendResult.ok
        ? "Reply generated but not delivered (no live WhatsApp channel available)."
        : sendResult.error,
      mode:   sendResult.mode,
      durationMs: Date.now() - t10,
    });
    await persistLog({ userId: ownerUserId, logsCol, msg, leadId, leadName, events, status: "error" });
    return {
      leadId,
      status: "send_error",
      error: sendResult.ok
        ? "Reply generated but not delivered (no live WhatsApp channel available)."
        : sendResult.error,
    };
  }

  // ── 12. Save outgoing message ────────────────────────────────────────────────
  await messagesCol.updateOne(
    { userId: ownerUserId, waMessageId: sendResult.messageId },
    {
      $setOnInsert: {
        userId:        ownerUserId,
        waMessageId:   sendResult.messageId,
        from:          msg.from,
        senderName:    "SATYAM AI",
        text:          safeReplyText,
        timestamp:     new Date(),
        direction:     "out",
        phoneNumberId: msg.phoneNumberId,
      },
    },
    { upsert: true }
  ).catch(() => {});

  // Update lead's lastFollowup
    await leadsCol.updateOne(
      leadFilter,
      {
        $set: {
          lastFollowup: "Just now",
          lastOutboundAt: new Date(),
          needsHuman: false,
          conversationStatus: "awaiting_customer_reply",
          updatedAt: new Date(),
        },
      }
    ).catch(() => {});

  const leadAfterReply = await leadsCol.findOne(leadFilter);
  if (leadAfterReply) {
    await syncAutoFollowupQueueFromLead(db, ownerUserId, leadAfterReply, settings).catch(() => {});
  }

  await refreshLeadInterestScoreFromWaThread(
    db,
    ownerUserId,
    msg.from,
    displayPhone
  ).catch(() => {});

  addEvent("replied", {
    replyText:    safeReplyText,
    waMessageId:  sendResult.messageId,
    mode:         sendResult.mode,
    channel:      sendChannel,
    engine:       replyResult.engine,
    language:     replyResult.language,
    needsHuman:   replyResult.needsHuman,
    durationMs:   Date.now() - t10,
  });

  await persistLog({
    userId: ownerUserId,
    logsCol,
    msg,
    leadId,
    leadName,
    events,
    status: "processed",
    replyText: safeReplyText,
  });
  return { leadId, status: "replied", mode: sendResult.mode };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function persistLog({
  userId,
  logsCol,
  msg,
  leadId,
  leadName,
  events,
  status,
  replyText,
}: {
  userId:     ObjectId;
  logsCol:    ReturnType<typeof webhookLogsCollection>;
  msg:        ParsedWaMessage;
  leadId:     string;
  leadName:   string;
  events:     WebhookEvent[];
  status:     WebhookLog["status"];
  replyText?: string;
}) {
  const now = new Date();
  await logsCol.insertOne({
    userId,
    waMessageId: msg.waMessageId,
    from:        msg.from,
    senderName:  msg.senderName,
    messageText: msg.text,
    leadId,
    leadName,
    replyText,
    events,
    status,
    createdAt:   now,
    updatedAt:   now,
  }).catch((e) => console.error("[Webhook] Failed to persist log:", e));
}

function coerceCompleteReply(reply: string, leadName: string): string {
  const compact = reply.trim().replace(/\s+/g, " ");
  const fallback = `Thanks ${leadName}. Could you share a bit more detail so I can help you accurately?`;
  if (!compact || compact.length < 10) return fallback;

  // Strip the Details/Catalogue appendix before checking the core sentence
  const core = compact
    .split(/\s+Details:\s+/i)[0]
    .split(/\s+Catalogue:\s+/i)[0]
    .trim();

  // Strip trailing emoji/whitespace to inspect actual ending text
  const ending = core.replace(/[\s\p{Extended_Pictographic}\uFE0F\u200D]+$/gu, "").trim();
  if (!ending) return compact; // emoji-only core is unusual but not truncated

  // Only reject clear truncation signals:
  // 1. Ends with comma, colon, or semicolon → mid-sentence cut
  if (/[,:;]\s*$/.test(ending)) return fallback;
  // 2. Ends with a dangling apostrophe-word like "i'" or "that'" (broken contraction)
  if (/\b\w+'\s*$/.test(ending) && !/[.!?]/.test(ending.slice(-6))) return fallback;
  // 3. Extremely short core (< 8 chars) with no punctuation
  if (ending.length < 8 && !/[.!?]/.test(ending)) return fallback;

  return compact;
}
