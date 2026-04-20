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
import { getQrSnapshot, sendQrTextMessage } from "@/lib/whatsapp-qr-connector";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { to?: string; text?: string };
    const to = String(body.to ?? "").trim();
    const text = String(body.text ?? "").trim();

    if (!to || !text) {
      return NextResponse.json({ error: "to and text are required" }, { status: 400 });
    }

    const db = await getDb();
    const settings = await getOrCreateSettings(db);
    const waConfig: WhatsAppRuntimeConfig | undefined =
      resolveWhatsAppRuntimeConfig(settings);

    const messagesCol = waMessagesCollection(db);
    const leadsCol = leadsCollection(db);
    const qrConnected = getQrSnapshot().state === "connected";
    const cloudConfigured = Boolean(waConfig?.token && waConfig?.phoneNumberId);
    const qrTarget = qrConnected ? await resolveQrRecipient(to, messagesCol) : to;
    let sendResult: Awaited<ReturnType<typeof sendTextMessage>>;
    let channel: "cloud" | "qr";

    if (cloudConfigured) {
      sendResult = await sendTextMessage(to, text, waConfig);
      channel = "cloud";
      if ((!sendResult.ok || sendResult.mode === "dry-run") && qrConnected) {
        const qr = await sendQrTextMessage(qrTarget, text);
        if (qr.ok) {
          sendResult = { ok: true, messageId: qr.messageId, mode: "live" };
          channel = "qr";
        }
      }
    } else if (qrConnected) {
      const qr = await sendQrTextMessage(qrTarget, text);
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
      { waMessageId: sendResult.messageId },
      {
        $setOnInsert: {
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

    let lead: LeadDoc | null = await findLeadByCanonicalPhone(leadsCol, to);
    if (!lead) {
      const display = formatLeadPhoneFromRaw(to);
      const ins = await leadsCol.insertOne({
        name: display,
        phone: display,
        source: "WhatsApp",
        status: "New",
        conversationStatus: "awaiting_customer_reply",
        lastMessage: text,
        interestScore: 50,
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

async function resolveQrRecipient(
  to: string,
  messagesCol: ReturnType<typeof waMessagesCollection>
): Promise<string> {
  const digits = to.replace(/\D/g, "");
  if (!digits) return to;

  const recentByDigits = await messagesCol
    .find({ from: { $regex: `^${digits}(?::\\d+)?$` } })
    .sort({ timestamp: -1 })
    .limit(5)
    .toArray();

  const withExactJid = recentByDigits.find((m) => typeof m.remoteJid === "string" && m.remoteJid.includes("@"));
  if (withExactJid?.remoteJid) {
    return withExactJid.remoteJid;
  }

  if (recentByDigits[0]?.from) {
    const from = String(recentByDigits[0].from);
    return from.includes(":") ? `${from}@lid` : from;
  }

  return to;
}
