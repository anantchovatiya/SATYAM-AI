import { getDb } from "@/lib/mongodb";
import { leadsCollection, docToRow } from "@/lib/models/lead";
import { LeadsTable } from "./leads-table";
import { DbError } from "@/components/db-error";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  try {
    const db = await getDb();
    const col = leadsCollection(db);
    const docs = await col.find({}).sort({ createdAt: -1 }).toArray();
    return <LeadsTable initialLeads={docs.map(docToRow)} />;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return <DbError message={msg} />;
  }
}
