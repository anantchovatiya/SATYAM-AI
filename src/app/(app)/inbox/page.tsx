import { redirect } from "next/navigation";
import { DbError } from "@/components/db-error";
import { InboxClient } from "./inbox-client";
import { getInboxContacts } from "@/lib/inbox";
import { getServerSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  try {
    const session = await getServerSessionUser();
    if (!session) redirect("/login");
    const contacts = await getInboxContacts(session.userId, 400);

    return (
      <div className="-m-4 md:-m-6 h-[calc(100vh-4rem)]">
        <InboxClient initialContacts={contacts} />
      </div>
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return <DbError message={msg} />;
  }
}
