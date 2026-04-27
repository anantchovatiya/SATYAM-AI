import { canonicalWaContactKey } from "@/lib/wa-phone";
import type { AutomationSettings } from "@/lib/models/settings";

const MAX_EXCLUDED = 500;

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
  return list.includes(c);
}
