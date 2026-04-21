import { redirect } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { leadsCollection } from "@/lib/models/lead";
import { templatesCollection } from "@/lib/models/template";
import { DbError } from "@/components/db-error";
import { SettingsClient } from "./settings-client";
import { getServerSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  try {
    const session = await getServerSessionUser();
    if (!session) redirect("/login");
    const { userId } = session;

    const db   = await getDb();
    const lCol = leadsCollection(db);
    const tCol = templatesCollection(db);

    const [total, closed, hot, silent, topSourceArr, topTemplateArr] = await Promise.all([
      lCol.countDocuments({ userId }),
      lCol.countDocuments({ userId, status: "Closed" }),
      lCol.countDocuments({ userId, status: "Hot" }),
      lCol.countDocuments({ userId, status: "Silent" }),
      lCol.aggregate<{ _id: string; count: number }>([
        { $match: { userId } },
        { $group: { _id: "$source", count: { $sum: 1 } } },
        { $sort:  { count: -1 } },
        { $limit: 1 },
      ]).toArray(),
      tCol.aggregate<{ _id: string; count: number }>([
        { $match: { userId } },
        { $sort:  { usageCount: -1 } },
        { $limit: 1 },
        { $project: { _id: "$name", count: "$usageCount" } },
      ]).toArray(),
    ]);

    const convRate  = total > 0 ? ((closed / total) * 100).toFixed(1) + "%" : "—";
    const topSource = topSourceArr[0]?._id ?? "—";
    const topTmpl   = topTemplateArr[0]?._id ?? "—";

    return (
      <SettingsClient
        stats={{ total, closed, hot, silent, convRate, topSource, topTmpl }}
      />
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return <DbError message={msg} />;
  }
}
