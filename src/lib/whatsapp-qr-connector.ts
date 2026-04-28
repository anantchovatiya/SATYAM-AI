import path from "node:path";
import { rm, readFile } from "node:fs/promises";
import { Boom } from "@hapi/boom";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { leadsCollection } from "@/lib/models/lead";
import { isAutoReplyExcludedForQrInbound } from "@/lib/wa-qr-lid-mapping";
import { isAutoReplySuppressedAfterManualSend } from "@/lib/auto-reply-pause";
import { getOrCreateSettings } from "@/lib/models/settings";
import { waMessagesCollection } from "@/lib/models/webhook-log";
import { getConversationStatus, shouldEscalateConversation } from "@/lib/conversation-status";
import { analyzeChat, generateReply, type AnalyzeResult } from "@/lib/ai";
import { refreshLeadInterestScoreFromWaThread } from "@/lib/lead-interest-gemini";
import { syncAutoFollowupQueueFromLead } from "@/lib/auto-followup-queue";
import { getEffectiveKnowledge } from "@/lib/knowledge";
import { bestPhoneLocalPartFromBaileysKey } from "@/lib/wa-phone";
/** Gemini Vision on inbound images — costs API. Set `true` to re-enable business-card scan + Excel. */
const ENABLE_BUSINESS_CARD_IMAGE_SCAN = false;

export type QrConnectionState =
  | "idle"
  | "connecting"
  | "qr_ready"
  | "connected"
  | "error";

export interface QrSnapshot {
  state: QrConnectionState;
  qrDataUrl: string | null;
  connectedPhone: string | null;
  error: string | null;
  updatedAt: string;
}

type WaMessageContent =
  | { text: string; linkPreview?: null }
  | { document: Buffer; mimetype: string; fileName: string; caption?: string }
  | { image: Buffer; caption?: string };

type SocketType = {
  logout: () => Promise<void>;
  end: (err?: Error) => void;
  user?: { id?: string };
  sendMessage: (
    jid: string,
    content: WaMessageContent
  ) => Promise<{ key?: { id?: string } }>;
  ev: {
    on: (event: string, listener: (...args: unknown[]) => void) => void;
  };
};

const CATALOGUE_PDF = path.join(process.cwd(), "public", "AgriBird Brochure.pdf");

/** Directory for Baileys `useMultiFileAuthState` for a specific tenant. Returns `null` when the host cannot persist auth (e.g. Vercel). */
function getWaAuthDir(userIdHex: string): string | null {
  const disabled = process.env.WA_DISABLE_QR === "1" || process.env.WA_DISABLE_QR === "true";
  if (disabled) return null;
  const override = process.env.WA_AUTH_DIR?.trim();
  if (process.env.VERCEL === "1") return null;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return null;
  if (process.env.NETLIFY === "true") return null;
  if (override) return path.join(path.resolve(override), userIdHex);
  return path.join(process.cwd(), ".wa-auth", userIdHex);
}

const QR_UNSUPPORTED_HOST_ERROR =
  "WhatsApp QR (Baileys) needs a writable filesystem and is not supported on this host (for example Vercel serverless). Connect using the Meta Cloud API in the dashboard, or deploy the app on a VPS, Railway, or Fly.io where session files can be stored.";

interface QrConnectorStore {
  socket: SocketType | null;
  status: QrSnapshot;
  booting: Promise<QrSnapshot> | null;
  autoReplyTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempts: number;
  processedInboundIds: Set<string>;
  inflightInboundIds: Set<string>;
  recentReplyByPhone: Map<string, number>;
  /** Timestamp when the current QR session became connected — used to reject
   *  any history-replay messages Baileys emits before/during the handshake. */
  connectedAt: number | null;
}

const STORES_MAP_KEY = "__satyam_wa_qr_connector_map_v2__";

function makeEmptyQrStore(): QrConnectorStore {
  return {
    socket: null,
    booting: null,
    autoReplyTimer: null,
    reconnectTimer: null,
    reconnectAttempts: 0,
    processedInboundIds: new Set<string>(),
    inflightInboundIds: new Set<string>(),
    recentReplyByPhone: new Map<string, number>(),
    connectedAt: null,
    status: {
      state: "idle",
      qrDataUrl: null,
      connectedPhone: null,
      error: null,
      updatedAt: new Date().toISOString(),
    },
  };
}

function getStoreMap(): Map<string, QrConnectorStore> {
  const g = globalThis as Record<string, unknown>;
  if (!g[STORES_MAP_KEY]) {
    g[STORES_MAP_KEY] = new Map<string, QrConnectorStore>();
  }
  return g[STORES_MAP_KEY] as Map<string, QrConnectorStore>;
}

function getStore(userIdHex: string): QrConnectorStore {
  const map = getStoreMap();
  if (!map.has(userIdHex)) {
    map.set(userIdHex, makeEmptyQrStore());
  }
  return map.get(userIdHex)!;
}

function setStatus(userIdHex: string, partial: Partial<QrSnapshot>) {
  const store = getStore(userIdHex);
  store.status = {
    ...store.status,
    ...partial,
    updatedAt: new Date().toISOString(),
  };
}

function normalizePhone(raw: string): string {
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return raw;
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

function extractText(message: unknown): string {
  const m = message as {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
    videoMessage?: { caption?: string };
  };

  return (
    m?.conversation ??
    m?.extendedTextMessage?.text ??
    m?.imageMessage?.caption ??
    m?.videoMessage?.caption ??
    ""
  );
}

function isImageMessage(message: unknown): boolean {
  const m = message as { imageMessage?: unknown };
  return Boolean(m?.imageMessage);
}

/** Plain media without caption/text — still persist a thread line so inbox shows something. */
function inferMediaPlaceholder(message: unknown): string | null {
  const m = message as {
    imageMessage?: unknown;
    videoMessage?: unknown;
    documentMessage?: unknown;
    stickerMessage?: unknown;
    audioMessage?: unknown;
  };
  if (m?.imageMessage) return "[Image]";
  if (m?.videoMessage) return "[Video]";
  if (m?.documentMessage) return "[Document]";
  if (m?.stickerMessage) return "[Sticker]";
  if (m?.audioMessage) return "[Voice message]";
  return null;
}

async function processBusinessCardImage(args: {
  userId: ObjectId;
  userIdHex: string;
  msg: unknown;
  from: string;
  jid: string;
  senderName: string;
}): Promise<void> {
  if (!ENABLE_BUSINESS_CARD_IMAGE_SCAN) return;

  try {
    const { downloadMediaMessage } = await import("@whiskeysockets/baileys");

    const imageBuffer = (await downloadMediaMessage(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args.msg as any,
      "buffer",
      {}
    )) as Buffer;

    if (!imageBuffer || imageBuffer.length === 0) {
      console.warn("[business-card] Empty image buffer, skipping");
      return;
    }

    const raw = args.msg as { message?: { imageMessage?: { mimetype?: string } } };
    const mimeType =
      raw?.message?.imageMessage?.mimetype?.trim() || "image/jpeg";

    const { extractBusinessCardData, saveBusinessCardToExcel } = await import(
      "@/lib/business-card"
    );
    const data = await extractBusinessCardData(imageBuffer, mimeType);

    if (!data) {
      return;
    }

    await saveBusinessCardToExcel(data, normalizePhone(args.from), args.userIdHex);

    const name = data.name ? ` for ${data.name}` : "";
    const confirmText =
      `Got your business card${name}! 👍 I've saved the details.`;
    await sendQrTextMessage(args.userIdHex, args.jid, confirmText);

    await persistIncomingOrOutgoingMessage({
      userId: args.userId,
      waMessageId: `bc-confirm-${Date.now()}`,
      from: args.from,
      senderName: "SATYAM AI",
      text: confirmText,
      direction: "out",
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("[business-card] Failed to process image:", err);
  }
}

async function applyQrLeadScoreUpdate(
  leadsCol: ReturnType<typeof leadsCollection>,
  lead: { _id?: ObjectId } | null,
  _context: { text: string; direction: string; timestamp?: string }[],
  analysis: AnalyzeResult,
  shouldEscalate: boolean
) {
  if (!lead?._id) return;
  const $set: Record<string, unknown> = {
    preferredLanguage: analysis.language,
    updatedAt: new Date(),
  };
  if (shouldEscalate) {
    $set.needsHuman = true;
    $set.conversationStatus = "escalated";
  }
  await leadsCol.updateOne({ _id: lead._id }, { $set }).catch(() => {});
}

async function persistIncomingOrOutgoingMessage(args: {
  userId: ObjectId;
  waMessageId: string;
  from: string;
  remoteJid?: string;
  remoteJidAlt?: string;
  senderName?: string;
  text: string;
  direction: "in" | "out";
  timestamp?: Date;
}) {
  const db = await getDb();
  const messagesCol = waMessagesCollection(db);
  const leadsCol = leadsCollection(db);
  const now = args.timestamp ?? new Date();
  const normalizedPhone = normalizePhone(args.from);
  const uid = args.userId;

  if (args.direction === "out") {
    const duplicateWindowStart = new Date(now.getTime() - 20_000);
    const recentDuplicate = await messagesCol.findOne({
      userId: uid,
      from: args.from,
      direction: "out",
      text: args.text,
      timestamp: { $gte: duplicateWindowStart },
    });
    if (recentDuplicate) {
      return;
    }
  }

  await messagesCol
    .updateOne(
      { userId: uid, waMessageId: args.waMessageId },
      {
        $setOnInsert: {
          userId: uid,
          waMessageId: args.waMessageId,
          from: args.from,
          remoteJid: args.remoteJid,
          ...(args.remoteJidAlt ? { remoteJidAlt: args.remoteJidAlt } : {}),
          senderName: args.senderName ?? normalizedPhone,
          text: args.text,
          timestamp: now,
          direction: args.direction,
          phoneNumberId: "qr-linked",
        },
      },
      { upsert: true }
    )
    .catch(() => {});

  const initialInterest = args.direction === "in" ? 35 : 10;

  const lead = await leadsCol.findOne({ userId: uid, phone: normalizedPhone });
  if (!lead) {
    await leadsCol.insertOne({
      userId: uid,
      name: args.senderName ?? normalizedPhone,
      phone: normalizedPhone,
      source: "WhatsApp",
      status: "New",
      conversationStatus: args.direction === "in" ? "awaiting_team_reply" : "new_inquiry",
      lastMessage: args.text,
      interestScore: initialInterest,
      assignedTo: "Unassigned",
      lastFollowup: "Just now",
      lastInboundAt: args.direction === "in" ? now : undefined,
      lastOutboundAt: args.direction === "out" ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });
    const insertedLead = await leadsCol.findOne({ userId: uid, phone: normalizedPhone });
    if (insertedLead) {
      const st = await getOrCreateSettings(db, uid);
      await syncAutoFollowupQueueFromLead(db, uid, insertedLead, st).catch(() => {});
    }
    await refreshLeadInterestScoreFromWaThread(db, uid, args.from, normalizedPhone).catch(() => {});
    return;
  }

  await leadsCol.updateOne(
    { _id: lead._id },
    {
      $set: {
        lastMessage: args.text || lead.lastMessage,
        lastInboundAt: args.direction === "in" ? now : lead.lastInboundAt,
        lastOutboundAt: args.direction === "out" ? now : lead.lastOutboundAt,
        conversationStatus: getConversationStatus({
          lastInboundAt: args.direction === "in" ? now : lead.lastInboundAt,
          lastOutboundAt: args.direction === "out" ? now : lead.lastOutboundAt,
          needsHuman: lead.needsHuman,
        }),
        updatedAt: now,
      },
    }
  );
  const leadFresh = await leadsCol.findOne({ userId: uid, phone: normalizedPhone });
  if (leadFresh) {
    const st = await getOrCreateSettings(db, uid);
    await syncAutoFollowupQueueFromLead(db, uid, leadFresh, st).catch(() => {});
  }
  await refreshLeadInterestScoreFromWaThread(db, uid, args.from, normalizedPhone).catch(() => {});
}

function parseMessageTimestamp(input: unknown): Date | undefined {
  if (typeof input === "number") {
    return new Date(input * 1000);
  }
  if (typeof input === "bigint") {
    return new Date(Number(input) * 1000);
  }
  if (typeof input === "object" && input !== null) {
    const maybeLow = (input as { low?: unknown }).low;
    if (typeof maybeLow === "number") {
      return new Date(maybeLow * 1000);
    }
  }
  return undefined;
}

function isRecentInbound(ts?: Date): boolean {
  if (!ts) return true;
  const ageMs = Date.now() - ts.getTime();
  return ageMs >= 0 && ageMs <= 5 * 60 * 1000;
}

async function persistBaileysMessage(
  userId: ObjectId,
  msg: {
    key?: { id?: string; remoteJid?: string; remoteJidAlt?: string; fromMe?: boolean };
    message?: unknown;
    pushName?: string;
    messageTimestamp?: unknown;
  }
) {
  const phone = bestPhoneLocalPartFromBaileysKey(msg.key ?? {});
  if (!phone) return;

  let text = extractText(msg.message);
  if (!text) {
    text = inferMediaPlaceholder(msg.message) ?? "";
  }
  if (!text) return;

  const waMessageId = msg.key?.id ?? `qr-${Date.now()}-${Math.random()}`;
  const direction = msg.key?.fromMe ? "out" : "in";
  const timestamp = parseMessageTimestamp(msg.messageTimestamp);

  await persistIncomingOrOutgoingMessage({
    userId,
    waMessageId,
    from: phone,
    remoteJid: msg.key?.remoteJid,
    remoteJidAlt: msg.key?.remoteJidAlt,
    senderName: msg.pushName || phone,
    text,
    direction,
    timestamp,
  });
}

async function processQrInboundAutoReply(args: {
  userId: ObjectId;
  userIdHex: string;
  inboundMessageId?: string;
  jid: string;
  from: string;
  senderName: string;
  text: string;
}) {
  const store = getStore(args.userIdHex);
  const uid = args.userId;
  const inboundId = args.inboundMessageId ?? `${args.from}:${normalizeTextForKey(args.text)}`;
  if (store.processedInboundIds.has(inboundId) || store.inflightInboundIds.has(inboundId)) {
    return;
  }
  const now = Date.now();
  const lastReplyAt = store.recentReplyByPhone.get(args.from) ?? 0;
  // Defensive throttle to prevent duplicate reply bursts from repeated upsert events.
  if (now - lastReplyAt < 12_000) {
    return;
  }
  store.inflightInboundIds.add(inboundId);
  try {
    const db = await getDb();
    const settings = await getOrCreateSettings(db, uid);
    if (!settings.autoReply) {
      store.processedInboundIds.add(inboundId);
      return;
    }
    if (isAutoReplySuppressedAfterManualSend(settings)) {
      store.processedInboundIds.add(inboundId);
      return;
    }
    if (await isAutoReplyExcludedForQrInbound(settings, args.from, getWaAuthDir(args.userIdHex))) {
      store.processedInboundIds.add(inboundId);
      return;
    }

    const messagesCol = waMessagesCollection(db);
    const leadsCol = leadsCollection(db);
    // Burst guard: wait briefly so back-to-back user messages collapse into one latest reply.
    await sleep(1800);
    if (args.inboundMessageId) {
      const latestInbound = await messagesCol
        .find({ userId: uid, from: args.from, direction: "in" })
        .sort({ timestamp: -1 })
        .limit(1)
        .toArray();
      if (latestInbound[0] && latestInbound[0].waMessageId !== args.inboundMessageId) {
        store.processedInboundIds.add(inboundId);
        return;
      }
      if (latestInbound[0]) {
        const alreadyReplied = await messagesCol.findOne({
          userId: uid,
          from: args.from,
          direction: "out",
          timestamp: { $gte: latestInbound[0].timestamp },
        });
        if (alreadyReplied) {
          store.processedInboundIds.add(inboundId);
          return;
        }
      }
    }
    const normalizedPhone = normalizePhone(args.from);
    const lead = await leadsCol.findOne({ userId: uid, phone: normalizedPhone });
    if (lead?.needsHuman) {
      await leadsCol.updateOne(
        { _id: lead._id },
        {
          $set: {
            conversationStatus: "awaiting_team_reply",
            lastInboundAt: new Date(),
            updatedAt: new Date(),
          },
        }
      ).catch(() => {});
      store.processedInboundIds.add(inboundId);
      return;
    }

    const recent = await messagesCol
      .find({ userId: uid, from: args.from })
      .sort({ timestamp: -1 })
      .limit(20)
      .toArray();

    const context = recent
      .reverse()
      .map((m) => ({ text: m.text, direction: m.direction, timestamp: m.timestamp.toISOString() }));
    const analysis = await analyzeChat(context, settings.humanHandoverKeywords);
    const shouldEscalate = shouldEscalateConversation({
      latestText: args.text,
      keywords: settings.humanHandoverKeywords,
    });

    await applyQrLeadScoreUpdate(leadsCol, lead, context, analysis, shouldEscalate);

    if (lead?._id) {
      const freshLead = await leadsCol.findOne({ _id: lead._id });
      if (freshLead) {
        await syncAutoFollowupQueueFromLead(db, uid, freshLead, settings).catch(() => {});
      }
    }

    if (shouldEscalate) {
      store.processedInboundIds.add(inboundId);
      return;
    }

    const kb = getEffectiveKnowledge(settings);
    const reply = await generateReply(args.text, {
      aiTone: settings.aiTone,
      leadName: lead?.name ?? args.senderName,
      context,
      handoverKeywords: settings.humanHandoverKeywords,
      companyInformation: kb.companyInformation,
      productCatalogueInformation: kb.productCatalogueInformation,
      catalogueLink: kb.catalogueLink,
      restrictToKnowledgeBase: kb.restrictToKnowledgeBase,
      autoShareCatalogue: settings.autoShareCatalogue,
      languageMirrorMode: settings.languageMirrorMode,
    });
    const safeReplyText = coerceCompleteReply(reply.reply, lead?.name ?? args.senderName);
    if (safeReplyText !== reply.reply.trim().replace(/\s+/g, " ")) {
      console.warn("[wa-qr] replaced incomplete model response", {
        original: reply.reply,
        replaced: safeReplyText,
      });
    }

    const sent = await sendQrTextMessage(args.userIdHex, args.jid, safeReplyText);
    if (!sent.ok) {
      console.error("[wa-qr] auto-reply send failed:", sent.error);
      return;
    }

    await persistIncomingOrOutgoingMessage({
      userId: uid,
      waMessageId: sent.messageId,
      from: args.from,
      senderName: "SATYAM AI",
      text: safeReplyText,
      direction: "out",
      timestamp: new Date(),
    });

    // Send the PDF catalogue as a follow-up document when the AI triggered it,
    // but only if we haven't already sent it to this contact before.
    if (reply.sharedCatalogue && settings.autoShareCatalogue) {
      const alreadySentPdf = await messagesCol.findOne({
        userId: uid,
        from: args.from,
        direction: "out",
        text: "[AgriBird Catalogue PDF]",
      });
      if (!alreadySentPdf) {
        const catResult = await sendQrCatalogue(args.userIdHex, args.jid);
        if (catResult.ok) {
          await persistIncomingOrOutgoingMessage({
            userId: uid,
            waMessageId: catResult.messageId,
            from: args.from,
            senderName: "SATYAM AI",
            text: "[AgriBird Catalogue PDF]",
            direction: "out",
            timestamp: new Date(),
          });
        } else {
          console.warn("[wa-qr] catalogue PDF send failed:", catResult.error);
        }
      }
    }

    store.recentReplyByPhone.set(args.from, Date.now());
    store.processedInboundIds.add(inboundId);
  } finally {
    store.inflightInboundIds.delete(inboundId);
  }
}

async function runQrAutoReplySweep(userIdHex: string, userId: ObjectId, limit = 10) {
  const store = getStore(userIdHex);
  if (!store.socket || store.status.state !== "connected") return;

  const db = await getDb();
  const settings = await getOrCreateSettings(db, userId);
  const messagesCol = waMessagesCollection(db);
  const leadsCol = leadsCollection(db);

  const inbound = await messagesCol
    .find({ userId, direction: "in", phoneNumberId: "qr-linked" })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  for (const msg of inbound) {
    const inboundId = msg.waMessageId;
    if (store.processedInboundIds.has(inboundId) || store.inflightInboundIds.has(inboundId)) continue;
    store.inflightInboundIds.add(inboundId);
    try {
      const lastReplyAt = store.recentReplyByPhone.get(msg.from) ?? 0;
      // Keep generation idempotent during rapid upserts / overlapping sweeps.
      if (Date.now() - lastReplyAt < 12_000) {
        continue;
      }

      const hasOutbound = await messagesCol.findOne({
        userId,
        from: msg.from,
        direction: "out",
        _id: { $gt: msg._id },
      });
      if (hasOutbound) {
        store.processedInboundIds.add(inboundId);
        continue;
      }

      const newerInbound = await messagesCol.findOne({
        userId,
        from: msg.from,
        direction: "in",
        timestamp: { $gt: msg.timestamp },
      });
      if (newerInbound) {
        // Only reply to latest inbound in a burst to avoid double Gemini generations.
        store.processedInboundIds.add(inboundId);
        continue;
      }

      if (!settings.autoReply) {
        store.processedInboundIds.add(inboundId);
        continue;
      }
      if (isAutoReplySuppressedAfterManualSend(settings)) {
        store.processedInboundIds.add(inboundId);
        continue;
      }
      const fromForExclusion =
        bestPhoneLocalPartFromBaileysKey({
          remoteJid: msg.remoteJid,
          remoteJidAlt: msg.remoteJidAlt,
        }) ?? msg.from;
      if (await isAutoReplyExcludedForQrInbound(settings, fromForExclusion, getWaAuthDir(userIdHex))) {
        store.processedInboundIds.add(inboundId);
        continue;
      }

      const normalized = normalizePhone(msg.from);
      const lead = await leadsCol.findOne({ userId, phone: normalized });
      if (lead?.needsHuman) {
        await leadsCol.updateOne(
          { _id: lead._id },
          {
            $set: {
              conversationStatus: "awaiting_team_reply",
              lastInboundAt: msg.timestamp,
              updatedAt: new Date(),
            },
          }
        ).catch(() => {});
        store.processedInboundIds.add(inboundId);
        continue;
      }

      const recent = await messagesCol
        .find({ userId, from: msg.from })
        .sort({ timestamp: -1 })
        .limit(20)
        .toArray();
      const context = recent
        .reverse()
        .map((m) => ({ text: m.text, direction: m.direction, timestamp: m.timestamp.toISOString() }));
      const analysis = await analyzeChat(context, settings.humanHandoverKeywords);
      const shouldEscalate = shouldEscalateConversation({
        latestText: msg.text,
        keywords: settings.humanHandoverKeywords,
      });

      await applyQrLeadScoreUpdate(leadsCol, lead, context, analysis, shouldEscalate);

      if (lead?._id) {
        const freshLeadSweep = await leadsCol.findOne({ _id: lead._id });
        if (freshLeadSweep) {
          await syncAutoFollowupQueueFromLead(db, userId, freshLeadSweep, settings).catch(() => {});
        }
      }

      if (shouldEscalate) {
        store.processedInboundIds.add(inboundId);
        continue;
      }

      const kb = getEffectiveKnowledge(settings);
      const reply = await generateReply(msg.text, {
        aiTone: settings.aiTone,
        leadName: lead?.name ?? msg.senderName ?? "there",
        context,
        handoverKeywords: settings.humanHandoverKeywords,
        companyInformation: kb.companyInformation,
        productCatalogueInformation: kb.productCatalogueInformation,
        catalogueLink: kb.catalogueLink,
        restrictToKnowledgeBase: kb.restrictToKnowledgeBase,
        autoShareCatalogue: settings.autoShareCatalogue,
        languageMirrorMode: settings.languageMirrorMode,
      });
      const safeReplyText = coerceCompleteReply(reply.reply, lead?.name ?? msg.senderName ?? "there");
      if (safeReplyText !== reply.reply.trim().replace(/\s+/g, " ")) {
        console.warn("[wa-qr] replaced incomplete model response (sweep)", {
          original: reply.reply,
          replaced: safeReplyText,
        });
      }
      const sent = await sendQrTextMessage(userIdHex, msg.from, safeReplyText);
      if (!sent.ok) {
        console.error("[wa-qr] sweep send failed:", sent.error);
        continue;
      }

      await persistIncomingOrOutgoingMessage({
        userId,
        waMessageId: sent.messageId,
        from: msg.from,
        senderName: "SATYAM AI",
        text: safeReplyText,
        direction: "out",
        timestamp: new Date(),
      });

      // Send the PDF catalogue as a separate document message when triggered,
      // but only if it hasn't already been sent to this contact before.
      if (reply.sharedCatalogue && settings.autoShareCatalogue) {
        const alreadySentPdf = await messagesCol.findOne({
          userId,
          from: msg.from,
          direction: "out",
          text: "[AgriBird Catalogue PDF]",
        });
        if (!alreadySentPdf) {
          const catResult = await sendQrCatalogue(userIdHex, msg.from);
          if (catResult.ok) {
            await persistIncomingOrOutgoingMessage({
              userId,
              waMessageId: catResult.messageId,
              from: msg.from,
              senderName: "SATYAM AI",
              text: "[AgriBird Catalogue PDF]",
              direction: "out",
              timestamp: new Date(),
            });
          } else {
            console.warn("[wa-qr] catalogue PDF send failed:", catResult.error);
          }
        }
      }

      store.recentReplyByPhone.set(msg.from, Date.now());
      store.processedInboundIds.add(inboundId);
    } finally {
      store.inflightInboundIds.delete(inboundId);
    }
  }
}


async function stopSocket(userIdHex: string, clearAuth = false) {
  const store = getStore(userIdHex);
  if (store.autoReplyTimer) {
    clearInterval(store.autoReplyTimer);
    store.autoReplyTimer = null;
  }
  if (store.reconnectTimer) {
    clearTimeout(store.reconnectTimer);
    store.reconnectTimer = null;
  }
  store.reconnectAttempts = 0;
  if (!store.socket) return;
  try {
    await store.socket.logout();
  } catch {
    // Ignore logout errors; we still close socket below.
  }
  try {
    store.socket.end(new Error("QR session restarted"));
  } catch {
    // Ignore close errors.
  }
  store.socket = null;

  if (clearAuth) {
    const authDir = getWaAuthDir(userIdHex);
    if (authDir) await rm(authDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function startQrConnection(userIdHex: string, forceRestart = false): Promise<QrSnapshot> {
  if (!ObjectId.isValid(userIdHex)) {
    throw new Error("Invalid user id for QR session");
  }
  const userId = new ObjectId(userIdHex);
  const store = getStore(userIdHex);

  if (forceRestart) {
    await stopSocket(userIdHex, true);
    store.booting = null;
    setStatus(userIdHex, {
      state: "idle",
      connectedPhone: null,
      qrDataUrl: null,
      error: null,
    });
  }

  if (!forceRestart && (store.status.state === "connected" || store.status.state === "qr_ready")) {
    return store.status;
  }

  if (store.booting) {
    return store.booting;
  }

  const authDir = getWaAuthDir(userIdHex);
  if (!authDir) {
    setStatus(userIdHex, {
      state: "error",
      qrDataUrl: null,
      error: QR_UNSUPPORTED_HOST_ERROR,
    });
    return store.status;
  }

  store.booting = (async () => {
    try {
      setStatus(userIdHex, { state: "connecting", qrDataUrl: null, error: null });

      // Force ws pure JS path; avoids native bufferutil mismatch under Next bundling.
      process.env.WS_NO_BUFFER_UTIL = "1";
      process.env.WS_NO_UTF_8_VALIDATE = "1";

      const [{ fetchLatestBaileysVersion, makeWASocket, useMultiFileAuthState, DisconnectReason }, qrMod] =
        await Promise.all([
          import("@whiskeysockets/baileys"),
          import("qrcode"),
        ]);
      const toQrDataUrl =
        typeof qrMod.toDataURL === "function"
          ? qrMod.toDataURL
          : typeof qrMod.default?.toDataURL === "function"
          ? qrMod.default.toDataURL
          : null;
      if (!toQrDataUrl) {
        throw new Error("QR encoder unavailable");
      }

      let state: Awaited<ReturnType<typeof useMultiFileAuthState>>["state"];
      let saveCreds: Awaited<ReturnType<typeof useMultiFileAuthState>>["saveCreds"];
      try {
        const auth = await useMultiFileAuthState(authDir);
        state = auth.state;
        saveCreds = auth.saveCreds;
      } catch (err) {
        const code = err instanceof Error && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
        if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
          throw new Error(QR_UNSUPPORTED_HOST_ERROR);
        }
        throw err;
      }
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false,
        browser: ["SATYAM AI CRM", "Chrome", "1.0.0"],
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
      });

      store.socket = sock as unknown as SocketType;
      sock.ev.on("creds.update", () => {
        void Promise.resolve(saveCreds()).catch((err) => {
          console.error("[wa-qr] saveCreds failed:", err);
          const code =
            err instanceof Error && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
          setStatus(userIdHex, {
            state: "error",
            qrDataUrl: null,
            error:
              code === "EROFS" || code === "EACCES" || code === "EPERM"
                ? QR_UNSUPPORTED_HOST_ERROR
                : err instanceof Error
                  ? err.message
                  : String(err),
          });
        });
      });

      sock.ev.on("messages.upsert", ({ messages }) => {
        const store = getStore(userIdHex);
        for (const msg of messages ?? []) {
          const ts = parseMessageTimestamp(msg.messageTimestamp);

          // Reject any message that was sent before this session connected.
          // This blocks Baileys from replaying historical messages into the DB.
          if (store.connectedAt !== null && ts) {
            if (ts.getTime() < store.connectedAt) continue;
          }

          // Skip outbound messages entirely for routing logic
          if (msg.key?.fromMe) {
            persistBaileysMessage(
              userId,
              msg as unknown as Parameters<typeof persistBaileysMessage>[1]
            ).catch((err) => {
              console.error("[wa-qr] persist outbound failed:", err);
            });
            continue;
          }

          const jid = msg.key?.remoteJid ?? "";
          const from = bestPhoneLocalPartFromBaileysKey(msg.key ?? {});
          if (!from) continue;

          // ── Image: persist to inbox, then optional business-card scan ───────
          if (isImageMessage(msg.message) && isRecentInbound(ts)) {
            persistBaileysMessage(
              userId,
              msg as unknown as Parameters<typeof persistBaileysMessage>[1]
            ).catch((err) => {
              console.error("[wa-qr] persist image failed:", err);
            });
            processBusinessCardImage({
              userId,
              userIdHex,
              msg,
              from,
              jid,
              senderName: msg.pushName || from,
            }).catch((err) => {
              console.error("[wa-qr] business-card processing failed:", err);
            });
            continue; // don't run auto-reply for image messages
          }

          // ── Text: normal persist + auto-reply ────────────────────────────
          persistBaileysMessage(
            userId,
            msg as unknown as Parameters<typeof persistBaileysMessage>[1]
          ).catch((err) => {
            console.error("[wa-qr] persist message failed:", err);
          });

          const text = extractText(msg.message);
          if (!text) continue;
          if (!isRecentInbound(ts)) continue;

          const inboundMessageId = msg.key?.id ?? undefined;
          processQrInboundAutoReply({
            userId,
            userIdHex,
            inboundMessageId,
            jid,
            from,
            senderName: msg.pushName || from,
            text,
          }).catch((err) => {
            console.error("[wa-qr] auto-reply pipeline failed:", err);
          });
        }
      });

      // History sync is intentionally disabled (syncFullHistory: false).
      // We only want NEW messages that arrive after this session connects.

      sock.ev.on("connection.update", async (update) => {
        if (update.qr) {
          const qrDataUrl = await toQrDataUrl(update.qr);
          setStatus(userIdHex, { state: "qr_ready", qrDataUrl, error: null });
        }

        if (update.connection === "open") {
          const phone = sock.user?.id?.split(":")[0]?.split("@")[0] ?? null;
          store.connectedAt = Date.now();
          store.reconnectAttempts = 0;
          if (store.reconnectTimer) {
            clearTimeout(store.reconnectTimer);
            store.reconnectTimer = null;
          }
          setStatus(userIdHex, {
            state: "connected",
            connectedPhone: phone,
            qrDataUrl: null,
            error: null,
          });
          if (store.autoReplyTimer) clearInterval(store.autoReplyTimer);
          store.autoReplyTimer = setInterval(() => {
            runQrAutoReplySweep(userIdHex, userId, 20).catch((err) => {
              console.error("[wa-qr] auto-reply sweep failed:", err);
            });
          }, 8000);
          runQrAutoReplySweep(userIdHex, userId, 20).catch(() => {});
        }

        if (update.connection === "close") {
          const statusCode =
            (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
          const isLoggedOut    = statusCode === DisconnectReason.loggedOut;
          // connectionReplaced (440) = another session kicked this one — conflict loop
          const isReplaced     = statusCode === DisconnectReason.connectionReplaced;
          const shouldReconnect = !isLoggedOut && !isReplaced;

          store.socket = null;
          if (store.autoReplyTimer) {
            clearInterval(store.autoReplyTimer);
            store.autoReplyTimer = null;
          }
          if (store.reconnectTimer) {
            clearTimeout(store.reconnectTimer);
            store.reconnectTimer = null;
          }

          if (isReplaced) {
            store.reconnectAttempts = 0;
            setStatus(userIdHex, {
              state: "idle",
              connectedPhone: null,
              qrDataUrl: null,
              error:
                "Session replaced — another WhatsApp Web session is active. " +
                "Close other sessions, then click Connect again.",
            });
            return;
          }

          if (!shouldReconnect) {
            store.reconnectAttempts = 0;
            setStatus(userIdHex, {
              state: "idle",
              connectedPhone: null,
              qrDataUrl: null,
              error: "WhatsApp session logged out. Click Connect again.",
            });
            return;
          }

          const MAX_ATTEMPTS = 5;
          if (store.reconnectAttempts >= MAX_ATTEMPTS) {
            store.reconnectAttempts = 0;
            setStatus(userIdHex, {
              state: "error",
              qrDataUrl: null,
              error: `Reconnection failed after ${MAX_ATTEMPTS} attempts. Click Connect again.`,
            });
            return;
          }

          // Exponential backoff: 3s, 6s, 12s, 24s, 30s (cap)
          const delay = Math.min(3000 * Math.pow(2, store.reconnectAttempts), 30000);
          store.reconnectAttempts += 1;

          setStatus(userIdHex, {
            state: "connecting",
            qrDataUrl: null,
            error: `Connection dropped. Reconnecting in ${Math.round(delay / 1000)}s (attempt ${store.reconnectAttempts}/${MAX_ATTEMPTS})…`,
          });

          store.reconnectTimer = setTimeout(() => {
            store.reconnectTimer = null;
            store.booting = null;
            startQrConnection(userIdHex).catch((err) => {
              console.error("[wa-qr] scheduled reconnect failed:", err);
            });
          }, delay);
        }
      });

      return store.status;
    } catch (err) {
      setStatus(userIdHex, {
        state: "error",
        qrDataUrl: null,
        error: err instanceof Error ? err.message : String(err),
      });
      return store.status;
    } finally {
      store.booting = null;
    }
  })();

  return store.booting;
}

export function getQrSnapshot(userIdHex: string): QrSnapshot {
  return getStore(userIdHex).status;
}

export async function stopQrConnection(userIdHex: string): Promise<void> {
  await stopSocket(userIdHex, true);
  setStatus(userIdHex, { state: "idle", qrDataUrl: null, connectedPhone: null, error: null });
}

export async function sendQrCatalogue(
  userIdHex: string,
  to: string
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const store = getStore(userIdHex);
  if (!store.socket || store.status.state !== "connected") {
    return { ok: false, error: "QR session is not connected" };
  }

  const jids = resolveSendJids(to);
  if (jids.length === 0) return { ok: false, error: "Invalid recipient" };

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await readFile(CATALOGUE_PDF);
  } catch {
    return { ok: false, error: "Catalogue PDF not found in public folder" };
  }

  try {
    const result = await store.socket.sendMessage(jids[0], {
      document: pdfBuffer,
      mimetype: "application/pdf",
      fileName: "AgriBird Brochure.pdf",
    });
    return { ok: true, messageId: result?.key?.id ?? `pdf-${Date.now()}` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to send PDF",
    };
  }
}

export async function sendQrDocumentBuffer(
  userIdHex: string,
  to: string,
  buffer: Buffer,
  mimetype: string,
  fileName: string
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const store = getStore(userIdHex);
  if (!store.socket || store.status.state !== "connected") {
    return { ok: false, error: "QR session is not connected" };
  }

  const jids = resolveSendJids(to);
  if (jids.length === 0) return { ok: false, error: "Invalid recipient" };

  let lastError = "Failed to send document";
  for (const jid of jids) {
    try {
      const result = await store.socket.sendMessage(jid, {
        document: buffer,
        mimetype,
        fileName,
      });
      return { ok: true, messageId: result?.key?.id ?? `qr-doc-${Date.now()}` };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, error: lastError };
}

export async function sendQrTextMessage(userIdHex: string, to: string, text: string) {
  const store = getStore(userIdHex);
  if (!store.socket || store.status.state !== "connected") {
    return { ok: false as const, error: "QR session is not connected" };
  }

  const jids = resolveSendJids(to);
  if (jids.length === 0) {
    return { ok: false as const, error: "Invalid recipient JID/number" };
  }

  let lastError = "Failed to send via QR";
  for (const jid of jids) {
    try {
      console.log("[wa-qr] send attempt", { jid });
      // linkPreview: null disables Baileys' getLinkPreview which is broken in this env
      const res = await store.socket.sendMessage(jid, { text, linkPreview: null });
      return {
        ok: true as const,
        messageId: res.key?.id ?? `qr-out-${Date.now()}`,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    ok: false as const,
    error: lastError,
  };
}

const WA_CAPTION_MAX = 1024;

export async function sendQrImageMessage(
  userIdHex: string,
  to: string,
  image: Buffer,
  caption?: string
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const store = getStore(userIdHex);
  if (!store.socket || store.status.state !== "connected") {
    return { ok: false, error: "QR session is not connected" };
  }

  const jids = resolveSendJids(to);
  if (jids.length === 0) {
    return { ok: false, error: "Invalid recipient JID/number" };
  }

  const cap =
    caption && caption.length > WA_CAPTION_MAX
      ? `${caption.slice(0, WA_CAPTION_MAX - 1)}…`
      : caption?.trim()
        ? caption
        : undefined;

  let lastError = "Failed to send image via QR";
  for (const jid of jids) {
    try {
      console.log("[wa-qr] send image", { jid, bytes: image.length });
      const res = await store.socket.sendMessage(
        jid,
        cap ? { image, caption: cap } : { image }
      );
      return {
        ok: true,
        messageId: res.key?.id ?? `qr-img-${Date.now()}`,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { ok: false, error: lastError };
}

function resolveSendJids(to: string): string[] {
  if (!to) return [];
  if (to.includes("@")) return [to];
  if (to.includes(":")) {
    return [`${to}@lid`, `${to}@s.whatsapp.net`];
  }
  const digits = to.replace(/\D/g, "");
  if (!digits) return [];

  // Heuristic: long IDs in history are usually LID identities, not phone MSISDNs.
  if (digits.length > 12) {
    return [`${digits}@lid`, `${digits}@s.whatsapp.net`];
  }

  // Normal phone-number chats.
  return [`${digits}@s.whatsapp.net`, `${digits}@lid`];
}

function normalizeTextForKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function coerceCompleteReply(reply: string, leadName: string): string {
  void leadName;
  const compact = reply.trim().replace(/\s+/g, " ");
  const fallback = `Thanks Sir. Thoda aur detail bata dijiyega, main sahi se help kar dunga.`;
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
