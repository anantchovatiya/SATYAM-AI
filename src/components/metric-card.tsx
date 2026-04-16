import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

interface MetricCardProps {
  title:   string;
  value:   string;
  sub?:    string;           // small descriptive line under value
  icon:    LucideIcon;
  accent?: "purple" | "red" | "blue" | "amber" | "emerald" | "rose";
  badge?:  string;           // optional top-right tag e.g. "+12%"
  badgeUp?: boolean;         // green if true, red if false, grey if undefined
}

const ACCENT = {
  purple:  { bg: "bg-violet-100 dark:bg-violet-900/30",  icon: "text-violet-600 dark:text-violet-400" },
  red:     { bg: "bg-red-100 dark:bg-red-900/30",        icon: "text-red-600 dark:text-red-400" },
  blue:    { bg: "bg-blue-100 dark:bg-blue-900/30",      icon: "text-blue-600 dark:text-blue-400" },
  amber:   { bg: "bg-amber-100 dark:bg-amber-900/30",    icon: "text-amber-600 dark:text-amber-400" },
  emerald: { bg: "bg-emerald-100 dark:bg-emerald-900/30",icon: "text-emerald-600 dark:text-emerald-400" },
  rose:    { bg: "bg-rose-100 dark:bg-rose-900/30",      icon: "text-rose-600 dark:text-rose-400" },
};

export function MetricCard({ title, value, sub, icon: Icon, accent = "purple", badge, badgeUp }: MetricCardProps) {
  const colors = ACCENT[accent];

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-panel dark:border-slate-800 dark:bg-slate-900">
      {/* top row */}
      <div className="flex items-start justify-between gap-2">
        <div className={cn("flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl", colors.bg)}>
          <Icon className={cn("h-5 w-5", colors.icon)} />
        </div>
        {badge && (
          <span className={cn(
            "rounded-full px-2 py-0.5 text-xs font-semibold",
            badgeUp === true  && "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
            badgeUp === false && "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400",
            badgeUp === undefined && "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
          )}>
            {badge}
          </span>
        )}
      </div>

      {/* value + labels */}
      <div>
        <p className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          {value}
        </p>
        <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
        {sub && (
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{sub}</p>
        )}
      </div>
    </div>
  );
}
