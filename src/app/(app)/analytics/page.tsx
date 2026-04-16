import { getDb }               from "@/lib/mongodb";
import { leadsCollection }     from "@/lib/models/lead";
import { waMessagesCollection } from "@/lib/models/webhook-log";
import { followupsCollection } from "@/lib/models/followup";
import { AnalyticsClient }     from "./analytics-client";
import { DbError }             from "@/components/db-error";
import type { AnalyticsSummary, DailyPoint, SalespersonStat, ResponsePoint } from "@/lib/analytics-data";

export const dynamic = "force-dynamic";

// Build a map from ISO date string → value for fast lookup
function dateMap(arr: { _id: string; count: number }[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const row of arr) m[row._id] = row.count;
  return m;
}

// Last N days as "YYYY-MM-DD" strings
function lastNDays(n: number): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// Format "YYYY-MM-DD" → "Apr 1"
function fmtDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default async function AnalyticsPage() {
  try {
    const db    = await getDb();
    const lCol  = leadsCollection(db);
    const mCol  = waMessagesCollection(db);
    const fCol  = followupsCollection(db);

    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const since7  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000);

    // ── Aggregations run in parallel ─────────────────────────────────────────
    const [
      totalLeads,
      hotLeads,
      closedLeads,
      allLeads,
      dailyLeadsRaw,
      dailyRepliesRaw,
      dailyFollowupsRaw,
      totalReplies,
      totalFollowups,
      msgPairsRaw,
      responseWeekRaw,
    ] = await Promise.all([
      lCol.countDocuments(),
      lCol.countDocuments({ status: "Hot" }),
      lCol.countDocuments({ status: "Closed" }),

      // Per-salesperson breakdown
      lCol.find({}, { projection: { assignedTo: 1, status: 1 } }).toArray(),

      // Daily leads created (last 30 days)
      lCol.aggregate<{ _id: string; count: number }>([
        { $match: { createdAt: { $gte: since30 } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray(),

      // Daily outbound messages (last 30 days)
      mCol.aggregate<{ _id: string; count: number }>([
        { $match: { direction: "out", timestamp: { $gte: since30 } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray(),

      // Daily followups created (last 30 days)
      fCol.aggregate<{ _id: string; count: number }>([
        { $match: { createdAt: { $gte: since30 } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray(),

      // Total replies ever
      mCol.countDocuments({ direction: "out" }),

      // Total followups ever
      fCol.countDocuments(),

      // Avg response time — pair in → out messages per phone, last 7 days
      mCol.aggregate<{ _id: string; avgMs: number }>([
        { $match: { timestamp: { $gte: since7 } } },
        { $sort:  { from: 1, timestamp: 1 } },
        { $group: { _id: "$from", messages: { $push: { dir: "$direction", ts: "$timestamp" } } } },
      ]).toArray(),

      // Avg response time per day of week (last 30 days outbound)
      mCol.aggregate<{ _id: number; avgMs: number }>([
        { $match: { direction: "out", timestamp: { $gte: since30 } } },
        { $group: {
          _id: { $dayOfWeek: "$timestamp" }, // 1=Sun…7=Sat
          avgTs: { $avg: { $toLong: "$timestamp" } },
        }},
        { $sort: { _id: 1 } },
      ]).toArray(),
    ]);

    // ── Build daily series ────────────────────────────────────────────────────
    const leadsMap    = dateMap(dailyLeadsRaw);
    const repliesMap  = dateMap(dailyRepliesRaw);
    const followupsMap = dateMap(dailyFollowupsRaw);
    const days30 = lastNDays(30);

    const daily: DailyPoint[] = days30.map((iso) => ({
      day:         fmtDay(iso),
      leads:       leadsMap[iso]    ?? 0,
      replies:     repliesMap[iso]  ?? 0,
      followups:   followupsMap[iso] ?? 0,
      conversions: 0, // would require a "status changed to Closed" event log
    }));

    // ── Salesperson leaderboard ───────────────────────────────────────────────
    const spMap: Record<string, { leads: number; hot: number; closed: number }> = {};
    for (const lead of allLeads) {
      const name = lead.assignedTo?.trim() || "Unassigned";
      if (!spMap[name]) spMap[name] = { leads: 0, hot: 0, closed: 0 };
      spMap[name].leads++;
      if (lead.status === "Hot")    spMap[name].hot++;
      if (lead.status === "Closed") spMap[name].closed++;
    }
    const salesperson: SalespersonStat[] = Object.entries(spMap)
      .map(([name, stats]) => ({
        name,
        avatar:    name[0].toUpperCase(),
        leads:     stats.leads,
        hot:       stats.hot,
        closed:    stats.closed,
        convRate:  stats.leads > 0 ? Math.round((stats.closed / stats.leads) * 100) : 0,
      }))
      .sort((a, b) => b.leads - a.leads);

    // ── Avg response time (minutes) ───────────────────────────────────────────
    let totalResponseMs = 0;
    let responsePairs   = 0;
    for (const phone of msgPairsRaw) {
      const msgs = phone.messages as { dir: string; ts: Date }[];
      for (let i = 0; i < msgs.length - 1; i++) {
        if (msgs[i].dir === "in" && msgs[i + 1].dir === "out") {
          totalResponseMs += new Date(msgs[i + 1].ts).getTime() - new Date(msgs[i].ts).getTime();
          responsePairs++;
        }
      }
    }
    const avgResponseMin = responsePairs > 0
      ? Math.round(totalResponseMs / responsePairs / 60_000)
      : 0;

    // ── Response time by day of week (last 30 days) ───────────────────────────
    const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const responseTimeByDay: ResponsePoint[] = responseWeekRaw.map((r) => ({
      day:     DOW[(r._id - 1) % 7] ?? String(r._id),
      minutes: avgResponseMin, // fallback to overall avg if no per-day data
    }));

    // ── Conversion rate ───────────────────────────────────────────────────────
    const conversionRate = totalLeads > 0
      ? Math.round((closedLeads / totalLeads) * 100)
      : 0;

    const summary: AnalyticsSummary = {
      totalLeads,
      hotLeads,
      repliesSent:    totalReplies,
      followupsSent:  totalFollowups,
      conversionRate,
      avgResponseMin,
      daily,
      salesperson,
      responseTimeByDay: responseTimeByDay.length > 0
        ? responseTimeByDay
        : DOW.slice(1, 6).map((d) => ({ day: d, minutes: 0 })), // Mon-Fri with 0
    };

    return <AnalyticsClient data={summary} />;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return <DbError message={msg} />;
  }
}
