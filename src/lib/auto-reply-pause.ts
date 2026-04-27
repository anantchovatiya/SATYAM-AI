import { ObjectId, type Db } from "mongodb";
import { settingsCollection, type AutomationSettings } from "@/lib/models/settings";

/**
 * When the operator sends from the app (inbox), auto-reply is paused until this instant (UTC).
 * Controlled by `autoReplyPauseAfterManualMinutes` in settings; each manual send extends the window.
 */
export function isAutoReplySuppressedAfterManualSend(
  settings: AutomationSettings,
  now: Date = new Date()
): boolean {
  const u = settings.autoReplySuppressedUntil;
  if (!u) return false;
  const t = u instanceof Date ? u.getTime() : new Date(String(u)).getTime();
  return !Number.isNaN(t) && now.getTime() < t;
}

/**
 * After a successful manual outbound from the app, snooze auto-reply for the configured minutes.
 * No-op if `pauseMinutes` is 0 (feature off).
 */
export async function applyManualSendAutoReplySuppression(
  db: Db,
  userId: ObjectId,
  pauseMinutes: number
): Promise<void> {
  if (pauseMinutes <= 0) return;
  const until = new Date(Date.now() + pauseMinutes * 60_000);
  await settingsCollection(db).updateOne(
    { userId },
    { $set: { autoReplySuppressedUntil: until, updatedAt: new Date() } }
  );
}
