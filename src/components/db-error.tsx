import { AlertTriangle } from "lucide-react";

export function DbError({ message }: { message?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100 dark:bg-red-900/30">
        <AlertTriangle className="h-8 w-8 text-red-500" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
          Cannot connect to MongoDB
        </h2>
        <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
          {message ?? "Connection refused. Check your Atlas IP allowlist and credentials."}
        </p>
      </div>
      <div className="mt-2 w-full max-w-md rounded-xl border border-red-200 bg-red-50 p-4 text-left text-xs text-red-700 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-300">
        <p className="font-semibold mb-2">Fix checklist:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>
            Go to{" "}
            <a
              href="https://cloud.mongodb.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              cloud.mongodb.com
            </a>{" "}
            → <strong>Network Access</strong>
          </li>
          <li>
            Click <strong>+ Add IP Address</strong> → choose{" "}
            <strong>Allow Access from Anywhere</strong> (0.0.0.0/0)
          </li>
          <li>Confirm and wait ~15 seconds, then refresh this page</li>
          <li>
            Also verify <strong>Database Access</strong> user{" "}
            <code className="bg-red-100 dark:bg-red-900/40 px-1 rounded">satyam</code> has{" "}
            <strong>readWriteAnyDatabase</strong> role
          </li>
        </ol>
      </div>
    </div>
  );
}
