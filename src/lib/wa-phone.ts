/**
 * Canonical WhatsApp identity for matching leads ↔ messages (Cloud API + QR).
 */

import type { Collection, ObjectId } from "mongodb";
import type { LeadDoc } from "@/lib/models/lead";

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function waJidLocalPart(jid?: string | null): string | null {
  if (!jid) return null;
  if (jid === "status@broadcast") return null;
  if (!jid.includes("@")) return null;
  const [local] = jid.split("@");
  if (!local || local.length < 5) return null;
  return local;
}

/**
 * Prefer the MSISDN local part from @s.whatsapp.net / @c.us when the primary JID is @lid
 * (Baileys `remoteJid` / `remoteJidAlt`). Same value we store in `whatsapp_messages.from` for QR chats.
 */
export function bestPhoneLocalPartFromBaileysKey(key: {
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
}): string | null {
  const jids = [key.remoteJid, key.remoteJidAlt].filter(
    (j): j is string => typeof j === "string" && j.length > 0
  );
  if (jids.length === 0) return null;
  for (const j of jids) {
    const lower = j.toLowerCase();
    if (lower.endsWith("@s.whatsapp.net") || lower.endsWith("@c.us")) {
      const p = waJidLocalPart(j);
      if (p) return p;
    }
  }
  for (const j of jids) {
    if (j.toLowerCase().endsWith("@lid")) {
      const p = waJidLocalPart(j);
      if (p) return p;
    }
  }
  return waJidLocalPart(jids[0]);
}

export function canonicalWaContactKey(raw: string): string {
  let s = String(raw).trim();
  if (s.includes("@")) s = s.split("@")[0] ?? s;
  if (s.includes(":")) s = s.split(":")[0] ?? s;
  let digits = s.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    digits = "91" + digits;
  }
  return digits;
}

export function formatLeadPhoneFromCanonical(canonicalDigits: string): string {
  if (!canonicalDigits) return "";
  if (canonicalDigits.length === 12 && canonicalDigits.startsWith("91")) {
    return `+${canonicalDigits.slice(0, 2)} ${canonicalDigits.slice(2, 7)} ${canonicalDigits.slice(7)}`;
  }
  return `+${canonicalDigits}`;
}

export function formatLeadPhoneFromRaw(raw: string): string {
  return formatLeadPhoneFromCanonical(canonicalWaContactKey(raw));
}

export async function findLeadByCanonicalPhone(
  col: Collection<LeadDoc>,
  userId: ObjectId,
  rawPhone: string
): Promise<LeadDoc | null> {
  const c = canonicalWaContactKey(rawPhone);
  if (!c) return null;
  const variants = new Set<string>();
  variants.add(formatLeadPhoneFromCanonical(c));
  variants.add(`+${c}`);
  if (c.length === 12 && c.startsWith("91")) {
    variants.add(`+91${c.slice(2)}`);
    variants.add(c.slice(2));
  }
  return col.findOne({ userId, phone: { $in: [...variants] } });
}

/** Match stored `from` variants for a tenant. */
export function mongoMatchStoredWaFromForUser(
  userId: ObjectId,
  canonicalDigits: string
): Record<string, unknown> {
  return { userId, ...mongoMatchStoredWaFrom(canonicalDigits) };
}

export function mongoMatchStoredWaFrom(canonicalDigits: string): { $or: Record<string, unknown>[] } {
  if (!canonicalDigits) return { $or: [{ from: "__impossible__" }] };
  const or: Record<string, unknown>[] = [{ from: canonicalDigits }];
  if (canonicalDigits.length === 12 && canonicalDigits.startsWith("91")) {
    const ten = canonicalDigits.slice(2);
    or.push({ from: ten });
    or.push({ from: { $regex: new RegExp(`^${escapeRegex(canonicalDigits)}(:\\d+)?$`) } });
    or.push({ from: { $regex: new RegExp(`^${escapeRegex(ten)}(:\\d+)?$`) } });
  } else {
    or.push({ from: { $regex: new RegExp(`^${escapeRegex(canonicalDigits)}(:\\d+)?$`) } });
  }
  return { $or: or };
}
