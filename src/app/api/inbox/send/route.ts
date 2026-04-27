import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getOrCreateSettings } from "@/lib/models/settings";
import { leadsCollection, type LeadDoc } from "@/lib/models/lead";
import { waMessagesCollection } from "@/lib/models/webhook-log";
import {
  normalizeWhatsAppRecipientId,
  resolveWhatsAppRuntimeConfig,
  sendTextMessage,
  type WhatsAppRuntimeConfig,
} from "@/lib/whatsapp";
import {
  canonicalWaContactKey,
  findLeadByCanonicalPhone,
  formatLeadPhoneFromRaw,
} from "@/lib/wa-phone";
import { resolveQrRecipient } from "@/lib/wa-qr-recipient";
import { getQrSnapshot, sendQrTextMessage } from "@/lib/whatsapp-qr-connector";
import { requireApiUser } from "@/lib/auth/session";
import { applyManualSendAutoReplySuppression } from "@/lib/auto-reply-pause";
import { syncAutoFollowupQueueFromLead } from "@/lib/auto-followup-queue";
import { refreshLeadInterestScoreFromWaThread } from "@/lib/lead-interest-gemini";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiUser(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;
    const userIdHex = userId.toHexString();

    const body = (await req.json()) as { to?: string; text?: string };
    const to = String(body.to ?? "").trim();
    const text = String(body.text ?? "").trim();

    if (!to || !text) {
      return NextResponse.json({ error: "to and text are required" }, { status: 400 });
    }

    const db = await getDb();
    const settings = await getOrCreateSettings(db, userId);
    const waConfig: WhatsAppRuntimeConfig | undefined =
      resolveWhatsAppRuntimeConfig(settings);

    const messagesCol = waMessagesCollection(db);
    const leadsCol = leadsCollection(db);
    const qrConnected = getQrSnapshot(userIdHex).state === "connected";
    const cloudConfigured = Boolean(waConfig?.token && waConfig?.phoneNumberId);
    const qrTarget = qrConnected ? await resolveQrRecipient(to, userId, messagesCol) : to;
    let sendResult: Awaited<ReturnType<typeof sendTextMessage>>;
    let channel: "cloud" | "qr";

    if (cloudConfigured) {
      sendResult = await sendTextMessage(to, text, waConfig);
      channel = "cloud";
      if ((!sendResult.ok || sendResult.mode === "dry-run") && qrConnected) {
        const qr = await sendQrTextMessage(userIdHex, qrTarget, text);
        if (qr.ok) {
          sendResult = { ok: true, messageId: qr.messageId, mode: "live" };
          channel = "qr";
        }
      }
    } else if (qrConnected) {
      const qr = await sendQrTextMessage(userIdHex, qrTarget, text);
      if (qr.ok) {
        sendResult = { ok: true, messageId: qr.messageId, mode: "live" };
        channel = "qr";
      } else {
        sendResult = { ok: false, error: qr.error, mode: "live" };
        channel = "qr";
      }
    } else {
      sendResult = await sendTextMessage(to, text, waConfig);
      channel = "cloud";
    }

    if (!sendResult.ok || sendResult.mode === "dry-run") {
      return NextResponse.json(
        {
          error: sendResult.ok
            ? "Message was generated but not delivered (no live WhatsApp channel available)."
            : sendResult.error,
          mode: sendResult.mode,
          channel,
        },
        { status: 500 }
      );
    }

    const now = new Date();
    const fromKey = canonicalWaContactKey(to) || normalizeWhatsAppRecipientId(to);

    await messagesCol.updateOne(
      { userId, waMessageId: sendResult.messageId },
      {
        $setOnInsert: {
          userId,
          waMessageId: sendResult.messageId,
          from: fromKey,
          senderName: "SATYAM AI",
          text,
          timestamp: now,
          direction: "out",
          phoneNumberId: waConfig?.phoneNumberId ?? "qr-linked",
        },
      },
      { upsert: true }
    );

    let lead: LeadDoc | null = await findLeadByCanonicalPhone(leadsCol, userId, to);
    if (!lead) {
      const display = formatLeadPhoneFromRaw(to);
      const ins = await leadsCol.insertOne({
        userId,
        name: display,
        phone: display,
        source: "WhatsApp",
        status: "New",
        conversationStatus: "awaiting_customer_reply",
        lastMessage: text,
        interestScore: 10,
        assignedTo: "Unassigned",
        lastFollowup: "Just now",
        lastOutboundAt: now,
        createdAt: now,
        updatedAt: now,
      });
      lead = await leadsCol.findOne({ _id: ins.insertedId });
    }
    if (lead) {
      await leadsCol.updateOne(
        { _id: lead._id },
        {
          $set: {
            lastMessage: text,
            lastFollowup: "Just now",
            lastOutboundAt: now,
            needsHuman: false,
            conversationStatus: "awaiting_customer_reply",
            updatedAt: now,
          },
        }
      );
    }

    const leadAfterSend = lead?._id ? await leadsCol.findOne({ _id: lead._id }) : null;
    if (leadAfterSend) {
      await syncAutoFollowupQueueFromLead(db, userId, leadAfterSend, settings).catch(() => {});
    }

    const leadPhone = leadAfterSend?.phone ?? formatLeadPhoneFromRaw(to);
    await refreshLeadInterestScoreFromWaThread(db, userId, fromKey, leadPhone).catch(() => {});

    await applyManualSendAutoReplySuppression(
      db,
      userId,
      settings.autoReplyPauseAfterManualMinutes
    ).catch(() => {});

    const targetUsed = channel === "qr" ? qrTarget : to;
    const recipientDigits =
      channel === "cloud"
        ? normalizeWhatsAppRecipientId(to)
        : normalizeWhatsAppRecipientId(String(qrTarget));

    return NextResponse.json({
      ok: true,
      message: {
        id: sendResult.messageId,
        text,
        direction: "out",
        timestamp: now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        date: "Today",
        status: "delivered",
      },
      channel,
      targetUsed,
      recipientDigits,
      messageId: sendResult.messageId,
      mode: sendResult.mode,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
