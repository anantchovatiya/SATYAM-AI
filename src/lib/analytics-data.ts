// Types only — all data comes from real MongoDB aggregations in the analytics page.

export interface DailyPoint {
  day: string;        // e.g. "Apr 1"
  leads: number;
  replies: number;
  followups: number;
  conversions: number;
}

export interface SalespersonStat {
  name: string;
  avatar: string;     // first letter
  leads: number;
  closed: number;
  hot: number;
  convRate: number;   // 0-100
}

export interface ResponsePoint {
  day: string;
  minutes: number;
}

export interface AnalyticsSummary {
  totalLeads: number;
  repliesSent: number;
  followupsSent: number;
  conversionRate: number;  // 0-100
  avgResponseMin: number;
  hotLeads: number;
  daily: DailyPoint[];
  salesperson: SalespersonStat[];
  responseTimeByDay: ResponsePoint[];
}
