import type { Collection, ObjectId } from "mongodb";
import type { WaMessage } from "@/lib/models/webhook-log";

/**
 * Prefer the exact JID we have seen for this number (LID vs @s.whatsapp.net) so QR sends deliver reliably.
 */
export async function resolveQrRecipient(
  to: string,
  userId: ObjectId,
  messagesCol: Collection<WaMessage>
): Promise<string> {
  const digits = to.replace(/\D/g, "");
  if (!digits) return to;

  const recentByDigits = await messagesCol
    .find({ userId, from: { $regex: `^${digits}(?::\\d+)?$` } })
    .sort({ timestamp: -1 })
    .limit(5)
    .toArray();

  const withExactJid = recentByDigits.find(
    (m) => typeof m.remoteJid === "string" && m.remoteJid.includes("@")
  );
  if (withExactJid?.remoteJid) {
    return withExactJid.remoteJid;
  }

  if (recentByDigits[0]?.from) {
    const from = String(recentByDigits[0].from);
    return from.includes(":") ? `${from}@lid` : from;
  }

  return to;
}
