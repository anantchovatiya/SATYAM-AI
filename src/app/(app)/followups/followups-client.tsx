"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  User,
  MessageSquare,
  Zap,
  Loader2,
  ListChecks,
  Hourglass,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { FollowupRow } from "@/lib/models/followup";

interface SilentRow {
  id: string;
  leadId: string;
  leadName: string;
  phone: string;
  task: string;
  dueDateStr: string;
  owner: string;
  notes: string;
  status: "Pending";
}

export interface ReadyQueueLead {
  followupId: string;
  leadId: string;
  leadName: string;
  phone: string;
  dueDateStr: string;
}

interface Props {
  followups: FollowupRow[];
  /** Pending queue rows whose due time is not reached yet. */
  queuedQueueLeads: ReadyQueueLead[];
  readyQueueLeads: ReadyQueueLead[];
  /** Count of "Auto follow-up sent/blocked" log rows in DB (no list shown). */
  autoFollowupLogCount: number;
  silentLeads: SilentRow[];
  stats: { pending: number; done: number; silent: number };
}

const STATUS_STYLES: Record<string, string> = {
  Pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  Done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  Skipped: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  Pending: <Clock className="h-3.5 w-3.5" />,
  Done: <CheckCircle2 className="h-3.5 w-3.5" />,
  Skipped: <AlertCircle className="h-3.5 w-3.5" />,
};

type Tab = "tasks" | "silent";

export function FollowupsClient({
  followups,
  queuedQueueLeads,
  readyQueueLeads,
  autoFollowupLogCount,
  silentLeads,
  stats,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("tasks");
  const [items, setItems] = useState(followups);
  const [selectedReadyIds, setSelectedReadyIds] = useState<Set<string>>(
    () => new Set(readyQueueLeads.map((q) => q.followupId))
  );
  const [sendingBulk, setSendingBulk] = useState(false);
  const [purgingLog, setPurgingLog] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  useEffect(() => {
    setItems(followups);
  }, [followups]);

  useEffect(() => {
    setSelectedReadyIds(new Set(readyQueueLeads.map((q) => q.followupId)));
  }, [readyQueueLeads]);

  async function markDone(id: string) {
    setItems((prev) => prev.map((f) => (f.id === id ? { ...f, status: "Done" as const } : f)));
    await fetch("/api/followups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "Done" }),
    });
  }

  function toggleReadySelection(followupId: string) {
    setSelectedReadyIds((prev) => {
      const n = new Set(prev);
      if (n.has(followupId)) n.delete(followupId);
      else n.add(followupId);
      return n;
    });
  }

  function selectAllReady() {
    setSelectedReadyIds(new Set(readyQueueLeads.map((q) => q.followupId)));
  }

  function deselectAllReady() {
    setSelectedReadyIds(new Set());
  }

  async function purgeAutofollowupLog() {
    if (autoFollowupLogCount === 0) return;
    setSendError(null);
    setBulkMessage(null);
    setPurgingLog(true);
    try {
      const res = await fetch("/api/followups/sent-autofollowup-log", { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; deleted?: number };
      if (!res.ok) {
        setSendError(data.error ?? "Failed to remove log rows");
        return;
      }
      setBulkMessage(
        `Removed ${data.deleted ?? 0} auto follow-up log ${data.deleted === 1 ? "row" : "rows"} from the database.`
      );
      router.refresh();
    } catch {
      setSendError("Network error");
    } finally {
      setPurgingLog(false);
    }
  }

  async function sendQueueAutoFollowupSelected() {
    setSendError(null);
    setBulkMessage(null);
    const followupIds = Array.from(selectedReadyIds);
    if (followupIds.length === 0) {
      setSendError("Select at least one lead with the checkboxes.");
      return;
    }
    setSendingBulk(true);
    try {
      const res = await fetch("/api/followups/queue-auto-send-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followupIds }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        sent?: number;
        failed?: number;
        details?: Array<{ leadName: string; ok: boolean; reason?: string }>;
      };
      if (!res.ok) {
        setSendError(data.error ?? "Request failed");
        return;
      }
      if (data.ok) {
        const s = data.sent ?? 0;
        const f = data.failed ?? 0;
        const failures = (data.details ?? [])
          .filter((d) => !d.ok)
          .map((d) => `${d.leadName}: ${d.reason ?? "—"}`);
        setBulkMessage(
          f === 0
            ? `Sent auto follow-up to ${s} lead${s === 1 ? "" : "s"}.`
            : [`Sent ${s}, not sent ${f}.`, ...failures.slice(0, 8), failures.length > 8 ? "…" : ""]
                .filter(Boolean)
                .join("\n")
        );
        router.refresh();
      }
    } catch {
      setSendError("Network error");
    } finally {
      setSendingBulk(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Followups</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Queue and ready lists for auto follow-up, other tasks below, plus silent leads.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Pending follow-ups", value: stats.pending, color: "text-amber-600 dark:text-amber-400" },
          { label: "Completed", value: stats.done, color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Silent leads", value: stats.silent, color: "text-red-600 dark:text-red-400" },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <p className={cn("text-2xl font-bold", color)}>{value}</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{label}</p>
          </div>
        ))}
      </div>

      {queuedQueueLeads.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/50">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-slate-200 dark:bg-slate-800">
              <Hourglass className="h-5 w-5 text-slate-600 dark:text-slate-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Queue (waiting for due time)</h2>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                These leads are scheduled; they will move to &ldquo;Ready&rdquo; when the due time is reached.
              </p>
            </div>
          </div>
          <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200/80 bg-white/90 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900/50">
            {queuedQueueLeads.map((q) => (
              <li key={q.followupId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-slate-800 dark:text-slate-100">{q.leadName}</span>
                  <span className="ml-2 text-xs text-slate-500">{q.phone}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-500">Due: {q.dueDateStr}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {readyQueueLeads.length > 0 && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/40 dark:bg-violet-950/25">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/40">
                <ListChecks className="h-5 w-5 text-violet-600 dark:text-violet-300" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Ready (auto follow-up)</h2>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                  Due time has passed. Select leads and send WhatsApp follow-ups.
                </p>
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-violet-700 dark:text-violet-300">
                  <button type="button" onClick={selectAllReady} className="font-medium underline-offset-2 hover:underline">
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllReady}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    Deselect all
                  </button>
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={sendingBulk || selectedReadyIds.size === 0}
              onClick={sendQueueAutoFollowupSelected}
              className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-60 dark:bg-violet-700 dark:hover:bg-violet-600"
            >
              {sendingBulk ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Send to selected ({selectedReadyIds.size})
            </button>
          </div>
          <ul className="mt-4 divide-y divide-violet-100 rounded-xl border border-violet-100/80 bg-white/80 dark:divide-violet-900/30 dark:border-violet-900/40 dark:bg-slate-900/40">
            {readyQueueLeads.map((q) => (
              <li key={q.followupId} className="flex flex-wrap items-center gap-3 gap-y-2 px-3 py-2.5 text-sm">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 sm:flex-[2]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500 dark:border-slate-600 dark:bg-slate-800"
                    checked={selectedReadyIds.has(q.followupId)}
                    onChange={() => toggleReadySelection(q.followupId)}
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-slate-800 dark:text-slate-100">{q.leadName}</span>
                    <span className="ml-2 text-xs text-slate-500">{q.phone}</span>
                  </span>
                </label>
                <span className="w-full text-xs text-slate-500 sm:ml-auto sm:w-auto sm:text-right">Due: {q.dueDateStr}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {autoFollowupLogCount > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {autoFollowupLogCount} stored &ldquo;auto follow-up sent&rdquo; log {autoFollowupLogCount === 1 ? "row" : "rows"}{" "}
            (not shown here). Remove them from the database if you do not need the history.
          </p>
          <button
            type="button"
            disabled={purgingLog}
            onClick={purgeAutofollowupLog}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            {purgingLog ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Remove log from DB
          </button>
        </div>
      )}

      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900">
        {(["tasks", "silent"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-lg py-2 text-sm font-medium capitalize transition",
              tab === t
                ? "bg-white shadow-sm text-slate-900 dark:bg-slate-800 dark:text-white"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            )}
          >
            {t === "tasks" ? `Tasks (${items.length})` : `Silent Leads (${silentLeads.length})`}
          </button>
        ))}
      </div>

      {tab === "tasks" && (
        <div className="space-y-3">
          {sendError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {sendError}
            </p>
          )}
          {bulkMessage && (
            <p className="whitespace-pre-wrap rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
              {bulkMessage}
            </p>
          )}
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 py-16 dark:border-slate-800">
              <CheckCircle2 className="h-10 w-10 text-slate-300 dark:text-slate-700" />
              <p className="text-slate-500">No followup tasks yet.</p>
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-panel dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30">
                  <User className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800 dark:text-slate-100">{item.task}</p>
                  {item.notes && <p className="mt-1 text-xs text-slate-400 line-clamp-1">{item.notes}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Due: {item.dueDateStr}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" /> {item.owner}
                    </span>
                  </div>
                </div>
                <div className="flex min-w-[7rem] flex-shrink-0 flex-col items-stretch gap-2 sm:items-end">
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      STATUS_STYLES[item.status]
                    )}
                  >
                    {STATUS_ICON[item.status]}
                    {item.status}
                  </span>
                  {item.status === "Pending" && (
                    <button
                      type="button"
                      onClick={() => markDone(item.id)}
                      className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition dark:bg-emerald-900/20 dark:text-emerald-400"
                    >
                      Mark Done
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "silent" && (
        <div className="space-y-3">
          {silentLeads.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 py-16 dark:border-slate-800">
              <MessageSquare className="h-10 w-10 text-slate-300 dark:text-slate-700" />
              <p className="text-slate-500">No silent leads — great job!</p>
            </div>
          ) : (
            silentLeads.map((lead) => (
              <div
                key={lead.id}
                className="flex items-start gap-4 rounded-2xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20"
              >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  {lead.leadName[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800 dark:text-slate-100">{lead.leadName}</p>
                  <p className="text-xs text-slate-500">{lead.phone}</p>
                  {lead.notes && (
                    <p className="mt-1 text-xs text-slate-400 italic line-clamp-1">Last: &ldquo;{lead.notes}&rdquo;</p>
                  )}
                </div>
                <div className="text-right text-xs text-slate-400">
                  <p>{lead.dueDateStr}</p>
                  <p className="mt-0.5 font-medium text-amber-600 dark:text-amber-400">Silent</p>
                  <p className="mt-0.5">{lead.owner}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
