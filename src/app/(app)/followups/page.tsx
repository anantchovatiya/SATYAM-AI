import { redirect } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { followupsCollection, followupDocToRow, isQueueFollowupDue } from "@/lib/models/followup";
import { leadsCollection } from "@/lib/models/lead";
import { AUTO_FOLLOWUP_QUEUE_TASK, isAutoFollowupCompletedTodayTask } from "@/lib/auto-followup-queue";
import { DbError } from "@/components/db-error";
import { FollowupsClient, type ReadyQueueLead } from "./followups-client";
import { getServerSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

function isQueuePendingRow(doc: { task: string; status: string }): boolean {
  return doc.task === AUTO_FOLLOWUP_QUEUE_TASK && doc.status === "Pending";
}

export default async function FollowupsPage() {
  try {
    const session = await getServerSessionUser();
    if (!session) redirect("/login");
    const { userId } = session;

    const db = await getDb();
    const fCol = followupsCollection(db);
    const lCol = leadsCollection(db);

    const [docs, silentLeads, pendingCount, doneCount, autoFollowupLogCount] = await Promise.all([
      fCol.find({ userId }).sort({ dueDate: 1 }).toArray(),
      lCol.find({ userId, status: "Silent" }).sort({ updatedAt: 1 }).limit(20).toArray(),
      fCol.countDocuments({ userId, status: "Pending" }),
      fCol.countDocuments({ userId, status: "Done" }),
      fCol.countDocuments({
        userId,
        $or: [
          { task: { $regex: /^Auto follow-up sent/i } },
          { task: { $regex: /^Auto follow-up blocked/i } },
        ],
      }),
    ]);

    const now = new Date();

    const seenReady = new Set<string>();
    const readyQueueLeads: ReadyQueueLead[] = [];
    const seenQueued = new Set<string>();
    const queuedQueueLeads: ReadyQueueLead[] = [];

    for (const doc of docs) {
      if (!isQueuePendingRow(doc)) continue;

      const due = new Date(doc.dueDate);
      if (isQueueFollowupDue(due, now)) {
        if (seenReady.has(doc.leadId)) continue;
        seenReady.add(doc.leadId);
        const r = followupDocToRow(doc);
        readyQueueLeads.push({
          followupId: doc._id!.toHexString(),
          leadId: doc.leadId,
          leadName: doc.leadName,
          phone: doc.phone,
          dueDateStr: r.dueDateStr,
        });
      } else {
        if (seenQueued.has(doc.leadId)) continue;
        seenQueued.add(doc.leadId);
        const r = followupDocToRow(doc);
        queuedQueueLeads.push({
          followupId: doc._id!.toHexString(),
          leadId: doc.leadId,
          leadName: doc.leadName,
          phone: doc.phone,
          dueDateStr: r.dueDateStr,
        });
      }
    }

    const taskDocs = docs.filter((doc) => {
      if (isQueuePendingRow(doc)) return false;
      if (isAutoFollowupCompletedTodayTask(doc.task)) return false;
      return true;
    });
    const taskRows = taskDocs.map(followupDocToRow);

    const silentRows = silentLeads.map((l) => ({
      id: l._id!.toHexString(),
      leadId: l._id!.toHexString(),
      leadName: l.name,
      phone: l.phone,
      task: `Follow up with ${l.name} — no reply since last contact`,
      dueDateStr: (() => {
        const diffDays = Math.round((Date.now() - l.updatedAt.getTime()) / 86_400_000);
        if (diffDays === 0) return "Today";
        if (diffDays === 1) return "Yesterday";
        return `${diffDays}d ago`;
      })(),
      owner: l.assignedTo || "Unassigned",
      status: "Pending" as const,
      notes: l.lastMessage,
    }));

    return (
      <FollowupsClient
        followups={taskRows}
        queuedQueueLeads={queuedQueueLeads}
        readyQueueLeads={readyQueueLeads}
        autoFollowupLogCount={autoFollowupLogCount}
        silentLeads={silentRows}
        stats={{ pending: pendingCount, done: doneCount, silent: silentLeads.length }}
      />
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return <DbError message={msg} />;
  }
}
