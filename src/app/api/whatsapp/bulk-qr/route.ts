import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { leadsCollection } from "@/lib/models/lead";
import { waMessagesCollection } from "@/lib/models/webhook-log";
import {
  applyPlaceholders,
  buildPlaceholderVars,
  parseBulkQrRecipientLines,
} from "@/lib/bulk-qr-template";
import { resolveQrRecipient } from "@/lib/wa-qr-recipient";
import { canonicalWaContactKey, findLeadByCanonicalPhone } from "@/lib/wa-phone";
import { normalizeWhatsAppRecipientId } from "@/lib/whatsapp";
import {
  getQrSnapshot,
  sendQrImageMessage,
  sendQrTextMessage,
} from "@/lib/whatsapp-qr-connector";
import { requireApiUser } from "@/lib/auth/session";

export const maxDuration = 120;

const MAX_RECIPIENTS = 100;
const DEFAULT_DELAY_MS = 500;
const CAPTION_MAX = 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeDataImage(
  raw: string,
  mimeFromBody?: string
): { buffer: Buffer; mime: string } | { error: string } {
  const s = raw.trim();
  if (!s) return { error: "Empty image payload" };

  let mime = (mimeFromBody ?? "image/jpeg").trim().toLowerCase();
  let b64 = s;

  const m = /^data:([^;]+);base64,(.+)$/i.exec(s);
  if (m) {
    mime = m[1]!.trim().toLowerCase();
    b64 = m[2]!.replace(/\s/g, "");
  } else {
    b64 = s.replace(/\s/g, "");
  }

  if (!ALLOWED_IMAGE_MIMES.has(mime)) {
    return { error: `Unsupported image type ${mime}. Use JPEG, PNG, or WebP.` };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(b64, "base64");
  } catch {
    return { error: "Invalid base64 image data" };
  }

  if (buffer.length === 0) return { error: "Decoded image is empty" };
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { error: `Image too large (max ${MAX_IMAGE_BYTES / (1024 * 1024)} MB)` };
  }

  return { buffer, mime };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiUser(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;
    const userIdHex = userId.toHexString();

    const body = (await req.json()) as {
      message?: string;
      recipients?: string;
      imageBase64?: string;
      imageMimeType?: string;
      delayMs?: number;
      recordInCrm?: boolean;
    };

    const messageTemplate = String(body.message ?? "").trim();
    if (!messageTemplate) {
      return NextResponse.json(
        { error: "message is required (use {firstname}, {lastname}, {name}, {phone}, {company})" },
        { status: 400 }
      );
    }

    if (getQrSnapshot(userIdHex).state !== "connected") {
      return NextResponse.json(
        {
          error:
            "WhatsApp QR session is not connected for your account. Link your phone from Dashboard (local / long-running server only).",
        },
        { status: 400 }
      );
    }

    const rows = parseBulkQrRecipientLines(String(body.recipients ?? ""));
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Add at least one valid recipient line (country code + number)." },
        { status: 400 }
      );
    }

    if (rows.length > MAX_RECIPIENTS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_RECIPIENTS} recipients per batch.` },
        { status: 400 }
      );
    }

    const delayMs = Math.min(Math.max(Number(body.delayMs) || DEFAULT_DELAY_MS, 200), 3000);
    const recordInCrm = body.recordInCrm !== false;

    let imageBuffer: Buffer | null = null;
    if (body.imageBase64 && String(body.imageBase64).trim()) {
      const decoded = decodeDataImage(String(body.imageBase64), body.imageMimeType);
      if ("error" in decoded) {
        return NextResponse.json({ error: decoded.error }, { status: 400 });
      }
      imageBuffer = decoded.buffer;
    }

    const db = await getDb();
    const messagesCol = waMessagesCollection(db);
    const leadsCol = leadsCollection(db);

    const results: { to: string; ok: boolean; messageId?: string; error?: string }[] = [];
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const digits = row.phoneDigits;

      const lead = await findLeadByCanonicalPhone(leadsCol, userId, digits);
      const vars = buildPlaceholderVars(row, lead?.name ?? null);
      const personalized = applyPlaceholders(messageTemplate, vars);
      if (!personalized.trim()) {
        failed++;
        results.push({ to: digits, ok: false, error: "Message empty after placeholders" });
        if (i < rows.length - 1) await sleep(delayMs);
        continue;
      }

      const qrTo = await resolveQrRecipient(digits, userId, messagesCol);
      const fromKey = canonicalWaContactKey(digits) || normalizeWhatsAppRecipientId(digits);
      const now = new Date();

      const persist = async (waMessageId: string, text: string) => {
        if (!recordInCrm) return;
        await messagesCol
          .updateOne(
            { userId, waMessageId },
            {
              $setOnInsert: {
                userId,
                waMessageId,
                from: fromKey,
                senderName: "SATYAM AI",
                text,
                timestamp: now,
                direction: "out",
                phoneNumberId: "qr-linked",
              },
            },
            { upsert: true }
          )
          .catch(() => {});
      };

      try {
        if (imageBuffer) {
          if (personalized.length <= CAPTION_MAX) {
            const imgRes = await sendQrImageMessage(userIdHex, qrTo, imageBuffer, personalized);
            if (!imgRes.ok) {
              failed++;
              results.push({ to: digits, ok: false, error: imgRes.error });
            } else {
              sent++;
              results.push({ to: digits, ok: true, messageId: imgRes.messageId });
              await persist(imgRes.messageId, `[Image] ${personalized}`);
            }
          } else {
            const head = personalized.slice(0, CAPTION_MAX);
            const tail = personalized.slice(CAPTION_MAX).trimStart();
            const imgRes = await sendQrImageMessage(userIdHex, qrTo, imageBuffer, head);
            if (!imgRes.ok) {
              failed++;
              results.push({ to: digits, ok: false, error: imgRes.error });
            } else {
              await persist(imgRes.messageId, `[Image] ${head}`);
              if (tail) {
                await sleep(400);
                const txtRes = await sendQrTextMessage(userIdHex, qrTo, tail);
                if (txtRes.ok) {
                  await persist(txtRes.messageId, tail);
                }
              }
              sent++;
              results.push({ to: digits, ok: true, messageId: imgRes.messageId });
            }
          }
        } else {
          const txtRes = await sendQrTextMessage(userIdHex, qrTo, personalized);
          if (!txtRes.ok) {
            failed++;
            results.push({ to: digits, ok: false, error: txtRes.error });
          } else {
            sent++;
            results.push({ to: digits, ok: true, messageId: txtRes.messageId });
            await persist(txtRes.messageId, personalized);
          }
        }
      } catch (err) {
        failed++;
        results.push({
          to: digits,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (i < rows.length - 1) {
        await sleep(delayMs);
      }
    }

    return NextResponse.json({
      ok: true,
      channel: "qr",
      total: rows.length,
      sent,
      failed,
      results,
    });
  } catch (err) {
    console.error("[POST /api/whatsapp/bulk-qr]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bulk QR send failed" },
      { status: 500 }
    );
  }
}
