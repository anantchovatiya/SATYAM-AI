"use client";

import { useCallback, useState } from "react";
import { ImagePlus, Loader2, MessageSquare, Send, Users } from "lucide-react";

type BulkResult = {
  ok?: boolean;
  error?: string;
  templateName?: string;
  languageCode?: string;
  channel?: string;
  total?: number;
  sent?: number;
  failed?: number;
  results?: { to: string; ok: boolean; messageId?: string; error?: string }[];
};

const COMPONENTS_PLACEHOLDER = `[]   ← no variables in template

Body only ({{1}}):
[
  {
    "type": "body",
    "parameters": [
      { "type": "text", "text": "First value for {{1}}" }
    ]
  }
]

+ dynamic IMAGE header (URL must be https, public):
[
  { "type": "header", "parameters": [ { "type": "image", "image": { "link": "https://…/x.jpg" } } ] },
  { "type": "body", "parameters": [ { "type": "text", "text": "…" } ] }
]

+ URL button variable (index 0 = first button; match Manager):
[
  { "type": "body", "parameters": [ { "type": "text", "text": "Name" } ] },
  { "type": "button", "sub_type": "url", "index": "0", "parameters": [ { "type": "text", "text": "path-suffix" } ] }
]`;

type Mode = "templates" | "qr";

const QR_PLACEHOLDER_HELP = `Hi {firstname},

Thanks for reaching out — here is what you asked about.
— Team`;

export function BulkMessagesClient() {
  const [mode, setMode] = useState<Mode>("templates");

  const [templateName, setTemplateName] = useState("");
  const [languageCode, setLanguageCode] = useState("en_US");
  const [componentsJson, setComponentsJson] = useState("[]");
  const [recipients, setRecipients] = useState("");
  const [delayMs, setDelayMs] = useState(500);
  const [loading, setLoading] = useState(false);
  const [loadingScaffold, setLoadingScaffold] = useState(false);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [formError, setFormError] = useState("");
  const [scaffoldInfo, setScaffoldInfo] = useState<string | null>(null);

  const [qrMessage, setQrMessage] = useState(QR_PLACEHOLDER_HELP);
  const [qrRecipients, setQrRecipients] = useState("");
  const [qrImageDataUrl, setQrImageDataUrl] = useState<string | null>(null);

  const loadTemplateScaffold = useCallback(async () => {
    const name = templateName.trim();
    if (!name) {
      setFormError("Enter the template name first (as in WhatsApp Manager).");
      return;
    }
    setLoadingScaffold(true);
    setFormError("");
    setScaffoldInfo(null);
    try {
      const q = new URLSearchParams({
        templateName: name,
        languageCode: languageCode.trim() || "en_US",
      });
      const res = await fetch(`/api/whatsapp/template-scaffold?${q.toString()}`);
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        components?: unknown[];
        notes?: string[];
        language?: string;
      };
      if (!res.ok) {
        setFormError(data.error ?? "Could not load template");
        return;
      }
      if (data.components) {
        setComponentsJson(JSON.stringify(data.components, null, 2));
      }
      setScaffoldInfo(
        [data.notes?.length ? data.notes.map((n) => `• ${n}`).join("\n") : "Components filled from Meta.", `Language: ${data.language ?? "—"}`]
          .filter(Boolean)
          .join("\n")
      );
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoadingScaffold(false);
    }
  }, [templateName, languageCode]);

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

  const fillQrLeadsWithNames = useCallback(async (whatsappOnly: boolean) => {
    setLoadingLeads(true);
    setFormError("");
    try {
      const res = await fetch("/api/leads", { cache: "no-store" });
      const data = (await res.json()) as { phone?: string; name?: string; source?: string }[];
      if (!res.ok) throw new Error("Could not load leads");
      const rows = (Array.isArray(data) ? data : []).filter((l) => {
        const p = l.phone?.replace(/\D/g, "") ?? "";
        if (p.length < 8) return false;
        if (!whatsappOnly) return true;
        return (l.source ?? "").toLowerCase().includes("whatsapp");
      });
      if (rows.length === 0) {
        setFormError(
          whatsappOnly
            ? "No WhatsApp-sourced leads with phone numbers."
            : "No leads with phone numbers."
        );
        return;
      }
      const lines = rows.map((l) => {
        const digits = l.phone!.replace(/\D/g, "");
        const name = (l.name ?? "").trim().replace(/[,;\t\r\n]/g, " ");
        return name ? `${digits},${name}` : digits;
      });
      setQrRecipients((prev) => {
        const existing = new Set(
          prev
            .split(/\r?\n/)
            .map((line) => line.split(/[,;\t]/)[0]?.replace(/\D/g, "") ?? "")
            .filter(Boolean)
        );
        const merged: string[] = [];
        for (const line of prev.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
          merged.push(line);
        }
        for (const line of lines) {
          const d = line.split(/[,;\t]/)[0]?.replace(/\D/g, "") ?? "";
          if (d && !existing.has(d)) {
            existing.add(d);
            merged.push(line);
          }
        }
        return merged.join("\n");
      });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to load leads");
    } finally {
      setLoadingLeads(false);
    }
  }, []);

  function onQrImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) {
      setQrImageDataUrl(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setFormError("Please choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setFormError("Image must be 4 MB or smaller.");
      return;
    }
    setFormError("");
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === "string") setQrImageDataUrl(r);
    };
    reader.readAsDataURL(file);
  }

  async function onSubmitTemplate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setFormError("");
    setScaffoldInfo(null);
    setResult(null);
    try {
      const raw = componentsJson.trim() || "[]";
      let components: unknown[] = [];
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
          setFormError("Template components must be a JSON array (e.g. [] or [ { type: body, … } ]).");
          return;
        }
        components = parsed;
      } catch {
        setFormError("Template components: invalid JSON. Fix the textarea or use [] for templates with no variables.");
        return;
      }
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

  async function onSubmitQr(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setFormError("");
    setResult(null);
    try {
      const res = await fetch("/api/whatsapp/bulk-qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: qrMessage.trim(),
          recipients: qrRecipients.trim(),
          imageBase64: qrImageDataUrl ?? undefined,
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
      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900/60">
        <button
          type="button"
          onClick={() => {
            setMode("templates");
            setFormError("");
            setResult(null);
          }}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition sm:flex-none sm:px-4 ${
            mode === "templates"
              ? "bg-white text-primary shadow-sm dark:bg-slate-800"
              : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          }`}
        >
          <Send className="h-4 w-4" />
          Meta templates (Cloud API)
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("qr");
            setFormError("");
            setResult(null);
          }}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition sm:flex-none sm:px-4 ${
            mode === "qr"
              ? "bg-white text-primary shadow-sm dark:bg-slate-800"
              : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          QR session (text + photo)
        </button>
      </div>

      {mode === "templates" && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-medium">Template rules (Meta)</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-amber-800/90 dark:text-amber-200/90">
            <li>Use the <strong>exact template name</strong> as in WhatsApp Manager (approved / active).</li>
            <li>
              <strong>Language</strong> must match the template (e.g. <code className="rounded bg-amber-100/80 px-1">en_US</code>,{" "}
              <code className="rounded bg-amber-100/80 px-1">en</code>) — use underscore, not a hyphen.
            </li>
            <li>
              Error <code className="rounded bg-amber-100/80 px-1">#132012</code>: use{" "}
              <strong>Load from Meta</strong> below (set <code className="rounded bg-amber-100/80 px-1">WHATSAPP_WABA_ID</code> in
              env) to fill <code className="rounded bg-amber-100/80 px-1">components</code> automatically, then replace
              placeholder text/URLs and send.
            </li>
            <li>
              If the template has variables, paste a valid <code className="rounded bg-amber-100/80 px-1">components</code>{" "}
              JSON array (see placeholder in the field below). Each body variable must include{" "}
              <code className="rounded bg-amber-100/80 px-1">{`"type": "text"`}</code> and{" "}
              <code className="rounded bg-amber-100/80 px-1">{`"text": "…"`}</code>.
            </li>
            <li>Max <strong>100</strong> numbers per batch to stay within server time limits — run again for more.</li>
          </ul>
        </div>
      )}

      {mode === "qr" && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950 dark:border-violet-900/40 dark:bg-violet-950/30 dark:text-violet-100">
          <p className="font-medium">QR bulk send</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-violet-900/90 dark:text-violet-200/90">
            <li>
              Uses your <strong>linked WhatsApp Web (Baileys) session</strong> — same as inbox QR. This only works where that session is running (typically your own machine, not Vercel serverless).
            </li>
            <li>
              Placeholders in the message: <code className="rounded bg-violet-100/80 px-1 dark:bg-violet-900/50">{"{firstname}"}</code>,{" "}
              <code className="rounded bg-violet-100/80 px-1 dark:bg-violet-900/50">{"{lastname}"}</code>,{" "}
              <code className="rounded bg-violet-100/80 px-1 dark:bg-violet-900/50">{"{name}"}</code>,{" "}
              <code className="rounded bg-violet-100/80 px-1 dark:bg-violet-900/50">{"{phone}"}</code>,{" "}
              <code className="rounded bg-violet-100/80 px-1 dark:bg-violet-900/50">{"{company}"}</code> (optional column).
            </li>
            <li>
              Recipients: one <strong>phone per line</strong>, or <code className="rounded bg-violet-100/80 px-1 dark:bg-violet-900/50">phone,name</code>, or{" "}
              <code className="rounded bg-violet-100/80 px-1 dark:bg-violet-900/50">phone,firstname,lastname</code>, or add a final column for company.
            </li>
            <li>
              Use <strong>country code + national number</strong> (e.g. <code className="rounded bg-violet-100/80 px-1 dark:bg-violet-900/50">919876543210</code> or a 10-digit Indian mobile so we can normalize to 91…). Each line is sent as its own chat; existing inbox threads are matched automatically so the right WhatsApp identity (LID vs phone) is used.
            </li>
            <li>Long messages with an image use the image caption (first 1024 chars) plus a follow-up text when needed.</li>
          </ul>
        </div>
      )}

      {mode === "templates" ? (
        <form onSubmit={onSubmitTemplate} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-panel dark:border-slate-800 dark:bg-slate-900">
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

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loadingScaffold}
              onClick={() => void loadTemplateScaffold()}
              className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/15 disabled:opacity-50 dark:bg-primary/20"
            >
              {loadingScaffold ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Load from Meta
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Fetches the approved template and fills the JSON (needs <code className="font-mono">WHATSAPP_WABA_ID</code>).
            </span>
          </div>
          {scaffoldInfo && (
            <pre className="whitespace-pre-wrap rounded-lg border border-emerald-200/80 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-100">
              {scaffoldInfo}
            </pre>
          )}

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
      ) : (
        <form onSubmit={onSubmitQr} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-panel dark:border-slate-800 dark:bg-slate-900">
          <label className="block text-sm">
            <span className="text-slate-600 dark:text-slate-400">Message (with placeholders)</span>
            <textarea
              required
              value={qrMessage}
              onChange={(e) => setQrMessage(e.target.value)}
              rows={10}
              placeholder={QR_PLACEHOLDER_HELP}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950"
            />
          </label>

          <div className="block text-sm">
            <span className="text-slate-600 dark:text-slate-400">Photo (optional)</span>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                <ImagePlus className="h-4 w-4" />
                Choose image
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onQrImagePick} />
              </label>
              {qrImageDataUrl && (
                <button
                  type="button"
                  onClick={() => setQrImageDataUrl(null)}
                  className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                >
                  Remove image
                </button>
              )}
            </div>
            {qrImageDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrImageDataUrl} alt="Attachment preview" className="mt-2 h-28 w-auto max-w-full rounded-lg border border-slate-200 object-contain dark:border-slate-700" />
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm text-slate-600 dark:text-slate-400">Recipients</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={loadingLeads}
                  onClick={() => void fillQrLeadsWithNames(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {loadingLeads ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                  WhatsApp leads + names
                </button>
                <button
                  type="button"
                  disabled={loadingLeads}
                  onClick={() => void fillQrLeadsWithNames(false)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {loadingLeads ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                  All leads + names
                </button>
              </div>
            </div>
            <textarea
              required
              value={qrRecipients}
              onChange={(e) => setQrRecipients(e.target.value)}
              rows={10}
              placeholder={`919876543210,Rajesh Kumar\n918765432109,Priya,Singh\n# optional header row:\nphone,name`}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <label className="block text-sm">
            <span className="text-slate-600 dark:text-slate-400">Delay between recipients (ms)</span>
            <input
              type="number"
              min={200}
              max={3000}
              step={50}
              value={delayMs}
              onChange={(e) => setDelayMs(Number(e.target.value))}
              className="mt-1 w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950"
            />
            <span className="mt-1 block text-xs text-slate-400">Default 500ms between each person.</span>
          </label>

          {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white shadow hover:bg-primary/90 disabled:opacity-60 sm:w-auto"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {loading ? "Sending…" : "Send via QR session"}
          </button>
        </form>
      )}

      {result?.ok && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <p className="font-medium text-emerald-800 dark:text-emerald-200">
            {result.channel === "qr" ? "QR batch: " : ""}
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
