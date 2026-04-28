import { canonicalWaContactKey } from "@/lib/wa-phone";
import type { AutomationSettings } from "@/lib/models/settings";

const MAX_EXCLUDED = 500;

/** Digit keys that should match the same excluded contact (e.g. Indian 91XXXXXXXXXX vs national 10 digits). */
function exclusionMatchVariantSet(canonicalDigits: string): Set<string> {
  const s = new Set<string>();
  const c = canonicalWaContactKey(canonicalDigits);
  if (!c) return s;
  s.add(c);
  if (c.length === 12 && c.startsWith("91")) {
    s.add(c.slice(2));
  }
  return s;
}

/**
 * Deduplicate, canonicalize, cap count (matches inbound `from` via `canonicalWaContactKey`).
 */
export function normalizeAutoReplyExcludedPhones(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const x of input) {
    const c = canonicalWaContactKey(String(x).trim());
    if (c) out.add(c);
  }
  return [...out].slice(0, MAX_EXCLUDED);
}

export function isPhoneExcludedFromAutoReply(settings: AutomationSettings, rawFrom: string): boolean {
  const list = settings.autoReplyExcludedPhones;
  if (!Array.isArray(list) || list.length === 0) return false;
  const c = canonicalWaContactKey(rawFrom);
  if (!c) return false;
  const inbound = exclusionMatchVariantSet(c);
  for (const ex of list) {
    const exCanon = canonicalWaContactKey(ex);
    if (!exCanon) continue;
    const exSet = exclusionMatchVariantSet(exCanon);
    for (const k of inbound) {
      if (exSet.has(k)) return true;
    }
  }
  return false;
}
