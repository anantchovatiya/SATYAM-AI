import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getOrCreateSettings } from "@/lib/models/settings";
import { leadsCollection } from "@/lib/models/lead";
import { waMessagesCollection } from "@/lib/models/webhook-log";
import { resolveWhatsAppRuntimeConfig, sendTextMessage, type WhatsAppRuntimeConfig } from "@/lib/whatsapp";
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

    if (qrConnected) {
      const qr = await sendQrTextMessage(qrTarget, text);
      if (qr.ok) {
        sendResult = { ok: true, messageId: qr.messageId, mode: "live" };
        channel = "qr";
      } else {
        sendResult = await sendTextMessage(to, text, waConfig);
        channel = "cloud";
      }
      if ((!sendResult.ok || sendResult.mode === "dry-run") && !cloudConfigured) {
        return NextResponse.json(
          {
            error: "QR send failed and Cloud API is not configured.",
            mode: sendResult.mode,
            channel: "qr",
          },
          { status: 500 }
        );
      }
    } else {
      sendResult = await sendTextMessage(to, text, waConfig);
      channel = "cloud";
      if ((sendResult.ok && sendResult.mode === "dry-run") || !sendResult.ok) {
        const qr = await sendQrTextMessage(qrTarget, text);
        if (qr.ok) {
          sendResult = { ok: true, messageId: qr.messageId, mode: "live" };
          channel = "qr";
        }
      }
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
    const fromDigits = to.replace(/\D/g, "");

    await messagesCol.updateOne(
      { waMessageId: sendResult.messageId },
      {
        $setOnInsert: {
          waMessageId: sendResult.messageId,
          from: fromDigits || to,
          senderName: "SATYAM AI",
          text,
          timestamp: now,
          direction: "out",
          phoneNumberId: waConfig?.phoneNumberId ?? "qr-linked",
        },
      },
      { upsert: true }
    );

    const lead = await leadsCol.findOne({ phone: normalizePhone(to) });
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

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
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
