"use client";

import { useCallback, useState } from "react";
import { Loader2, Send, Users } from "lucide-react";

type BulkResult = {
  ok?: boolean;
  error?: string;
  templateName?: string;
  languageCode?: string;
  total?: number;
  sent?: number;
  failed?: number;
  results?: { to: string; ok: boolean; messageId?: string; error?: string }[];
};

const COMPONENTS_PLACEHOLDER = `[]

Or with body variables (example — match your template in Meta):
[
  {
    "type": "body",
    "parameters": [
      { "type": "text", "text": "Customer name" }
    ]
  }
]`;

export function BulkMessagesClient() {
  const [templateName, setTemplateName] = useState("");
  const [languageCode, setLanguageCode] = useState("en_US");
  const [componentsJson, setComponentsJson] = useState("[]");
  const [recipients, setRecipients] = useState("");
  const [delayMs, setDelayMs] = useState(500);
  const [loading, setLoading] = useState(false);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [formError, setFormError] = useState("");

  const fillFromLeads = useCallback(async () => {
    setLoadingLeads(true);
    setFormError("");
    try {
      const res = await fetch("/api/leads", { cache: "no-store" });
      const data = (await res.json()) as { phone?: string; source?: string }[];
      if (!res.ok) throw new Error("Could not load leads");
      const waPhones = (Array.isArray(data) ? data : [])
        .filter((l) => (l.source ?? "").toLowerCase().includes("whatsapp"))
        .map((l) => l.phone?.replace(/\D/g, "") ?? "")
        .filter(Boolean);
      const unique = [...new Set(waPhones)];
      if (unique.length === 0) {
        setFormError("No WhatsApp-sourced leads found. Paste numbers manually.");
        return;
      }
      setRecipients((prev) => {
        const existing = new Set(
          prev
            .split(/\r?\n/)
            .map((l) => l.replace(/\D/g, ""))
            .filter(Boolean)
        );
        const merged = [...existing];
        for (const p of unique) {
          if (!existing.has(p)) merged.push(p);
        }
        return merged.join("\n");
      });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to load leads");
    } finally {
      setLoadingLeads(false);
    }
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setFormError("");
    setResult(null);
    try {
      let components: unknown = componentsJson.trim();
      if (components === "") components = "[]";
      const res = await fetch("/api/whatsapp/bulk-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: templateName.trim(),
          languageCode: languageCode.trim() || "en_US",
          components,
          recipients,
          delayMs,
          recordInCrm: true,
        }),
      });
      const data = (await res.json()) as BulkResult & { error?: string };
      if (!res.ok) {
        setFormError(data.error ?? "Request failed");
        return;
      }
      setResult(data);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
        <p className="font-medium">Template rules (Meta)</p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-amber-800/90 dark:text-amber-200/90">
          <li>Use the <strong>exact template name</strong> as in WhatsApp Manager (approved / active).</li>
          <li>
            If the template has variables, paste a valid <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/50">components</code>{" "}
            JSON array (see placeholder below).
          </li>
          <li>Max <strong>100</strong> numbers per batch to stay within server time limits — run again for more.</li>
        </ul>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-panel dark:border-slate-800 dark:bg-slate-900">
        <label className="block text-sm">
          <span className="text-slate-600 dark:text-slate-400">Template name</span>
          <input
            required
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="hello_world"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950"
          />
        </label>

        <label className="block text-sm">
          <span className="text-slate-600 dark:text-slate-400">Language code</span>
          <input
            value={languageCode}
            onChange={(e) => setLanguageCode(e.target.value)}
            placeholder="en_US"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950"
          />
        </label>

        <label className="block text-sm">
          <span className="text-slate-600 dark:text-slate-400">Template components (JSON)</span>
          <textarea
            value={componentsJson}
            onChange={(e) => setComponentsJson(e.target.value)}
            rows={8}
            placeholder={COMPONENTS_PLACEHOLDER}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950"
          />
        </label>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-400">Recipients (one per line)</label>
            <button
              type="button"
              disabled={loadingLeads}
              onClick={() => void fillFromLeads()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {loadingLeads ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
              Append WhatsApp leads
            </button>
          </div>
          <textarea
            required
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            rows={10}
            placeholder={"919876543210\n918765432109"}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        <label className="block text-sm">
          <span className="text-slate-600 dark:text-slate-400">Delay between sends (ms)</span>
          <input
            type="number"
            min={200}
            max={3000}
            step={50}
            value={delayMs}
            onChange={(e) => setDelayMs(Number(e.target.value))}
            className="mt-1 w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950"
          />
          <span className="mt-1 block text-xs text-slate-400">Helps avoid rate limits. Default 500ms.</span>
        </label>

        {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white shadow hover:bg-primary/90 disabled:opacity-60 sm:w-auto"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {loading ? "Sending…" : "Send template batch"}
        </button>
      </form>

      {result?.ok && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <p className="font-medium text-emerald-800 dark:text-emerald-200">
            Done: {result.sent} sent, {result.failed} failed (of {result.total})
          </p>
          {result.results && result.results.some((r) => !r.ok) && (
            <ul className="mt-3 max-h-48 overflow-y-auto text-xs text-red-700 dark:text-red-300">
              {result.results
                .filter((r) => !r.ok)
                .map((r) => (
                  <li key={r.to}>
                    {r.to}: {r.error ?? "error"}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
