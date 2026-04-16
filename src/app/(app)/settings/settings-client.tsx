"use client";

import Link from "next/link";
import { BarChart2, Flame, Users, TrendingUp, MessageSquare, ExternalLink } from "lucide-react";

interface Stats {
  total: number; closed: number; hot: number; silent: number;
  convRate: string; topSource: string; topTmpl: string;
}

export function SettingsClient({ stats }: { stats: Stats }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Workspace overview and quick links
        </p>
      </div>

      {/* Real analytics summary */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-2">
          <BarChart2 className="h-5 w-5 text-violet-500" />
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">Live Analytics Summary</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { label: "Total Leads",     value: stats.total,     icon: Users,        color: "text-violet-600 dark:text-violet-400" },
            { label: "Hot Leads",       value: stats.hot,       icon: Flame,        color: "text-red-600 dark:text-red-400" },
            { label: "Closed",          value: stats.closed,    icon: TrendingUp,   color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Silent",          value: stats.silent,    icon: MessageSquare,color: "text-amber-600 dark:text-amber-400" },
            { label: "Conversion Rate", value: stats.convRate,  icon: TrendingUp,   color: "text-blue-600 dark:text-blue-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`h-3.5 w-3.5 ${color}`} />
                <p className="text-xs text-slate-400">{label}</p>
              </div>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
            <p className="text-xs text-slate-400 mb-1">Top Source</p>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{stats.topSource}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Top template: <span className="font-medium text-slate-600 dark:text-slate-300">{stats.topTmpl}</span>
        </p>
      </div>

      {/* Quick navigation links */}
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { href: "/automation",  label: "Automation Settings",  desc: "Auto-reply, follow-up delays, AI tone, WhatsApp templates" },
          { href: "/analytics",   label: "Analytics Dashboard",  desc: "Charts, daily leads, conversion funnel, salesperson leaderboard" },
          { href: "/leads",       label: "Leads Manager",        desc: "View, filter, assign and archive all leads" },
          { href: "/templates",   label: "Message Templates",    desc: "Create and manage reusable WhatsApp / Email / SMS templates" },
          { href: "/followups",   label: "Followups",            desc: "Pending tasks and silent leads that need attention" },
          { href: "/inbox",       label: "Inbox",                desc: "WhatsApp-style chat view with all incoming messages" },
        ].map(({ href, label, desc }) => (
          <Link
            key={href}
            href={href}
            className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-panel hover:border-violet-300 hover:shadow-md transition dark:border-slate-800 dark:bg-slate-900 dark:hover:border-violet-700"
          >
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-100">{label}</p>
              <p className="mt-0.5 text-xs text-slate-400">{desc}</p>
            </div>
            <ExternalLink className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-300 dark:text-slate-600" />
          </Link>
        ))}
      </div>
    </div>
  );
}
