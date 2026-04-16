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

const GRAPH_API_VERSION = "v22.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export type WaSendResult =
  | { ok: true;  messageId: string; mode: "live" | "dry-run" }
  | { ok: false; error: string;     mode: "live" | "dry-run" };

export interface WhatsAppRuntimeConfig {
  token?: string;
  phoneNumberId?: string;
}

// ── Internal config ────────────────────────────────────────────────────────────

function getConfig(override?: WhatsAppRuntimeConfig) {
  const token = override?.token ?? process.env.WHATSAPP_TOKEN;
  const phoneNumberId = override?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  const dryRun        = !token || !phoneNumberId;
  return { token, phoneNumberId, dryRun };
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
        to,
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

  try {
    const res = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
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
            messages?:   {
              id:        string;
              from:      string;
              timestamp: string;
              type:      string;
              text?:     { body: string };
            }[];
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

        for (const msg of value.messages ?? []) {
          if (msg.type !== "text" || !msg.text?.body) continue;

          const contact = value.contacts?.find((c) => c.wa_id === msg.from);

          results.push({
            waMessageId:   msg.id,
            from:          msg.from,
            senderName:    contact?.profile?.name ?? msg.from,
            text:          msg.text.body,
            timestamp:     new Date(Number(msg.timestamp) * 1000),
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
