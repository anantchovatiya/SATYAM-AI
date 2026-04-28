import { ObjectId, type Db } from "mongodb";
import { settingsCollection, type AutomationSettings } from "@/lib/models/settings";
import { canonicalWaContactKey } from "@/lib/wa-phone";
import {
  mergeContactSuppressionMap,
  parseSuppressionUntilMs,
} from "@/lib/auto-reply-suppression-map";

/**
 * When the operator sends from the app (inbox) to a contact, auto-reply is paused for that contact only
 * until the stored instant (UTC). Controlled by `autoReplyPauseAfterManualMinutes` (0 = off).
 */
export function isAutoReplySuppressedAfterManualSend(
  settings: AutomationSettings,
  inboundContactRaw: string,
  now: Date = new Date()
): boolean {
  const c = canonicalWaContactKey(inboundContactRaw);
  if (!c) return false;
  const map = settings.autoReplySuppressedUntilByContact;
  if (!map || typeof map !== "object") return false;
  const u = (map as Record<string, unknown>)[c];
  if (u === undefined) return false;
  const t = parseSuppressionUntilMs(u);
  return t > 0 && now.getTime() < t;
}

export function autoReplySuppressionResumeAtIso(
  settings: AutomationSettings,
  inboundContactRaw: string
): string | null {
  const c = canonicalWaContactKey(inboundContactRaw);
  if (!c) return null;
  const map = settings.autoReplySuppressedUntilByContact;
  if (!map || typeof map !== "object") return null;
  const u = (map as Record<string, unknown>)[c];
  if (u === undefined) return null;
  const d = u instanceof Date ? u : new Date(String(u));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * After a successful manual outbound from the app, snooze auto-reply for that contact only.
 * No-op if `pauseMinutes` is 0 (feature off).
 */
export async function applyManualSendAutoReplySuppression(
  db: Db,
  userId: ObjectId,
  pauseMinutes: number,
  contactCanonicalRaw: string
): Promise<void> {
  if (pauseMinutes <= 0) return;
  const c = canonicalWaContactKey(contactCanonicalRaw);
  if (!c) return;
  const until = new Date(Date.now() + pauseMinutes * 60_000);
  const col = settingsCollection(db);
  const doc = await col.findOne({ userId });
  const merged = mergeContactSuppressionMap(doc?.autoReplySuppressedUntilByContact, c, until);
  await col.updateOne(
    { userId },
    {
      $set: {
        autoReplySuppressedUntilByContact: merged,
        updatedAt: new Date(),
      },
      $unset: { autoReplySuppressedUntil: "" },
    },
    { upsert: true }
  );
}
