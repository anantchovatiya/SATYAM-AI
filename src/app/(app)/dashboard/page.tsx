import Link from "next/link";
import { redirect } from "next/navigation";
import { Flame, TrendingUp, Users, Zap, MessageSquare } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { DbError } from "@/components/db-error";
import { getDb } from "@/lib/mongodb";
import { leadsCollection } from "@/lib/models/lead";
import { waMessagesCollection } from "@/lib/models/webhook-log";
import { getOrCreateSettings } from "@/lib/models/settings";
import { getBusinessCardCount } from "@/lib/business-card";
import { getServerSessionUser } from "@/lib/auth/session";
import { WhatsAppConnectionCard } from "./whatsapp-connection-card";
import type { WhatsAppStatus } from "./whatsapp-connection-card";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  Hot:    "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  New:    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  Silent: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  Closed: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

const BAR_COLORS: Record<string, string> = {
  Hot:    "bg-red-500",
  New:    "bg-blue-500",
  Silent: "bg-amber-400",
  Closed: "bg-slate-400",
};

export default async function DashboardPage() {
  try {
    const session = await getServerSessionUser();
    if (!session) redirect("/login");
    const { userId } = session;
    const userIdHex = userId.toHexString();

    const db = await getDb();
    const col = leadsCollection(db);
    const messagesCol = waMessagesCollection(db);
    const settings = await getOrCreateSettings(db, userId);

    const [total, hot, silent, newCount, closedCount, recentDocs, totalMessages, contactPhones, latestMessage, totalWhatsAppLeads, businessCardsCollected] =
      await Promise.all([
        col.countDocuments({ userId }),
        col.countDocuments({ userId, status: "Hot" }),
        col.countDocuments({ userId, status: "Silent" }),
        col.countDocuments({ userId, status: "New" }),
        col.countDocuments({ userId, status: "Closed" }),
        col.find({ userId }).sort({ createdAt: -1 }).limit(5).toArray(),
        messagesCol.countDocuments({ userId }),
        messagesCol.distinct("from", { userId }),
        messagesCol.find({ userId }).sort({ timestamp: -1 }).limit(1).toArray(),
        col.countDocuments({ userId, source: "WhatsApp" }),
        getBusinessCardCount(userIdHex),
      ]);

    const convRate = total > 0 ? ((closedCount / total) * 100).toFixed(1) + "%" : "0%";
    const hotPct   = total > 0 ? Math.round((hot / total) * 100) : 0;

    const statusBreakdown = [
      { status: "New",    count: newCount,    pct: total > 0 ? Math.round((newCount    / total) * 100) : 0 },
      { status: "Hot",    count: hot,         pct: total > 0 ? Math.round((hot         / total) * 100) : 0 },
      { status: "Silent", count: silent,      pct: total > 0 ? Math.round((silent      / total) * 100) : 0 },
      { status: "Closed", count: closedCount, pct: total > 0 ? Math.round((closedCount / total) * 100) : 0 },
    ];
    const connectedFromDashboard = Boolean(
      settings.whatsapp?.token && settings.whatsapp.phoneNumberId
    );
    const connectedFromEnv = Boolean(
      process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
    );
    const whatsappStatus: WhatsAppStatus = {
      connected: connectedFromDashboard || connectedFromEnv,
      source: connectedFromDashboard ? "dashboard" : connectedFromEnv ? "env" : "none",
      phoneNumberId:
        settings.whatsapp?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? null,
      displayPhoneNumber: settings.whatsapp?.displayPhoneNumber ?? null,
      verifiedName: settings.whatsapp?.verifiedName ?? null,
      lastSyncAt: settings.whatsapp?.lastSyncAt?.toISOString() ?? null,
      stats: {
        totalMessages,
        totalContacts: contactPhones.length,
        totalWhatsAppLeads,
        latestMessageAt: latestMessage[0]?.timestamp ? new Date(latestMessage[0].timestamp).toISOString() : null,
        businessCardsCollected,
      },
    };

    return (
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Live pipeline overview · updates on every refresh
          </p>
        </div>

        <WhatsAppConnectionCard initialStatus={whatsappStatus} />

        {/* Metric cards */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            title="Total Leads"
            value={String(total)}
            sub={`${newCount} new · ${hot} hot`}
            icon={Users}
            accent="purple"
          />
          <MetricCard
            title="Pending Followups"
            value={String(silent)}
            sub="No reply yet"
            icon={MessageSquare}
            accent="amber"
          />
          <MetricCard
            title="New Leads"
            value={String(newCount)}
            sub="Awaiting first action"
            icon={Zap}
            accent="blue"
          />
          <MetricCard
            title="Hot Leads"
            value={String(hot)}
            sub={`${hotPct}% of pipeline`}
            icon={Flame}
            accent="red"
          />
          <MetricCard
            title="Conversion Rate"
            value={convRate}
            sub={`${closedCount} closed of ${total}`}
            icon={TrendingUp}
            accent="emerald"
          />
        </section>

        {/* Lower grid */}
        <section className="grid gap-5 lg:grid-cols-2">

          {/* Recent leads */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 dark:text-white">Recent Leads</h2>
              <Link
                href="/leads"
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/5 transition"
              >
                View all →
              </Link>
            </div>

            {recentDocs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Users className="h-8 w-8 text-slate-300 dark:text-slate-700" />
                <p className="text-sm text-slate-400">No leads yet.</p>
                <Link href="/leads" className="text-xs text-primary hover:underline">
                  Add your first lead →
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {recentDocs.map((doc) => (
                  <div
                    key={doc._id!.toHexString()}
                    className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800"
                  >
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {doc.name[0]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {doc.name}
                      </p>
                      <p className="text-xs text-slate-400">{doc.source}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[doc.status] ?? ""}`}>
                      {doc.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Status breakdown */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">
              Pipeline Breakdown
            </h2>

            {total === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">No data yet.</p>
            ) : (
              <div className="space-y-4">
                {statusBreakdown.map(({ status, count, pct }) => (
                  <div key={status}>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${BAR_COLORS[status]}`} />
                        <span className="font-medium text-slate-700 dark:text-slate-200">{status}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                        <span className="tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                          {count}
                        </span>
                        <span className="text-xs">({pct}%)</span>
                      </div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${BAR_COLORS[status]}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Quick stats row */}
            {total > 0 && (
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800">
                  <p className="text-xs text-slate-400">Active leads</p>
                  <p className="mt-0.5 text-lg font-bold text-slate-800 dark:text-slate-100">
                    {newCount + hot}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800">
                  <p className="text-xs text-slate-400">Need attention</p>
                  <p className="mt-0.5 text-lg font-bold text-amber-600 dark:text-amber-400">
                    {silent}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return <DbError message={msg} />;
  }
}
