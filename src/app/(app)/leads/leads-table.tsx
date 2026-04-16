"use client";

import { useState, useTransition } from "react";
import { type LeadRow, type LeadStatus } from "@/lib/models/lead";
import { cn } from "@/lib/cn";
import { Archive, Flame, MessageSquare, UserCheck, X, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

// ── Constants ──────────────────────────────────────────────────────────────

type Filter = "All" | LeadStatus;
const FILTERS: Filter[] = ["All", "New", "Hot", "Silent", "Closed"];
const SALESPEOPLE = ["Satyam", "Neha", "Rahul", "Priya", "Dev"];

const STATUS_STYLES: Record<LeadStatus, string> = {
  New: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  Hot: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  Silent: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  Closed: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 75 ? "bg-emerald-500" : score >= 45 ? "bg-amber-400" : "bg-slate-300 dark:bg-slate-600";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs tabular-nums">{score}</span>
    </div>
  );
}

function AssignModal({
  lead,
  onClose,
  onAssign,
}: {
  lead: LeadRow;
  onClose: () => void;
  onAssign: (name: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="font-semibold">Assign Salesperson</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{lead.name}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2">
          {SALESPEOPLE.map((person) => (
            <button
              key={person}
              onClick={() => { onAssign(person); onClose(); }}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800",
                lead.assignedTo === person && "bg-primary/10 font-medium text-primary",
              )}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                {person[0]}
              </span>
              {person}
              {lead.assignedTo === person && (
                <span className="ml-auto text-xs text-primary">current</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function LeadsTable({ initialLeads }: { initialLeads: LeadRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [filter, setFilter] = useState<Filter>("All");
  const [rows, setRows] = useState<LeadRow[]>(initialLeads);
  const [assignTarget, setAssignTarget] = useState<LeadRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function patchLead(id: string, patch: Partial<LeadRow>) {
    setLoadingId(id);
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated: LeadRow = await res.json();
      setRows((prev) => prev.map((l) => (l.id === id ? updated : l)));
      startTransition(() => router.refresh());
    } catch (e) {
      showToast("Error updating lead.");
      console.error(e);
    } finally {
      setLoadingId(null);
    }
  }

  function markHot(lead: LeadRow) {
    patchLead(lead.id, { status: "Hot" });
    showToast(`${lead.name} marked as Hot 🔥`);
  }

  function archiveLead(lead: LeadRow) {
    patchLead(lead.id, { status: "Closed" });
    showToast(`${lead.name} archived.`);
  }

  function assignPerson(id: string, name: string) {
    patchLead(id, { assignedTo: name });
    showToast(`Assigned to ${name}.`);
  }

  const visible = filter === "All" ? rows : rows.filter((l) => l.status === filter);

  const counts: Record<Filter, number> = {
    All: rows.length,
    New: rows.filter((l) => l.status === "New").length,
    Hot: rows.filter((l) => l.status === "Hot").length,
    Silent: rows.filter((l) => l.status === "Silent").length,
    Closed: rows.filter((l) => l.status === "Closed").length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Manage prospects, track scores, and drive conversions.
          </p>
        </div>
        <p className="flex items-center gap-2 text-sm text-slate-400 dark:text-slate-500">
          {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          {visible.length} lead{visible.length !== 1 && "s"} shown
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition",
              filter === f
                ? "border-primary bg-primary text-white shadow-sm"
                : "border-slate-200 bg-white text-slate-600 hover:border-primary/40 hover:text-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
            )}
          >
            {f}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-xs",
                filter === f
                  ? "bg-white/20 text-white"
                  : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
              )}
            >
              {counts[f]}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-panel dark:border-slate-800 dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 max-w-[180px]">Last Message</th>
              <th className="px-4 py-3">Interest Score</th>
              <th className="px-4 py-3">Assigned To</th>
              <th className="px-4 py-3">Last Followup</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="py-16 text-center text-slate-400 dark:text-slate-500">
                  No leads found. Add your first lead or check MongoDB.
                </td>
              </tr>
            )}
            {visible.map((lead) => {
              const busy = loadingId === lead.id;
              return (
                <tr
                  key={lead.id}
                  className={cn(
                    "group border-t border-slate-100 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40",
                    busy && "opacity-60",
                  )}
                >
                  {/* Name */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {lead.name[0]}
                      </span>
                      <div>
                        <p className="font-medium text-slate-900 dark:text-slate-100">{lead.name}</p>
                        <p className="text-xs text-slate-400">{lead.source}</p>
                      </div>
                    </div>
                  </td>

                  {/* Phone */}
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">
                    {lead.phone}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_STYLES[lead.status])}>
                      {lead.status}
                    </span>
                  </td>

                  {/* Last message */}
                  <td className="max-w-[180px] px-4 py-3">
                    <p className="truncate text-slate-500 dark:text-slate-400" title={lead.lastMessage}>
                      {lead.lastMessage}
                    </p>
                  </td>

                  {/* Score */}
                  <td className="px-4 py-3">
                    <ScoreBar score={lead.interestScore} />
                  </td>

                  {/* Assigned to */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-bold dark:bg-slate-700">
                        {lead.assignedTo[0]}
                      </span>
                      <span className="text-slate-700 dark:text-slate-300">{lead.assignedTo}</span>
                    </div>
                  </td>

                  {/* Last followup */}
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500 dark:text-slate-400">
                    {lead.lastFollowup}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        title="Open Chat"
                        onClick={() => showToast(`Opening chat with ${lead.name}…`)}
                        disabled={busy}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/30 dark:hover:text-blue-400 disabled:opacity-40"
                      >
                        <MessageSquare className="h-4 w-4" />
                      </button>

                      <button
                        title="Mark Hot"
                        onClick={() => markHot(lead)}
                        disabled={busy || lead.status === "Hot"}
                        className={cn(
                          "rounded-lg p-1.5 transition disabled:cursor-default disabled:opacity-40",
                          lead.status === "Hot"
                            ? "text-red-400"
                            : "text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400",
                        )}
                      >
                        <Flame className="h-4 w-4" />
                      </button>

                      <button
                        title="Assign Salesperson"
                        onClick={() => setAssignTarget(lead)}
                        disabled={busy}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-violet-50 hover:text-violet-600 disabled:opacity-40 dark:hover:bg-violet-900/30 dark:hover:text-violet-400"
                      >
                        <UserCheck className="h-4 w-4" />
                      </button>

                      <button
                        title="Archive"
                        onClick={() => archiveLead(lead)}
                        disabled={busy || lead.status === "Closed"}
                        className={cn(
                          "rounded-lg p-1.5 transition disabled:cursor-default disabled:opacity-40",
                          lead.status === "Closed"
                            ? "text-slate-300 dark:text-slate-600"
                            : "text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200",
                        )}
                      >
                        <Archive className="h-4 w-4" />
                      </button>

                      {busy && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Assign modal */}
      {assignTarget && (
        <AssignModal
          lead={assignTarget}
          onClose={() => setAssignTarget(null)}
          onAssign={(name) => assignPerson(assignTarget.id, name)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {toast}
        </div>
      )}
    </div>
  );
}
