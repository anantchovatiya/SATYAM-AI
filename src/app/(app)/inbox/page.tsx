import { DbError } from "@/components/db-error";
import { InboxClient } from "./inbox-client";
import { getInboxContacts } from "@/lib/inbox";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  try {
    const contacts = await getInboxContacts(400);

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
