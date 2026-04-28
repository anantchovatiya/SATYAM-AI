import type { WaMessage } from "@/lib/models/webhook-log";

/** Stored text when inbound was media the AI cannot see in the inbox. */
const MEDIA_PLACEHOLDERS = new Set([
  "[Image]",
  "[Video]",
  "[Document]",
  "[Sticker]",
  "[Voice message]",
]);

/** True when the latest inbound line is only a media placeholder or empty (no safe text to reply to). */
export function shouldSkipAutoReplyForInboundText(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return MEDIA_PLACEHOLDERS.has(t);
}

/** True for Cloud / stored rows that carry inbound media. */
export function shouldSkipAutoReplyForInboundStoredMessage(msg: {
  text?: string;
  mediaKind?: WaMessage["mediaKind"];
  mediaWaId?: string;
  qrMediaRelPath?: string;
}): boolean {
  if (msg.mediaKind) return true;
  if (msg.mediaWaId) return true;
  if (msg.qrMediaRelPath) return true;
  if (msg.text && shouldSkipAutoReplyForInboundText(msg.text)) return true;
  return false;
}
