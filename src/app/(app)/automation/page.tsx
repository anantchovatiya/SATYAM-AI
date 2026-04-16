import { getDb } from "@/lib/mongodb";
import { getOrCreateSettings } from "@/lib/models/settings";
import { AutomationClient } from "./automation-client";
import { DbError } from "@/components/db-error";

export const dynamic = "force-dynamic";

export default async function AutomationPage() {
  try {
    const db = await getDb();
    const settings = await getOrCreateSettings(db);

    // Strip _id (not serialisable) before passing to client component
    const { _id, ...initial } = settings as typeof settings & { _id?: unknown };
    void _id;

    return <AutomationClient initial={initial} />;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return <DbError message={msg} />;
  }
}
