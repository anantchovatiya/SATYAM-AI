import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { leadsCollection } from "@/lib/models/lead";
import { waMessagesCollection } from "@/lib/models/webhook-log";
import { followupsCollection } from "@/lib/models/followup";
import { getOrCreateSettings } from "@/lib/models/settings";
import { generateFollowUp } from "@/lib/ai";
import { hasSensitiveTopic } from "@/lib/conversation-status";
import { sendTextMessage, type WhatsAppRuntimeConfig } from "@/lib/whatsapp";
import { getQrSnapshot, sendQrTextMessage } from "@/lib/whatsapp-qr-connector";

interface RunOptions {
  dryRun: boolean;
  limit: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<RunOptions>;
    const dryRun = Boolean(body.dryRun);
    const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 1000);
    const result = await runFollowupAutomation({ dryRun, limit });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[POST /api/automation/followup-run]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const result = await runFollowupAutomation({ dryRun: true, limit: 200 });
    return NextResponse.json({ ok: true, preview: true, ...result });
  } catch (err) {
    console.error("[GET /api/automation/followup-run]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

async function runFollowupAutomation(options: RunOptions) {
  const db = await getDb();
  const leadsCol = leadsCollection(db);
  const messagesCol = waMessagesCollection(db);
  const followupsCol = followupsCollection(db);
  const settings = await getOrCreateSettings(db);
  const now = new Date();
  const waConfig: WhatsAppRuntimeConfig | undefined = settings.whatsapp
    ? {
        token: settings.whatsapp.token,
        phoneNumberId: settings.whatsapp.phoneNumberId,
      }
    : undefined;

  const leads = await leadsCol
    .find({ source: "WhatsApp", status: { $ne: "Closed" } })
    .sort({ updatedAt: -1 })
    .limit(options.limit)
    .toArray();

  let sent = 0;
  let escalated = 0;
  let skipped = 0;
  const details: Array<{ leadId: string; name: string; action: string; reason: string }> = [];

  for (const lead of leads) {
    const leadId = lead._id?.toHexString() ?? "";
    if (lead.needsHuman) {
      skipped += 1;
      details.push({ leadId, name: lead.name, action: "skip", reason: "Waiting for human reply" });
      continue;
    }

    const variants = phoneVariants(lead.phone);
    const latestInbound = await messagesCol
      .find({ from: { $in: variants }, direction: "in" })
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();
    const latestOutbound = await messagesCol
      .find({ from: { $in: variants }, direction: "out" })
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();

    const inDoc = latestInbound[0];
    const outDoc = latestOutbound[0];
    if (!inDoc) {
      skipped += 1;
      details.push({ leadId, name: lead.name, action: "skip", reason: "No inbound messages found" });
      continue;
    }

    if (outDoc && outDoc.timestamp >= inDoc.timestamp) {
      skipped += 1;
      details.push({
        leadId,
        name: lead.name,
        action: "skip",
        reason: "Latest inbound already has outbound reply",
      });
      continue;
    }

    const daysSilent = Math.floor((now.getTime() - new Date(inDoc.timestamp).getTime()) / 86_400_000);
    if (daysSilent < settings.followUpDelayDays) {
      skipped += 1;
      details.push({
        leadId,
        name: lead.name,
        action: "skip",
        reason: `Silent ${daysSilent}d; threshold ${settings.followUpDelayDays}d`,
      });
      continue;
    }

    const alreadyToday = await followupsCol.findOne({
      leadId,
      createdAt: { $gte: startOfDay(now) },
      task: /^Auto follow-up/i,
    });
    if (alreadyToday) {
      skipped += 1;
      details.push({ leadId, name: lead.name, action: "skip", reason: "Follow-up already run today" });
      continue;
    }

    const sensitive = hasSensitiveTopic(inDoc.text, settings.humanHandoverKeywords);
    if (sensitive) {
      escalated += 1;
      if (!options.dryRun) {
        await leadsCol.updateOne(
          { _id: lead._id },
          {
            $set: {
              needsHuman: true,
              conversationStatus: "escalated",
              updatedAt: now,
            },
          }
        );
        await followupsCol.insertOne({
          leadId,
          leadName: lead.name,
          phone: lead.phone,
          task: "Auto follow-up blocked: human escalation",
          dueDate: now,
          owner: lead.assignedTo || "Unassigned",
          status: "Pending",
          notes: `Sensitive topic in latest message: "${inDoc.text.slice(0, 140)}"`,
          createdAt: now,
          updatedAt: now,
        });
      }
      details.push({ leadId, name: lead.name, action: "escalate", reason: "Sensitive topic detected" });
      continue;
    }

    const follow = await generateFollowUp({
      leadId,
      leadName: lead.name,
      daysSinceLastMessage: daysSilent,
      lastMessage: inDoc.text,
      followUpDelayDays: settings.followUpDelayDays,
      followUpTemplate: settings.followUpTemplate,
      aiTone: settings.aiTone,
    });
    const safeFollowUp = coerceCompleteReply(follow.followUp, lead.name);

    if (!follow.shouldSend || !safeFollowUp.trim()) {
      skipped += 1;
      details.push({ leadId, name: lead.name, action: "skip", reason: follow.reason });
      continue;
    }

    if (options.dryRun) {
      sent += 1;
      details.push({ leadId, name: lead.name, action: "dry-run-send", reason: follow.reason });
      continue;
    }

    const waTo = variants[0];
    const qrConnected = getQrSnapshot().state === "connected";
    const cloudConfigured = Boolean(waConfig?.token && waConfig?.phoneNumberId);
    let sendRes: Awaited<ReturnType<typeof sendTextMessage>>;
    let channel: "cloud" | "qr";

    if (qrConnected) {
      const qrSend = await sendQrTextMessage(waTo, safeFollowUp);
      if (qrSend.ok) {
        sendRes = { ok: true, messageId: qrSend.messageId, mode: "live" };
        channel = "qr";
      } else {
        sendRes = await sendTextMessage(waTo, safeFollowUp, waConfig);
        channel = "cloud";
      }
    } else {
      sendRes = await sendTextMessage(waTo, safeFollowUp, waConfig);
      channel = "cloud";
      if ((sendRes.ok && sendRes.mode === "dry-run") || !sendRes.ok) {
        const qrSend = await sendQrTextMessage(waTo, safeFollowUp);
        if (qrSend.ok) {
          sendRes = { ok: true, messageId: qrSend.messageId, mode: "live" };
          channel = "qr";
        }
      }
    }

    if ((!sendRes.ok || sendRes.mode === "dry-run") && !cloudConfigured && qrConnected) {
      skipped += 1;
      details.push({
        leadId,
        name: lead.name,
        action: "send-error",
        reason: "QR send failed and Cloud API is not configured.",
      });
      continue;
    }
    if (!sendRes.ok || sendRes.mode === "dry-run") {
      skipped += 1;
      details.push({
        leadId,
        name: lead.name,
        action: "send-error",
        reason: sendRes.ok
          ? "Follow-up generated but not delivered (no live WhatsApp channel available)."
          : sendRes.error,
      });
      continue;
    }

    sent += 1;
    await messagesCol.updateOne(
      { waMessageId: sendRes.messageId },
      {
        $setOnInsert: {
          waMessageId: sendRes.messageId,
          from: waTo,
          senderName: "SATYAM AI",
          text: safeFollowUp,
          timestamp: now,
          direction: "out",
          phoneNumberId: waConfig?.phoneNumberId ?? "qr-linked",
        },
      },
      { upsert: true }
    );

    await leadsCol.updateOne(
      { _id: lead._id },
      {
        $set: {
          lastMessage: safeFollowUp,
          lastOutboundAt: now,
          lastFollowup: "Just now",
          conversationStatus: "awaiting_customer_reply",
          needsHuman: false,
          updatedAt: now,
        },
      }
    );

    await followupsCol.insertOne({
      leadId,
      leadName: lead.name,
      phone: lead.phone,
      task: "Auto follow-up sent",
      dueDate: now,
      owner: lead.assignedTo || "Unassigned",
      status: "Done",
      notes: follow.reason,
      createdAt: now,
      updatedAt: now,
    });

    details.push({ leadId, name: lead.name, action: `sent:${channel}`, reason: follow.reason });
  }

  return {
    scanned: leads.length,
    sent,
    escalated,
    skipped,
    dryRun: options.dryRun,
    generatedAt: now.toISOString(),
    details,
  };
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function phoneVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return [phone];
  return Array.from(new Set([digits, `+${digits}`, phone]));
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
