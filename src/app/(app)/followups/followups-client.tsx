"use client";

import { useState } from "react";
import { CheckCircle2, Clock, AlertCircle, User, MessageSquare } from "lucide-react";
import { cn } from "@/lib/cn";
import type { FollowupRow } from "@/lib/models/followup";

interface SilentRow {
  id: string; leadId: string; leadName: string; phone: string;
  task: string; dueDateStr: string; owner: string; notes: string;
  status: "Pending";
}

interface Props {
  followups: FollowupRow[];
  silentLeads: SilentRow[];
  stats: { pending: number; done: number; silent: number };
}

const STATUS_STYLES: Record<string, string> = {
  Pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  Done:    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  Skipped: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  Pending: <Clock className="h-3.5 w-3.5" />,
  Done:    <CheckCircle2 className="h-3.5 w-3.5" />,
  Skipped: <AlertCircle className="h-3.5 w-3.5" />,
};

type Tab = "tasks" | "silent";

export function FollowupsClient({ followups, silentLeads, stats }: Props) {
  const [tab, setTab] = useState<Tab>("tasks");
  const [items, setItems] = useState(followups);

  async function markDone(id: string) {
    setItems((prev) => prev.map((f) => f.id === id ? { ...f, status: "Done" as const } : f));
    await fetch("/api/followups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "Done" }),
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Followups</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Important leads who have not messaged since their last chat (queued auto follow-up), manual tasks, and silent leads.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Pending tasks", value: stats.pending, color: "text-amber-600 dark:text-amber-400" },
          { label: "Completed",     value: stats.done,    color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Silent leads",  value: stats.silent,  color: "text-red-600 dark:text-red-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className={cn("text-2xl font-bold", color)}>{value}</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900">
        {(["tasks", "silent"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-lg py-2 text-sm font-medium capitalize transition",
              tab === t
                ? "bg-white shadow-sm dark:bg-slate-800 text-slate-900 dark:text-white"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            )}
          >
            {t === "tasks" ? `Tasks (${items.length})` : `Silent Leads (${silentLeads.length})`}
          </button>
        ))}
      </div>

      {/* Task list */}
      {tab === "tasks" && (
        <div className="space-y-3">
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
                  {item.notes && (
                    <p className="mt-1 text-xs text-slate-400 line-clamp-1">{item.notes}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Due: {item.dueDateStr}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" /> {item.owner}
                    </span>
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-2">
                  <span className={cn("flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_STYLES[item.status])}>
                    {STATUS_ICON[item.status]}
                    {item.status}
                  </span>
                  {item.status === "Pending" && (
                    <button
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

      {/* Silent leads */}
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
                    <p className="mt-1 text-xs text-slate-400 italic line-clamp-1">
                      Last: &ldquo;{lead.notes}&rdquo;
                    </p>
                  )}
                </div>
                <div className="text-right text-xs text-slate-400">
                  <p>{lead.dueDateStr}</p>
                  <p className="mt-0.5 text-amber-600 dark:text-amber-400 font-medium">Silent</p>
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
