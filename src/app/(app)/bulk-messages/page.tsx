import { BulkMessagesClient } from "./bulk-messages-client";

export const dynamic = "force-dynamic";

export default function BulkMessagesPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Bulk messages</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Use <strong>Meta templates</strong> for cold outreach (Cloud API), or{" "}
          <strong>QR session</strong> for personalized text and photos to people you can message from your linked phone
          (runs where your QR session is connected — usually local).
        </p>
      </div>
      <BulkMessagesClient />
    </div>
  );
}
