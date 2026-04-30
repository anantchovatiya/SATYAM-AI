import type { Collection, ObjectId } from "mongodb";
import type { WaMessage } from "@/lib/models/webhook-log";
import { canonicalWaContactKey, mongoMatchStoredWaFromForUser } from "@/lib/wa-phone";

/**
 * Prefer the exact JID we have seen for this number (LID vs @s.whatsapp.net) so QR sends deliver reliably.
 * Uses the same `from` variants as inbox/leads (10 vs 12 digit, etc.) so we don't miss the thread row.
 * Falls back to canonical MSISDN digits (e.g. 91…) for cold contacts so Baileys gets a consistent PN JID.
 */
export async function resolveQrRecipient(
  to: string,
  userId: ObjectId,
  messagesCol: Collection<WaMessage>
): Promise<string> {
  const rawDigits = to.replace(/\D/g, "");
  if (!rawDigits) return to;

  const canon = canonicalWaContactKey(rawDigits) || rawDigits;
  const threadFilter = mongoMatchStoredWaFromForUser(userId, canon);

  const recentByDigits = await messagesCol
    .find(threadFilter)
    .sort({ timestamp: -1 })
    .limit(8)
    .toArray();

  const withExactJid = recentByDigits.find(
    (m) => typeof m.remoteJid === "string" && m.remoteJid.includes("@")
  );
  if (withExactJid?.remoteJid) {
    return withExactJid.remoteJid;
  }

  if (recentByDigits[0]?.from) {
    const from = String(recentByDigits[0].from);
    if (from.includes(":")) {
      const base = (from.split(":")[0] ?? "").trim();
      if (base) return `${base}@lid`;
    }
    return canonicalWaContactKey(from) || from;
  }

  return canon;
}
