"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Bot, LayoutDashboard, LogOut, Menu, MessageSquare, Mails, Settings2, Sparkles, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ThemeToggle } from "./theme-toggle";

type MeUser = { id: string; email: string; name: string };

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/inbox", label: "Inbox", icon: MessageSquare },
  { href: "/bulk-messages", label: "Bulk send", icon: Mails },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/automation", label: "Automation", icon: Sparkles },
  { href: "/followups", label: "Followups", icon: Bot },
  { href: "/templates", label: "Templates", icon: MessageSquare },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-72 flex-col border-r border-slate-200 bg-white/90 p-4 dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-8 flex items-center gap-3 px-2 pt-2">
        <div className="rounded-lg bg-primary px-2 py-1 text-xs font-bold uppercase text-white">AI</div>
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">SaaS CRM</p>
          <p className="text-lg font-semibold text-slate-900 dark:text-white">SATYAM AI</p>
        </div>
      </div>
      <nav className="space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                active
                  ? "bg-primary text-white shadow"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        Deploy-ready for Vercel with fast App Router pages.
      </div>
    </aside>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [user, setUser] = useState<MeUser | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        const data = (await res.json()) as { user?: MeUser | null };
        if (!cancelled) setUser(res.ok && data.user ? data.user : null);
      } catch {
        if (!cancelled) setUser(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    router.push("/login");
    router.refresh();
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex min-h-screen">
        <div className="hidden md:block">
          <Sidebar />
        </div>

        {open && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <div className="relative z-10 h-full w-72">
              <Sidebar onNavigate={() => setOpen(false)} />
            </div>
          </div>
        )}

        <main className="flex-1">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-4 backdrop-blur md:px-6 dark:border-slate-800 dark:bg-slate-950/80">
            <button
              className="rounded-lg border border-slate-200 p-2 md:hidden dark:border-slate-700"
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
              {user === undefined ? (
                <span className="text-sm text-slate-400">…</span>
              ) : user ? (
                <>
                  <span
                    className="hidden max-w-[200px] truncate text-sm text-slate-600 sm:inline dark:text-slate-300 md:max-w-[320px]"
                    title={user.email}
                  >
                    <span className="font-medium text-slate-800 dark:text-slate-100">{user.name}</span>
                    <span className="text-slate-400"> · </span>
                    {user.email}
                  </span>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    title="Log out"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Log out</span>
                  </button>
                </>
              ) : null}
            </div>
            <ThemeToggle />
          </header>
          <div className="p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
