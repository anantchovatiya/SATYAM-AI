/**
 * Canonical WhatsApp identity for matching leads ↔ messages (Cloud API + QR).
 */

import type { Collection } from "mongodb";
import type { LeadDoc } from "@/lib/models/lead";

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  return col.findOne({ phone: { $in: [...variants] } });
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
