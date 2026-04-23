import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getOrCreateSettings } from "@/lib/models/settings";
import { leadsCollection, type LeadDoc } from "@/lib/models/lead";
import { waMessagesCollection } from "@/lib/models/webhook-log";
import {
  normalizeWhatsAppRecipientId,
  resolveWhatsAppRuntimeConfig,
  sendCloudDocumentFromBuffer,
  sendCloudImageFromBuffer,
  type WhatsAppRuntimeConfig,
} from "@/lib/whatsapp";
import {
  canonicalWaContactKey,
  findLeadByCanonicalPhone,
  formatLeadPhoneFromRaw,
} from "@/lib/wa-phone";
import { resolveQrRecipient } from "@/lib/wa-qr-recipient";
import {
  getQrSnapshot,
  sendQrDocumentBuffer,
  sendQrImageMessage,
} from "@/lib/whatsapp-qr-connector";
import { requireApiUser } from "@/lib/auth/session";
import { syncAutoFollowupQueueFromLead } from "@/lib/auto-followup-queue";
import { refreshLeadInterestScoreFromWaThread } from "@/lib/lead-interest-gemini";

export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;

function isImageMime(m: string): boolean {
  return /^image\/(jpeg|png|webp|gif)$/i.test(m);
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiUser(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;
    const userIdHex = userId.toHexString();

    const form = await req.formData();
    const to = String(form.get("to") ?? "").trim();
    const file = form.get("file");

    if (!to || !(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "to and file are required" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 12 MB)" }, { status: 400 });
    }

    const mime = (file.type || "application/octet-stream").trim();
    const originalName = (file.name || "attachment").trim() || "attachment";
    const buf = Buffer.from(await file.arrayBuffer());

    const isImg = isImageMime(mime);
    const isPdf = mime === "application/pdf";
    if (!isImg && !isPdf) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, WebP, GIF, or PDF files are supported." },
        { status: 400 }
      );
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

    const safeImgName = /\.(jpe?g|png|webp|gif)$/i.test(originalName)
      ? originalName.replace(/[^a-zA-Z0-9._-]/g, "_")
      : "image.jpg";
    const safePdfName = originalName.toLowerCase().endsWith(".pdf")
      ? originalName.replace(/[^a-zA-Z0-9._-]/g, "_")
      : "document.pdf";

    let sendResult: Awaited<ReturnType<typeof sendCloudImageFromBuffer>>;
    let channel: "cloud" | "qr" = "cloud";

    if (isImg) {
      if (cloudConfigured) {
        sendResult = await sendCloudImageFromBuffer(to, buf, mime, safeImgName, waConfig);
        channel = "cloud";
        if ((!sendResult.ok || sendResult.mode === "dry-run") && qrConnected) {
          const qr = await sendQrImageMessage(userIdHex, qrTarget, buf);
          if (qr.ok) {
            sendResult = { ok: true, messageId: qr.messageId, mode: "live" };
            channel = "qr";
          }
        }
      } else if (qrConnected) {
        const qr = await sendQrImageMessage(userIdHex, qrTarget, buf);
        sendResult = qr.ok
          ? { ok: true, messageId: qr.messageId, mode: "live" }
          : { ok: false, error: qr.error, mode: "live" };
        channel = "qr";
      } else {
        sendResult = await sendCloudImageFromBuffer(to, buf, mime, safeImgName, waConfig);
        channel = "cloud";
      }
    } else {
      if (cloudConfigured) {
        sendResult = await sendCloudDocumentFromBuffer(to, buf, mime, safePdfName, waConfig);
        channel = "cloud";
        if ((!sendResult.ok || sendResult.mode === "dry-run") && qrConnected) {
          const qr = await sendQrDocumentBuffer(userIdHex, qrTarget, buf, mime, safePdfName);
          if (qr.ok) {
            sendResult = { ok: true, messageId: qr.messageId, mode: "live" };
            channel = "qr";
          }
        }
      } else if (qrConnected) {
        const qr = await sendQrDocumentBuffer(userIdHex, qrTarget, buf, mime, safePdfName);
        sendResult = qr.ok
          ? { ok: true, messageId: qr.messageId, mode: "live" }
          : { ok: false, error: qr.error, mode: "live" };
        channel = "qr";
      } else {
        sendResult = await sendCloudDocumentFromBuffer(to, buf, mime, safePdfName, waConfig);
        channel = "cloud";
      }
    }

    if (!sendResult.ok || sendResult.mode === "dry-run") {
      return NextResponse.json(
        {
          error: sendResult.ok
            ? "Attachment was not delivered (configure WhatsApp Cloud API or connect QR)."
            : "error" in sendResult
              ? sendResult.error
              : "Send failed",
        },
        { status: 500 }
      );
    }

    const displayText = isImg ? `📷 ${originalName}` : `📄 ${originalName}`;
    const now = new Date();
    const fromKey = canonicalWaContactKey(to) || normalizeWhatsAppRecipientId(to);
    const phoneNumberId =
      channel === "qr" ? "qr-linked" : waConfig?.phoneNumberId ?? "api";

    await messagesCol.updateOne(
      { userId, waMessageId: sendResult.messageId },
      {
        $setOnInsert: {
          userId,
          waMessageId: sendResult.messageId,
          from: fromKey,
          senderName: "SATYAM AI",
          text: displayText,
          timestamp: now,
          direction: "out",
          phoneNumberId,
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
        lastMessage: displayText,
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
            lastMessage: displayText,
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
    await refreshLeadInterestScoreFromWaThread(
      db,
      userId,
      fromKey,
      leadAfterSend?.phone ?? formatLeadPhoneFromRaw(to)
    ).catch(() => {});

    return NextResponse.json({
      ok: true,
      messageId: sendResult.messageId,
      channel,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
