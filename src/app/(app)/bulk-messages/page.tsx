import { BulkMessagesClient } from "./bulk-messages-client";

export const dynamic = "force-dynamic";

export default function BulkMessagesPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Bulk template messages</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Send an approved WhatsApp template to many numbers. Outside the 24-hour chat window,{" "}
          <strong>only templates</strong> can start a conversation.
        </p>
      </div>
      <BulkMessagesClient />
    </div>
  );
}
