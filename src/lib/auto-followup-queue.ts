import type { Db, ObjectId } from "mongodb";
import { followupsCollection } from "@/lib/models/followup";
import type { LeadDoc } from "@/lib/models/lead";

/**
 * Pending follow-up on the Follow-ups list: **important** (interest ≥ threshold when set) and
 * **the lead has not messaged again** since their last inbound — i.e. you already replied (or reached out)
 * and the clock is `followUpDelayDays` from **their** last message. When they write again, the row is
 * removed or the due date resets if they still qualify.
 */
export const AUTO_FOLLOWUP_QUEUE_TASK = "[Queue] Auto follow-up";

const MS_PER_DAY = 86_400_000;

/** True for completed auto follow-up rows that should count toward the “once per day” send cap. */
export function isAutoFollowupCompletedTodayTask(task: string): boolean {
  return /^Auto follow-up (sent|blocked)/i.test(task);
}

export async function clearAutoFollowupQueueTask(db: Db, userId: ObjectId, leadId: string): Promise<void> {
  await followupsCollection(db).deleteMany({
    userId,
    leadId,
    task: AUTO_FOLLOWUP_QUEUE_TASK,
    status: "Pending",
  });
}

/**
 * Upsert or remove the queued follow-up row when:
 * — **Waiting on the lead**: your last outbound is at/after their last inbound (they have not written again).
 * — **Important enough**: interest score ≥ minimum when a minimum is set.
 * — Not in handover / closed.
 *
 * `dueDate` = their last inbound + delay → aligns with “no chat from them for X days” before auto nudge.
 */
export async function syncAutoFollowupQueueFromLead(
  db: Db,
  userId: ObjectId,
  lead: LeadDoc,
  settings: { followUpDelayDays: number; followUpMinInterestScore?: number }
): Promise<void> {
  const col = followupsCollection(db);
  const leadId = lead._id?.toHexString();
  if (!leadId) return;

  const filter = {
    userId,
    leadId,
    task: AUTO_FOLLOWUP_QUEUE_TASK,
    status: "Pending" as const,
  };

  if (lead.needsHuman || lead.status === "Closed") {
    await col.deleteMany(filter);
    return;
  }

  const lastIn = lead.lastInboundAt;
  if (!lastIn) {
    await col.deleteMany(filter);
    return;
  }

  const inTs = new Date(lastIn).getTime();
  const outTs = lead.lastOutboundAt ? new Date(lead.lastOutboundAt).getTime() : 0;
  // Lead spoke last and we have not replied yet — not “pending follow-up” in the CRM sense.
  const awaitingOurReply = !lead.lastOutboundAt || inTs > outTs;
  if (awaitingOurReply) {
    await col.deleteMany(filter);
    return;
  }

  const minScore = typeof settings.followUpMinInterestScore === "number" ? settings.followUpMinInterestScore : 0;
  const score = lead.interestScore ?? 0;
  const scoreOk = minScore <= 0 || score >= minScore;
  if (!scoreOk) {
    await col.deleteMany(filter);
    return;
  }

  const delayDays = Math.max(1, Math.round(settings.followUpDelayDays) || 1);
  const due = new Date(inTs + delayDays * MS_PER_DAY);
  const now = new Date();
  const lastInDay = new Date(lastIn).toISOString().slice(0, 10);

  await col.updateOne(
    filter,
    {
      $set: {
        userId,
        leadId,
        leadName: lead.name,
        phone: lead.phone,
        task: AUTO_FOLLOWUP_QUEUE_TASK,
        dueDate: due,
        owner: lead.assignedTo || "Unassigned",
        status: "Pending",
        notes: `Important lead (score ${Math.round(score)}, min ${minScore}) · no new message from them since ${lastInDay} · nudge due ${due.toISOString().slice(0, 10)} (${delayDays}d after their last message)`,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
}
