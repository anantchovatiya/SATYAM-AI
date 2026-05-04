import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { leadsCollection, type LeadDoc } from "@/lib/models/lead";
import { waMessagesCollection } from "@/lib/models/webhook-log";
import { followupsCollection } from "@/lib/models/followup";
import { getOrCreateSettings } from "@/lib/models/settings";
import { generateFollowUp } from "@/lib/ai";
import {
  resolveWhatsAppRuntimeConfig,
  sendTextMessage,
  type WhatsAppRuntimeConfig,
} from "@/lib/whatsapp";
import { getQrSnapshot, sendQrTextMessage } from "@/lib/whatsapp-qr-connector";
import { clearAutoFollowupQueueTask, syncAutoFollowupQueueFromLead } from "@/lib/auto-followup-queue";

export type SendAutoFollowupForLeadResult =
  | { ok: true; action: "sent"; channel: "cloud" | "qr"; leadId: string; leadName: string; reason: string }
  | { ok: true; action: "dry_run"; leadId: string; leadName: string; reason: string }
  | { ok: false; leadId: string; leadName: string; action: "skip" | "send_error"; reason: string };

/**
 * One-lead follow-up. Requires our last message at/after their last inbound; no sensitive-topic block.
 */
export async function sendAutoFollowupForLead(
  userId: ObjectId,
  lead: LeadDoc,
  options: { dryRun: boolean; fromManualQueue?: boolean }
): Promise<SendAutoFollowupForLeadResult> {
  const userIdHex = userId.toHexString();
  const leadId = lead._id?.toHexString() ?? "";
  const db = await getDb();
  const leadsCol = leadsCollection(db);
  const messagesCol = waMessagesCollection(db);
  const followupsCol = followupsCollection(db);
  const settings = await getOrCreateSettings(db, userId);
  const now = new Date();
  const waConfig: WhatsAppRuntimeConfig | undefined = resolveWhatsAppRuntimeConfig(settings);

  if (lead.needsHuman) {
    return { ok: false, leadId, leadName: lead.name, action: "skip", reason: "Waiting for human reply" };
  }

  const variants = phoneVariants(lead.phone);
  const latestInbound = await messagesCol
    .find({ userId, from: { $in: variants }, direction: "in" })
    .sort({ timestamp: -1 })
    .limit(1)
    .toArray();
  const latestOutbound = await messagesCol
    .find({ userId, from: { $in: variants }, direction: "out" })
    .sort({ timestamp: -1 })
    .limit(1)
    .toArray();

  const inDoc = latestInbound[0];
  const outDoc = latestOutbound[0];
  if (!inDoc) {
    return { ok: false, leadId, leadName: lead.name, action: "skip", reason: "No inbound messages found" };
  }

  const inMs = new Date(inDoc.timestamp).getTime();
  const outMs = outDoc ? new Date(outDoc.timestamp).getTime() : 0;
  if (!outDoc || outMs < inMs) {
    return {
      ok: false,
      leadId,
      leadName: lead.name,
      action: "skip",
      reason:
        "The lead’s latest message still needs a reply from you. Auto follow-up runs only after you have replied and they go silent.",
    };
  }

  const daysSilent = Math.floor((now.getTime() - inMs) / 86_400_000);
  /** User clicked Send on a due queue row — do not re-block on min silence (e.g. testing by editing dueDate only). */
  const fromManualQueue = options.fromManualQueue === true;
  if (!fromManualQueue && daysSilent < settings.followUpDelayDays) {
    return {
      ok: false,
      leadId,
      leadName: lead.name,
      action: "skip",
      reason: `Only ${daysSilent} day(s) silent; need at least ${settings.followUpDelayDays} (settings).`,
    };
  }
  const daysForAi = fromManualQueue
    ? Math.max(daysSilent, settings.followUpDelayDays)
    : daysSilent;

  const minScore =
    typeof settings.followUpMinInterestScore === "number" ? settings.followUpMinInterestScore : 0;
  if (minScore > 0 && (lead.interestScore ?? 0) < minScore) {
    return {
      ok: false,
      leadId,
      leadName: lead.name,
      action: "skip",
      reason: `Interest score ${lead.interestScore ?? 0} is below the minimum ${minScore}.`,
    };
  }

  const alreadyToday = await followupsCol.findOne({
    userId,
    leadId,
    createdAt: { $gte: startOfDay(now) },
    $or: [
      { task: { $regex: /^Auto follow-up sent/i } },
      { task: { $regex: /^Auto follow-up blocked/i } },
    ],
  });
  if (alreadyToday) {
    return { ok: false, leadId, leadName: lead.name, action: "skip", reason: "An auto follow-up was already sent today for this lead." };
  }

  const follow = await generateFollowUp({
    leadId,
    leadName: lead.name,
    daysSinceLastMessage: daysForAi,
    lastMessage: inDoc.text,
    lastOutboundMessage: outDoc?.text ?? "",
    followUpDelayDays: settings.followUpDelayDays,
    followUpTemplate: settings.followUpTemplate,
    aiTone: settings.aiTone,
  });
  const safeFollowUp = coerceCompleteReply(follow.followUp, lead.name);

  if (!follow.shouldSend || !safeFollowUp.trim()) {
    return { ok: false, leadId, leadName: lead.name, action: "skip", reason: follow.reason };
  }

  if (options.dryRun) {
    return { ok: true, action: "dry_run", leadId, leadName: lead.name, reason: follow.reason };
  }

  const waTo = variants[0];
  const qrConnected = getQrSnapshot(userIdHex).state === "connected";
  const cloudConfigured = Boolean(waConfig?.token && waConfig?.phoneNumberId);
  let sendRes: Awaited<ReturnType<typeof sendTextMessage>>;
  let channel: "cloud" | "qr";

  if (qrConnected) {
    const qrSend = await sendQrTextMessage(userIdHex, waTo, safeFollowUp);
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
      const qrSend = await sendQrTextMessage(userIdHex, waTo, safeFollowUp);
      if (qrSend.ok) {
        sendRes = { ok: true, messageId: qrSend.messageId, mode: "live" };
        channel = "qr";
      }
    }
  }

  if ((!sendRes.ok || sendRes.mode === "dry-run") && !cloudConfigured && qrConnected) {
    return {
      ok: false,
      leadId,
      leadName: lead.name,
      action: "send_error",
      reason: "QR send failed and Cloud API is not configured.",
    };
  }
  if (!sendRes.ok || sendRes.mode === "dry-run") {
    return {
      ok: false,
      leadId,
      leadName: lead.name,
      action: "send_error",
      reason: sendRes.ok
        ? "Follow-up was not delivered (no live WhatsApp channel)."
        : (sendRes.error ?? "Send failed"),
    };
  }

  await messagesCol.updateOne(
    { userId, waMessageId: sendRes.messageId },
    {
      $setOnInsert: {
        userId,
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
    userId,
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
  await clearAutoFollowupQueueTask(db, userId, leadId);

  const leadFresh = await leadsCol.findOne({ _id: lead._id });
  if (leadFresh) {
    await syncAutoFollowupQueueFromLead(db, userId, leadFresh, settings);
  }

  return { ok: true, action: "sent", channel, leadId, leadName: lead.name, reason: follow.reason };
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
  void leadName;
  const compact = reply.trim().replace(/\s+/g, " ");
  const fallback = `Thanks Sir. Thoda aur detail bata dijiyega, main sahi se help kar dunga.`;
  if (!compact || compact.length < 10) return fallback;

  const core = compact
    .split(/\s+Details:\s+/i)[0]
    .split(/\s+Catalogue:\s+/i)[0]
    .trim();

  const ending = core.replace(/[\s\p{Extended_Pictographic}\uFE0F\u200D]+$/gu, "").trim();
  if (!ending) return compact;

  if (/[,:;]\s*$/.test(ending)) return fallback;
  if (/\b\w+'\s*$/.test(ending) && !/[.!?]/.test(ending.slice(-6))) return fallback;
  if (ending.length < 8 && !/[.!?]/.test(ending)) return fallback;

  return compact;
}
