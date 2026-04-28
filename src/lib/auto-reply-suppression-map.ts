import { canonicalWaContactKey } from "@/lib/wa-phone";

const MAX_CONTACT_AUTO_REPLY_SUPPRESSIONS = 500;

function parseUntilMs(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  const t = new Date(String(v)).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Drop expired entries; normalize keys to canonical digits. */
export function pruneExpiredAutoReplyContactSuppressions(
  raw: unknown,
  now: Date = new Date()
): Record<string, Date> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t0 = now.getTime();
  const out: Record<string, Date> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const ck = canonicalWaContactKey(k);
    if (!ck) continue;
    const ms = parseUntilMs(v);
    if (ms > t0) out[ck] = new Date(ms);
  }
  return Object.keys(out).length ? out : undefined;
}

export function mergeContactSuppressionMap(
  raw: unknown,
  contactCanonical: string,
  until: Date
): Record<string, Date> {
  const now = Date.now();
  const out: Record<string, Date> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const ck = canonicalWaContactKey(k);
      if (!ck) continue;
      const ms = parseUntilMs(v);
      if (ms > now) out[ck] = new Date(ms);
    }
  }
  out[contactCanonical] = until;
  const keys = Object.keys(out).sort((a, b) => out[b]!.getTime() - out[a]!.getTime());
  const capped: Record<string, Date> = {};
  for (const k of keys.slice(0, MAX_CONTACT_AUTO_REPLY_SUPPRESSIONS)) {
    capped[k] = out[k]!;
  }
  return capped;
}

export function parseSuppressionUntilMs(v: unknown): number {
  return parseUntilMs(v);
}
