/**
 * WhatsApp Business API client (Meta Graph API v19).
 *
 * Set env vars to enable real sending:
 *   WHATSAPP_TOKEN          — permanent or temporary access token
 *   WHATSAPP_PHONE_NUMBER_ID — numeric phone number ID from Meta Developer Console
 *
 * Without those vars the module runs in DRY-RUN mode:
 *   messages are logged but NOT sent to WhatsApp.
 */

import type { AutomationSettings } from "@/lib/models/settings";
import { canonicalWaContactKey } from "@/lib/wa-phone";

const GRAPH_API_VERSION = "v22.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export type WaSendResult =
  | { ok: true;  messageId: string; mode: "live" | "dry-run" }
  | { ok: false; error: string;     mode: "live" | "dry-run" };

export interface WhatsAppRuntimeConfig {
  token?: string;
  phoneNumberId?: string;
}

/**
 * Credentials for Graph API sends. When both env vars are set and not disabled,
 * they win over dashboard-stored Mongo values so hosted deploys (e.g. Vercel)
 * can rotate secrets without clearing the database.
 */
export function resolveWhatsAppRuntimeConfig(
  settings: AutomationSettings
): WhatsAppRuntimeConfig | undefined {
  const envToken = process.env.WHATSAPP_TOKEN?.trim();
  const envPhone = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (envToken && envPhone && !settings.whatsappEnvDisabled) {
    return { token: envToken, phoneNumberId: envPhone };
  }
  if (settings.whatsapp?.token && settings.whatsapp.phoneNumberId) {
    return {
      token: settings.whatsapp.token,
      phoneNumberId: settings.whatsapp.phoneNumberId,
    };
  }
  return undefined;
}

// ── Internal config ────────────────────────────────────────────────────────────

function getConfig(override?: WhatsAppRuntimeConfig) {
  const token = override?.token ?? process.env.WHATSAPP_TOKEN;
  const phoneNumberId = override?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  const dryRun        = !token || !phoneNumberId;
  return { token, phoneNumberId, dryRun };
}

export function normalizeWhatsAppRecipientId(phone: string): string {
  return phone.replace(/\D/g, "");
}

// ── Send a text message ────────────────────────────────────────────────────────

export async function sendTextMessage(
  to: string,
  body: string,
  config?: WhatsAppRuntimeConfig
): Promise<WaSendResult> {
  const { token, phoneNumberId, dryRun } = getConfig(config);

  if (dryRun) {
    console.log(
      `[WhatsApp DRY-RUN] → ${to}\n"${body}"\n` +
      `Set WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID to send for real.`
    );
    return { ok: true, messageId: `dry-run-${Date.now()}`, mode: "dry-run" };
  }

  const toDigits = normalizeWhatsAppRecipientId(to);
  if (!toDigits) {
    return { ok: false, error: "Invalid recipient: country code + number (digits only).", mode: "live" };
  }

  try {
    const res = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type:    "individual",
        to: toDigits,
        type:              "text",
        text:              { preview_url: false, body },
      }),
    });

    const json = await res.json() as { messages?: { id: string }[]; error?: { message: string } };

    if (!res.ok || json.error) {
      return { ok: false, error: json.error?.message ?? `HTTP ${res.status}`, mode: "live" };
    }

    return { ok: true, messageId: json.messages?.[0]?.id ?? "unknown", mode: "live" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      mode: "live",
    };
  }
}

// ── Send a template message (e.g. business card / greeting) ──────────────────

export async function sendTemplateMessage(
  to: string,
  templateName: string,
  languageCode = "en_US",
  components: unknown[] = [],
  config?: WhatsAppRuntimeConfig
): Promise<WaSendResult> {
  const { token, phoneNumberId, dryRun } = getConfig(config);

  if (dryRun) {
    console.log(`[WhatsApp DRY-RUN] Template "${templateName}" → ${to}`);
    return { ok: true, messageId: `dry-run-tmpl-${Date.now()}`, mode: "dry-run" };
  }

  const toDigits = normalizeWhatsAppRecipientId(to);
  if (!toDigits) {
    return { ok: false, error: "Invalid recipient for template.", mode: "live" };
  }

  try {
    const res = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toDigits,
        type:     "template",
        template: { name: templateName, language: { code: languageCode }, components },
      }),
    });

    const json = await res.json() as { messages?: { id: string }[]; error?: { message: string } };

    if (!res.ok || json.error) {
      return { ok: false, error: json.error?.message ?? `HTTP ${res.status}`, mode: "live" };
    }

    return { ok: true, messageId: json.messages?.[0]?.id ?? "unknown", mode: "live" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), mode: "live" };
  }
}

// ── Mark a message as read ────────────────────────────────────────────────────

export async function markAsRead(waMessageId: string, config?: WhatsAppRuntimeConfig): Promise<void> {
  const { token, phoneNumberId, dryRun } = getConfig(config);
  if (dryRun) return;

  await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status:            "read",
      message_id:        waMessageId,
    }),
  }).catch(() => {}); // non-critical
}

// ── Parse Meta webhook payload ────────────────────────────────────────────────

export interface ParsedWaMessage {
  waMessageId:   string;
  from:          string;
  senderName:    string;
  text:          string;
  timestamp:     Date;
  phoneNumberId: string;
}

type WebhookMessage = {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  audio?: { mime_type?: string };
  voice?: { mime_type?: string };
  document?: { caption?: string; filename?: string };
  sticker?: { mime_type?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  location?: { name?: string; address?: string };
  contacts?: unknown;
  reaction?: { emoji?: string };
  system?: { body?: string; type?: string };
};

export function extractInboundTextFromWebhookMessage(msg: WebhookMessage): string | null {
  switch (msg.type) {
    case "text": {
      const body = msg.text?.body?.trim();
      return body && body.length > 0 ? body : null;
    }
    case "image": {
      const cap = msg.image?.caption?.trim();
      return cap && cap.length > 0 ? cap : "[Image]";
    }
    case "video": {
      const cap = msg.video?.caption?.trim();
      return cap && cap.length > 0 ? cap : "[Video]";
    }
    case "audio":
    case "voice":
      return "[Voice message]";
    case "document": {
      const cap = msg.document?.caption?.trim();
      const fn = msg.document?.filename?.trim();
      if (cap && cap.length > 0) return cap;
      if (fn && fn.length > 0) return `[Document: ${fn}]`;
      return "[Document]";
    }
    case "sticker":
      return "[Sticker]";
    case "button": {
      const t = msg.button?.text?.trim() || msg.button?.payload?.trim();
      return t && t.length > 0 ? t : "[Button]";
    }
    case "interactive": {
      const br = msg.interactive?.button_reply?.title?.trim();
      if (br) return br;
      const lr = msg.interactive?.list_reply?.title?.trim();
      if (lr) return lr;
      return "[Interactive reply]";
    }
    case "location": {
      const name = msg.location?.name?.trim();
      const addr = msg.location?.address?.trim();
      if (name && addr) return `${name} — ${addr}`;
      if (name) return name;
      if (addr) return addr;
      return "[Location]";
    }
    case "contacts":
      return "[Contact card]";
    case "reaction": {
      const em = msg.reaction?.emoji?.trim();
      return em ? `[Reaction: ${em}]` : "[Reaction]";
    }
    case "system":
      return msg.system?.body?.trim() || "[System]";
    case "unsupported":
    case "unknown":
      return null;
    default:
      return `[${msg.type}]`;
  }
}

export function parseWebhookPayload(body: unknown): ParsedWaMessage[] {
  const results: ParsedWaMessage[] = [];

  try {
    const payload = body as {
      object: string;
      entry: {
        changes: {
          field: string;
          value: {
            metadata:    { phone_number_id: string };
            contacts?:   { profile: { name: string }; wa_id: string }[];
            messages?:   WebhookMessage[];
          };
        }[];
      }[];
    };

    if (payload?.object !== "whatsapp_business_account") return results;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;

        const { value } = change;
        const phoneNumberId = value.metadata?.phone_number_id ?? "";

        for (const raw of value.messages ?? []) {
          const msg = raw as WebhookMessage;
          if (!msg?.id || !msg.from || !msg.timestamp) continue;

          const text = extractInboundTextFromWebhookMessage(msg);
          if (!text) continue;

          const contact = value.contacts?.find((c) => c.wa_id === msg.from);

          const fromCanon = canonicalWaContactKey(msg.from);
          if (!fromCanon) continue;

          results.push({
            waMessageId: msg.id,
            from: fromCanon,
            senderName: contact?.profile?.name ?? msg.from,
            text,
            timestamp: new Date(Number(msg.timestamp) * 1000),
            phoneNumberId,
          });
        }
      }
    }
  } catch {
    // Return whatever was parsed successfully
  }

  return results;
}
