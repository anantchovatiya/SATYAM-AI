import { ObjectId, type Collection, type Db } from "mongodb";

// ── Webhook event types ───────────────────────────────────────────────────────

export type WebhookEventType =
  | "received"           // raw message arrived from WhatsApp
  | "lead_created"       // new lead auto-created from phone number
  | "lead_updated"       // existing lead updated
  | "analyzed"           // AI analysis completed
  | "handover_flagged"   // needsHuman detected, auto-reply stopped
  | "replied"            // auto-reply sent via WhatsApp API
  | "reply_skipped"      // auto-reply disabled in settings
  | "send_error"         // WhatsApp API send call failed
  | "error";             // unexpected processing error

export interface WebhookEvent {
  type: WebhookEventType;
  timestamp: Date;
  durationMs?: number;
  data?: Record<string, unknown>;
}

// ── Stored message document ───────────────────────────────────────────────────

export interface WaMessage {
  waMessageId: string;   // Meta message ID (unique)
  from: string;          // sender phone e.g. "919810011223"
  remoteJid?: string;    // exact WhatsApp chat JID, e.g. "12345@lid"
  senderName?: string;
  text: string;
  timestamp: Date;
  direction: "in" | "out";
  phoneNumberId: string; // receiving WA Business phone number ID
}

// ── Webhook log document ──────────────────────────────────────────────────────

export interface WebhookLog {
  _id?: ObjectId;
  waMessageId: string;      // dedup key
  from: string;
  senderName?: string;
  messageText: string;
  leadId?: string;          // MongoDB lead _id hex string
  leadName?: string;
  replyText?: string;
  events: WebhookEvent[];
  status: "processed" | "handover" | "skipped" | "error";
  createdAt: Date;
  updatedAt: Date;
}

// ── Collection helpers ────────────────────────────────────────────────────────

export function webhookLogsCollection(db: Db): Collection<WebhookLog> {
  return db.collection<WebhookLog>("webhook_logs");
}

export function waMessagesCollection(db: Db): Collection<WaMessage> {
  return db.collection<WaMessage>("whatsapp_messages");
}

export async function ensureIndexes(db: Db) {
  await webhookLogsCollection(db).createIndex({ waMessageId: 1 }, { unique: true });
  await webhookLogsCollection(db).createIndex({ from: 1, createdAt: -1 });
  await waMessagesCollection(db).createIndex({ waMessageId: 1 }, { unique: true });
  await waMessagesCollection(db).createIndex({ from: 1, timestamp: -1 });
}
