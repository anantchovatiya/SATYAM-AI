import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { followupsCollection } from "@/lib/models/followup";
import { leadsCollection } from "@/lib/models/lead";
import { requireApiUser } from "@/lib/auth/session";
import { AUTO_FOLLOWUP_QUEUE_TASK } from "@/lib/auto-followup-queue";
import { sendAutoFollowupForLead } from "@/lib/automation-followup-for-lead";

/** True when the due instant is in the past or now (not “tomorrow” by clock). */
function isQueueDue(due: Date, now: Date): boolean {
  return new Date(due).getTime() <= now.getTime();
}

/**
 * POST { followupIds: string[] } — send for selected due queue rows (due time must have passed).
 */
export async function POST(_req: NextRequest) {
  try {
    const auth = await requireApiUser(_req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const body = (await _req.json().catch(() => ({}))) as { followupIds?: string[] };
    const requested = (Array.isArray(body.followupIds) ? body.followupIds : [])
      .map((s) => String(s).trim())
      .filter(Boolean);

    if (requested.length === 0) {
      return NextResponse.json(
        { error: "Select at least one follow-up in the ready queue list." },
        { status: 400 }
      );
    }

    const db = await getDb();
    const fCol = followupsCollection(db);
    const leadsCol = leadsCollection(db);
    const now = new Date();

    const queueDocs = await fCol
      .find({ userId, task: AUTO_FOLLOWUP_QUEUE_TASK, status: "Pending" })
      .sort({ dueDate: 1 })
      .toArray();

    const ready = queueDocs.filter((d) => isQueueDue(new Date(d.dueDate), now));
    const readyById = new Map(ready.map((d) => [d._id!.toHexString(), d] as const));

    const details: Array<{
      followupId: string;
      leadId: string;
      leadName: string;
      ok: boolean;
      reason?: string;
    }> = [];

    const seenLead = new Set<string>();
    let sent = 0;
    for (const followupId of requested) {
      if (!ObjectId.isValid(followupId)) {
        details.push({
          followupId,
          leadId: "",
          leadName: "—",
          ok: false,
          reason: "Invalid follow-up id",
        });
        continue;
      }

      const doc = readyById.get(followupId);
      if (!doc) {
        details.push({
          followupId,
          leadId: "",
          leadName: "—",
          ok: false,
          reason: "Not due yet, or not in the queue.",
        });
        continue;
      }

      if (seenLead.has(doc.leadId)) {
        continue;
      }
      seenLead.add(doc.leadId);

      if (!ObjectId.isValid(doc.leadId)) {
        details.push({ followupId, leadId: doc.leadId, leadName: doc.leadName, ok: false, reason: "Invalid lead id" });
        continue;
      }

      const lead = await leadsCol.findOne({ _id: new ObjectId(doc.leadId), userId });
      if (!lead) {
        details.push({ followupId, leadId: doc.leadId, leadName: doc.leadName, ok: false, reason: "Lead not found" });
        continue;
      }

      const result = await sendAutoFollowupForLead(userId, lead, { dryRun: false, fromManualQueue: true });
      if (result.ok && result.action === "sent") {
        sent += 1;
        details.push({ followupId, leadId: result.leadId, leadName: result.leadName, ok: true });
      } else {
        details.push({
          followupId,
          leadId: result.leadId,
          leadName: result.leadName,
          ok: false,
          reason: "reason" in result ? result.reason : "Send failed",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      processed: details.length,
      sent,
      failed: details.filter((d) => !d.ok).length,
      details,
    });
  } catch (err) {
    console.error("[POST /api/followups/queue-auto-send-bulk]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
