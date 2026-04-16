"use client";

import {
  AreaChart, Area,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import type { AnalyticsSummary, SalespersonStat } from "@/lib/analytics-data";
import { cn } from "@/lib/cn";
import {
  Clock, Flame, MessageSquare, TrendingUp, Users, Zap, BarChart2,
} from "lucide-react";

const PRIMARY   = "#7c3aed";
const AMBER     = "#f59e0b";
const BLUE      = "#3b82f6";
const ROSE      = "#f43f5e";
const GRID      = "rgba(148,163,184,0.15)";
const TICK_FILL = "#94a3b8";
const tooltipStyle = {
  backgroundColor: "var(--tooltip-bg,#1e293b)",
  border: "1px solid rgba(148,163,184,0.2)",
  borderRadius: "10px",
  color: "#f1f5f9",
  fontSize: "12px",
};

function StatCard({ label, value, sub, icon: Icon, color = "text-violet-600 dark:text-violet-400" }: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; color?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-panel dark:border-slate-800 dark:bg-slate-900">
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800", color)}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-3xl font-bold text-slate-900 dark:text-white">{value}</p>
        <p className="mt-0.5 text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{sub}</p>}
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, children, className }: {
  title: string; subtitle?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-slate-200 bg-white p-5 shadow-panel dark:border-slate-800 dark:bg-slate-900", className)}>
      <div className="mb-4">
        <h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[200px] flex-col items-center justify-center gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/40">
      <BarChart2 className="h-8 w-8 text-slate-300 dark:text-slate-700" />
      <p className="text-xs text-slate-400">No {label} data yet</p>
    </div>
  );
}

function LeaderboardRow({ sp, rank }: { sp: SalespersonStat; rank: number }) {
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
      <span className="w-5 flex-shrink-0 text-center text-sm font-semibold text-slate-400">
        {medal ?? rank}
      </span>
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
        {sp.avatar}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{sp.name}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {sp.leads} leads · {sp.hot} hot
        </p>
      </div>
      <div className="hidden sm:flex items-center gap-4 text-sm">
        <div className="text-center">
          <p className="font-semibold text-slate-800 dark:text-slate-100">{sp.closed}</p>
          <p className="text-xs text-slate-400">Closed</p>
        </div>
        <div className="text-center">
          <p className="font-semibold text-emerald-600 dark:text-emerald-400">{sp.convRate}%</p>
          <p className="text-xs text-slate-400">Conv.</p>
        </div>
      </div>
      <div className="hidden md:block w-24">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${sp.convRate}%` }} />
          </div>
          <span className="text-xs text-slate-400 w-7 text-right">{sp.convRate}%</span>
        </div>
      </div>
    </div>
  );
}

export function AnalyticsClient({ data }: { data: AnalyticsSummary }) {
  const chartDaily = data.daily.slice(-14);
  const hasLeadData    = data.daily.some((d) => d.leads > 0);
  const hasReplyData   = data.daily.some((d) => d.replies > 0);
  const hasFollowData  = data.daily.some((d) => d.followups > 0);
  const hasRespData    = data.responseTimeByDay.some((d) => d.minutes > 0);
  const hasLeaderboard = data.salesperson.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            All metrics are live from your MongoDB database
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Live data
        </span>
      </div>

      {/* Stat cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard label="Total Leads"      value={String(data.totalLeads)}   icon={Users}         color="text-violet-600 dark:text-violet-400" sub="All time" />
        <StatCard label="Replies Sent"     value={String(data.repliesSent)}  icon={MessageSquare} color="text-blue-600 dark:text-blue-400"    sub="Via WhatsApp" />
        <StatCard label="Followups"        value={String(data.followupsSent)}icon={Zap}           color="text-amber-600 dark:text-amber-400"  sub="Total tasks" />
        <StatCard label="Conversion Rate"  value={`${data.conversionRate}%`} icon={TrendingUp}    color="text-emerald-600 dark:text-emerald-400" sub="Leads → Closed" />
        <StatCard label="Avg Response"     value={data.avgResponseMin > 0 ? `${data.avgResponseMin}m` : "—"}
                                           icon={Clock}         color="text-rose-600 dark:text-rose-400"
                                           sub={data.avgResponseMin > 0 ? "From real messages" : "No messages yet"} />
        <StatCard label="Hot Leads"        value={String(data.hotLeads)}     icon={Flame}         color="text-red-600 dark:text-red-400"      sub="High intent" />
      </section>

      {/* Daily leads + replies */}
      <section className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Daily Leads" subtitle="New leads captured — last 14 days">
          {hasLeadData ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartDaily} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradLeads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={PRIMARY} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={PRIMARY} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="day" tick={{ fill: TICK_FILL, fontSize: 11 }} tickLine={false} axisLine={false} interval={2} />
                <YAxis tick={{ fill: TICK_FILL, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="leads" name="Leads" stroke={PRIMARY} strokeWidth={2} fill="url(#gradLeads)" dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <EmptyChart label="leads" />}
        </ChartCard>

        <ChartCard title="Replies Sent" subtitle="Outbound WhatsApp messages — last 14 days">
          {hasReplyData ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartDaily} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={10}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="day" tick={{ fill: TICK_FILL, fontSize: 11 }} tickLine={false} axisLine={false} interval={2} />
                <YAxis tick={{ fill: TICK_FILL, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="replies" name="Replies" fill={BLUE} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart label="reply" />}
        </ChartCard>
      </section>

      {/* Followups + weekly overview */}
      <section className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Followups" subtitle="Followup tasks created — last 14 days">
          {hasFollowData ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartDaily} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={10}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="day" tick={{ fill: TICK_FILL, fontSize: 11 }} tickLine={false} axisLine={false} interval={2} />
                <YAxis tick={{ fill: TICK_FILL, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="followups" name="Followups" fill={AMBER} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart label="followup" />}
        </ChartCard>

        <ChartCard title="Avg Response Time" subtitle="Minutes to first reply — per day of week">
          {hasRespData ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.responseTimeByDay} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="day" tick={{ fill: TICK_FILL, fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis unit="m" tick={{ fill: TICK_FILL, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} min`, "Avg response"]} />
                <Line type="monotone" dataKey="minutes" name="Minutes" stroke={ROSE} strokeWidth={2} dot={{ r: 3, fill: ROSE }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyChart label="response time" />}
        </ChartCard>
      </section>

      {/* Weekly combined overview */}
      {(hasLeadData || hasReplyData || hasFollowData) && (
        <ChartCard title="Last 7 Days Overview" subtitle="Leads, replies and followups combined">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.daily.slice(-7)} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={8} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="day" tick={{ fill: TICK_FILL, fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: TICK_FILL, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Bar dataKey="leads"     name="Leads"     fill={PRIMARY} radius={[3, 3, 0, 0]} />
              <Bar dataKey="replies"   name="Replies"   fill={BLUE}    radius={[3, 3, 0, 0]} />
              <Bar dataKey="followups" name="Followups" fill={AMBER}   radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Salesperson leaderboard */}
      <ChartCard title="Salesperson Leaderboard" subtitle="Ranked by total leads assigned">
        {hasLeaderboard ? (
          <div className="-mx-1 space-y-1">
            {data.salesperson.map((sp, i) => (
              <LeaderboardRow key={sp.name} sp={sp} rank={i + 1} />
            ))}
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-slate-100 pt-4 text-xs text-slate-400 dark:border-slate-800">
              <span>Conv. — closed ÷ assigned leads</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-12">
            <Users className="h-8 w-8 text-slate-300 dark:text-slate-700" />
            <p className="text-sm text-slate-400">No leads assigned to anyone yet.</p>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
