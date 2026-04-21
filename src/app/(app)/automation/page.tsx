import { redirect } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { getOrCreateSettings, stripSettingsForClient } from "@/lib/models/settings";
import { AutomationClient } from "./automation-client";
import { DbError } from "@/components/db-error";
import { getServerSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AutomationPage() {
  try {
    const session = await getServerSessionUser();
    if (!session) redirect("/login");
    const { userId } = session;

    const db = await getDb();
    const settings = await getOrCreateSettings(db, userId);
    return <AutomationClient initial={stripSettingsForClient(settings)} />;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return <DbError message={msg} />;
  }
}
