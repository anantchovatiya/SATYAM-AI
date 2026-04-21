import type { Db } from "mongodb";
import type { ObjectId } from "mongodb";
import {
  applyAgentFulfillmentFloor,
  geminiInterestScoreFromMessages,
  getLastMessagesForInterestScore,
  type IncomingMessage,
} from "@/lib/ai";
import { clampAiInterestScore0to100 } from "@/lib/interest-score";
import { leadsCollection } from "@/lib/models/lead";
import { getOrCreateSettings } from "@/lib/models/settings";
import { waMessagesCollection } from "@/lib/models/webhook-log";
import { syncAutoFollowupQueueFromLead } from "@/lib/auto-followup-queue";
import { canonicalWaContactKey, mongoMatchStoredWaFromForUser } from "@/lib/wa-phone";

/**
 * Recompute `interestScore` / Hot–New–Silent from Gemini on the last 5 messages, then persist.
 * Uses the same `from` matching as the rest of WhatsApp storage (canonical + variants).
 */
export async function refreshLeadInterestScoreFromWaThread(
  db: Db,
  userId: ObjectId,
  contactFromRaw: string,
  leadDisplayPhone: string
): Promise<void> {
  if (!process.env.GEMINI_API_KEY?.trim()) return;

  const messagesCol = waMessagesCollection(db);
  const leadsCol = leadsCollection(db);
  const canon = canonicalWaContactKey(contactFromRaw) || String(contactFromRaw);

  const recent = await messagesCol
    .find(mongoMatchStoredWaFromForUser(userId, canon))
    .sort({ timestamp: -1 })
    .limit(20)
    .toArray();
  if (recent.length === 0) return;

  const ctx: IncomingMessage[] = recent
    .reverse()
    .map((m) => ({
      text: m.text ?? "",
      direction: m.direction as "in" | "out",
      timestamp: m.timestamp.toISOString(),
    }));

  const window = getLastMessagesForInterestScore(ctx);
  const slice = window.length ? window : ctx;
  const gem = await geminiInterestScoreFromMessages(slice);
  let interestScore = clampAiInterestScore0to100(gem?.leadScore ?? 35);
  interestScore = applyAgentFulfillmentFloor(slice, interestScore);
  const status = interestScore >= 75 ? "Hot" : interestScore >= 35 ? "New" : "Silent";

  const lead = await leadsCol.findOne({ userId, phone: leadDisplayPhone });
  if (!lead?._id) return;

  await leadsCol
    .updateOne({ _id: lead._id }, { $set: { interestScore, status, updatedAt: new Date() } })
    .catch(() => {});

  const fresh = await leadsCol.findOne({ _id: lead._id });
  if (fresh) {
    const st = await getOrCreateSettings(db, userId);
    await syncAutoFollowupQueueFromLead(db, userId, fresh, st).catch(() => {});
  }
}
