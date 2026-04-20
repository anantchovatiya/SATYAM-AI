import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getOrCreateSettings } from "@/lib/models/settings";
import { waMessagesCollection } from "@/lib/models/webhook-log";
import {
  resolveWhatsAppRuntimeConfig,
  sendTemplateMessage,
  type WhatsAppRuntimeConfig,
} from "@/lib/whatsapp";
import { canonicalWaContactKey } from "@/lib/wa-phone";

/** Vercel / hosting: keep batches small enough to finish within the function limit. */
export const maxDuration = 120;

const MAX_RECIPIENTS = 100;
const DEFAULT_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      templateName?: string;
      languageCode?: string;
      components?: unknown;
      recipients?: string;
      delayMs?: number;
      recordInCrm?: boolean;
    };

    const templateName = String(body.templateName ?? "").trim();
    if (!templateName) {
      return NextResponse.json({ error: "templateName is required" }, { status: 400 });
    }

    const languageCode = String(body.languageCode ?? "en_US").trim() || "en_US";
    const delayMs = Math.min(Math.max(Number(body.delayMs) || DEFAULT_DELAY_MS, 200), 3000);
    const recordInCrm = body.recordInCrm !== false;

    let components: unknown[] = [];
    if (body.components !== undefined && body.components !== null && body.components !== "") {
      if (Array.isArray(body.components)) {
        components = body.components;
      } else if (typeof body.components === "string") {
        const s = body.components.trim();
        if (s) {
          try {
            const parsed = JSON.parse(s) as unknown;
            if (!Array.isArray(parsed)) {
              return NextResponse.json({ error: "components must be a JSON array" }, { status: 400 });
            }
            components = parsed;
          } catch {
            return NextResponse.json({ error: "components must be valid JSON (array)" }, { status: 400 });
          }
        }
      }
    }

    const lines = String(body.recipients ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const phones = [
      ...new Set(
        lines
          .map((line) => {
            const part = line.split(/[,\t]/)[0]?.trim() ?? line;
            return part.replace(/\D/g, "");
          })
          .filter((d) => d.length >= 8 && d.length <= 15)
      ),
    ];

    if (phones.length === 0) {
      return NextResponse.json(
        { error: "Add at least one valid number (country code + national number, digits only per line)." },
        { status: 400 }
      );
    }

    if (phones.length > MAX_RECIPIENTS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_RECIPIENTS} recipients per batch. Split into multiple runs.` },
        { status: 400 }
      );
    }

    const db = await getDb();
    const settings = await getOrCreateSettings(db);
    const waConfig: WhatsAppRuntimeConfig | undefined = resolveWhatsAppRuntimeConfig(settings);

    if (!waConfig?.token || !waConfig?.phoneNumberId) {
      return NextResponse.json(
        { error: "WhatsApp Business API is not configured (connect token + phone number ID in Dashboard or env)." },
        { status: 400 }
      );
    }

    const messagesCol = waMessagesCollection(db);
    const results: { to: string; ok: boolean; messageId?: string; error?: string }[] = [];
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < phones.length; i++) {
      const to = phones[i]!;
      const res = await sendTemplateMessage(to, templateName, languageCode, components, waConfig);

      if (res.ok && res.mode === "live") {
        sent++;
        results.push({ to, ok: true, messageId: res.messageId });
        if (recordInCrm) {
          const fromKey = canonicalWaContactKey(to) || to;
          await messagesCol
            .updateOne(
              { waMessageId: res.messageId },
              {
                $setOnInsert: {
                  waMessageId: res.messageId,
                  from: fromKey,
                  senderName: "SATYAM AI",
                  text: `[Template: ${templateName}]`,
                  timestamp: new Date(),
                  direction: "out",
                  phoneNumberId: waConfig.phoneNumberId,
                },
              },
              { upsert: true }
            )
            .catch(() => {});
        }
      } else {
        failed++;
        results.push({
          to,
          ok: false,
          error: !res.ok ? res.error : res.mode === "dry-run" ? "Dry run (missing API credentials)" : "Unknown",
        });
      }

      if (i < phones.length - 1) {
        await sleep(delayMs);
      }
    }

    return NextResponse.json({
      ok: true,
      templateName,
      languageCode,
      total: phones.length,
      sent,
      failed,
      results,
    });
  } catch (err) {
    console.error("[POST /api/whatsapp/bulk-template]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bulk send failed" },
      { status: 500 }
    );
  }
}
