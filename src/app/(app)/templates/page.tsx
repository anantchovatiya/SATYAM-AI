import { redirect } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { templatesCollection, templateDocToRow } from "@/lib/models/template";
import { DbError } from "@/components/db-error";
import { TemplatesClient } from "./templates-client";
import { getServerSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  try {
    const session = await getServerSessionUser();
    if (!session) redirect("/login");
    const { userId } = session;

    const db  = await getDb();
    const col = templatesCollection(db);
    const docs = await col.find({ userId }).sort({ updatedAt: -1 }).toArray();
    return <TemplatesClient templates={docs.map(templateDocToRow)} />;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return <DbError message={msg} />;
  }
}
