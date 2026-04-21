import { redirect } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { leadsCollection, docToRow } from "@/lib/models/lead";
import { LeadsTable } from "./leads-table";
import { DbError } from "@/components/db-error";
import { getServerSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  try {
    const session = await getServerSessionUser();
    if (!session) redirect("/login");
    const { userId } = session;

    const db = await getDb();
    const col = leadsCollection(db);
    const docs = await col.find({ userId }).sort({ createdAt: -1 }).toArray();
    return <LeadsTable initialLeads={docs.map(docToRow)} />;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return <DbError message={msg} />;
  }
}
