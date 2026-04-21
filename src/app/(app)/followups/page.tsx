import { redirect } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { followupsCollection, followupDocToRow } from "@/lib/models/followup";
import { leadsCollection } from "@/lib/models/lead";
import { DbError } from "@/components/db-error";
import { FollowupsClient } from "./followups-client";
import { getServerSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function FollowupsPage() {
  try {
    const session = await getServerSessionUser();
    if (!session) redirect("/login");
    const { userId } = session;

    const db  = await getDb();
    const fCol = followupsCollection(db);
    const lCol = leadsCollection(db);

    const [docs, silentLeads, pendingCount, doneCount] = await Promise.all([
      fCol.find({ userId }).sort({ dueDate: 1 }).toArray(),
      lCol.find({ userId, status: "Silent" }).sort({ updatedAt: 1 }).limit(20).toArray(),
      fCol.countDocuments({ userId, status: "Pending" }),
      fCol.countDocuments({ userId, status: "Done" }),
    ]);

    const rows = docs.map(followupDocToRow);

    // Also show silent leads as implicit followups (leads that haven't replied)
    const silentRows = silentLeads.map((l) => ({
      id: l._id!.toHexString(),
      leadId: l._id!.toHexString(),
      leadName: l.name,
      phone: l.phone,
      task: `Follow up with ${l.name} — no reply since last contact`,
      dueDate: l.updatedAt,
      dueDateStr: (() => {
        const diffDays = Math.round((Date.now() - l.updatedAt.getTime()) / 86_400_000);
        if (diffDays === 0) return "Today";
        if (diffDays === 1) return "Yesterday";
        return `${diffDays}d ago`;
      })(),
      owner: l.assignedTo || "Unassigned",
      status: "Pending" as const,
      notes: l.lastMessage,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    }));

    return (
      <FollowupsClient
        followups={rows}
        silentLeads={silentRows}
        stats={{ pending: pendingCount, done: doneCount, silent: silentLeads.length }}
      />
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return <DbError message={msg} />;
  }
}
