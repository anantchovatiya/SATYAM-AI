"use client";

import { useState, useRef, useEffect } from "react";
import type { AutomationSettingsClient, AiTone } from "@/lib/models/settings";
import { formatLeadPhoneFromCanonical, canonicalWaContactKey } from "@/lib/wa-phone";
import { cn } from "@/lib/cn";
import {
  Bot,
  Check,
  Clock,
  CreditCard,
  Globe,
  Languages,
  Loader2,
  MessageSquareText,
  Save,
  Sparkles,
  TriangleAlert,
  X,
  Zap,
  BookOpen,
  ExternalLink,
  Gauge,
  Timer,
  UserX,
} from "lucide-react";

// ── Toggle switch ──────────────────────────────────────────────────────────────
function Toggle({
  checked,
  onChange,
  label,
  description,
  icon: Icon,
  accent = "bg-primary",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
  icon: React.ElementType;
  accent?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
          <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
        </div>
        <div>
          <p className="font-medium text-slate-800 dark:text-slate-100">{label}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none",
          checked ? accent : "bg-slate-200 dark:bg-slate-700",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform duration-200",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
}

const MAX_AUTO_REPLY_EXCLUDED = 500;

// ── Excluded numbers (no auto-reply) ───────────────────────────────────────────
function ExcludedPhoneInput({
  phones,
  onChange,
}: {
  phones: string[];
  onChange: (phones: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function add() {
    const c = canonicalWaContactKey(draft.trim());
    if (!c) {
      setDraft("");
      return;
    }
    if (phones.length >= MAX_AUTO_REPLY_EXCLUDED) {
      setDraft("");
      return;
    }
    if (phones.includes(c)) {
      setDraft("");
      return;
    }
    onChange([...phones, c]);
    setDraft("");
    inputRef.current?.focus();
  }

  function remove(canon: string) {
    onChange(phones.filter((p) => p !== canon));
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className="min-h-[44px] cursor-text flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-900"
    >
      {phones.map((p) => (
        <span
          key={p}
          className="inline-flex items-center gap-0.5 rounded-md bg-slate-100 py-0.5 pl-2 pr-1 text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200"
        >
          {formatLeadPhoneFromCanonical(p)}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              remove(p);
            }}
            className="ml-0.5 rounded-full p-0.5 hover:text-red-700 dark:hover:text-red-200"
            aria-label={`Remove ${p}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
          if (e.key === "Backspace" && !draft && phones.length) {
            onChange(phones.slice(0, -1));
          }
        }}
        inputMode="tel"
        autoComplete="off"
        placeholder={
          phones.length === 0
            ? "Add phone — e.g. +91 98765 43210, press Enter…"
            : "Add another…"
        }
        className="min-w-[12rem] flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
      />
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────
function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 border-b border-slate-100 pb-3 dark:border-slate-800">
        <h2 className="font-semibold text-slate-900 dark:text-white">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

// ── Keyword tag input ──────────────────────────────────────────────────────────
function KeywordInput({
  keywords,
  onChange,
}: {
  keywords: string[];
  onChange: (kw: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function add() {
    const trimmed = draft.trim().toLowerCase();
    if (trimmed && !keywords.includes(trimmed)) {
      onChange([...keywords, trimmed]);
    }
    setDraft("");
    inputRef.current?.focus();
  }

  function remove(kw: string) {
    onChange(keywords.filter((k) => k !== kw));
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className="flex min-h-[44px] flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 cursor-text dark:border-slate-700 dark:bg-slate-800"
    >
      {keywords.map((kw) => (
        <span
          key={kw}
          className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300"
        >
          {kw}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); remove(kw); }}
            className="ml-0.5 rounded-full hover:text-red-900 dark:hover:text-red-100"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
          if (e.key === "Backspace" && !draft && keywords.length) {
            onChange(keywords.slice(0, -1));
          }
        }}
        placeholder={keywords.length === 0 ? "Type a keyword and press Enter…" : "Add more…"}
        className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-slate-400"
      />
    </div>
  );
}

// ── AI Tone selector ───────────────────────────────────────────────────────────
const TONE_OPTIONS: { value: AiTone; label: string; desc: string; color: string }[] = [
  { value: "sales",        label: "Sales (default)", desc: "WhatsApp-style rep — helpful, closing the next step", color: "border-amber-400 bg-amber-50 dark:bg-amber-950/30" },
  { value: "friendly",     label: "Friendly",     desc: "Warm, casual, emoji-friendly",      color: "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20" },
  { value: "professional", label: "Professional", desc: "Formal, structured, business-ready", color: "border-blue-400 bg-blue-50 dark:bg-blue-900/20" },
  { value: "premium",      label: "Premium",      desc: "Concise, authoritative, high-end",   color: "border-violet-400 bg-violet-50 dark:bg-violet-900/20" },
];

// ── Unsaved indicator ──────────────────────────────────────────────────────────
function UnsavedDot() {
  return <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" title="Unsaved changes" />;
}

function parseSettingsDate(d: Date | string | undefined): Date | null {
  if (d == null) return null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? null : t;
}

// ── Main component ─────────────────────────────────────────────────────────────
export function AutomationClient({
  initial,
}: {
  initial: AutomationSettingsClient;
}) {
  const [form, setForm] = useState<AutomationSettingsClient>(initial);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Track any change
  useEffect(() => { setDirty(true); setSaved(false); }, [form]);
  // but not on mount
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; setDirty(false); }
  }, []);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Automation Settings</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Configure auto-replies, follow-ups, and AI behaviour. Saved to MongoDB.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {dirty && !saving && <UnsavedDot />}
          {error && (
            <p className="flex items-center gap-1 text-sm text-red-500">
              <TriangleAlert className="h-4 w-4" /> {error}
            </p>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition",
              saved
                ? "bg-emerald-500 hover:bg-emerald-600"
                : "bg-primary hover:bg-primary/90",
              (saving || !dirty) && "opacity-50 cursor-not-allowed",
            )}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saved ? (
              <Check className="h-4 w-4" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saving ? "Saving…" : saved ? "Saved!" : "Save Settings"}
          </button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">

        {/* ── Section 1: Core toggles ── */}
        <Section title="Core Automation" subtitle="Global switches for automated behaviour">
          <Toggle
            checked={form.autoReply}
            onChange={(v) => set("autoReply", v)}
            label="Auto Reply"
            description="Automatically reply to incoming messages using AI."
            icon={Bot}
            accent="bg-primary"
          />
          <div className="ml-0 space-y-2 rounded-xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/30">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
              <Timer className="h-4 w-4 text-slate-500" />
              Pause after I send (inbox)
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              When you send a message or attachment from the inbox, AI auto-reply pauses for the minutes below.
              Each send extends the pause. Set to <strong>0</strong> to keep auto-reply running (no pause).
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={0}
                max={1440}
                value={form.autoReplyPauseAfterManualMinutes ?? 0}
                onChange={(e) =>
                  set("autoReplyPauseAfterManualMinutes", Math.max(0, Math.min(1440, Number(e.target.value) || 0)))
                }
                className="h-10 w-24 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium dark:border-slate-600 dark:bg-slate-900"
              />
              <span className="text-sm text-slate-600 dark:text-slate-300">minutes</span>
            </div>
            {(() => {
              const end = parseSettingsDate(form.autoReplySuppressedUntil);
              if (!end || end.getTime() <= Date.now()) return null;
              return (
                <p className="text-xs text-amber-800 dark:text-amber-200/90">
                  Auto-reply is paused from a recent manual send until{" "}
                  <strong>
                    {end.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </strong>{" "}
                  (refresh the page to update).
                </p>
              );
            })()}
          </div>
          <div className="ml-0 space-y-2 rounded-xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/30">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
              <UserX className="h-4 w-4 text-slate-500" />
              No auto-reply for these contacts
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              AI will not auto-reply to these numbers. Use the same country code and number you see in the inbox. Up to{" "}
              {MAX_AUTO_REPLY_EXCLUDED} contacts.
            </p>
            <ExcludedPhoneInput
              phones={form.autoReplyExcludedPhones ?? []}
              onChange={(v) => set("autoReplyExcludedPhones", v)}
            />
          </div>
          <Toggle
            checked={form.languageMirrorMode}
            onChange={(v) => set("languageMirrorMode", v)}
            label="Language mirror (match lead)"
            description="On: reply in the same language/script as the lead. Off (default): Hinglish — Hindi in English letters, like WhatsApp, e.g. aapka quantity kya hai."
            icon={Languages}
            accent="bg-blue-500"
          />
          <Toggle
            checked={form.businessCardAutoSend}
            onChange={(v) => set("businessCardAutoSend", v)}
            label="Business Card Auto Send"
            description="Send your digital business card on first contact."
            icon={CreditCard}
            accent="bg-violet-500"
          />
        </Section>

        {/* ── Section 2: Follow-up timing ── */}
        <Section title="Follow-up Settings" subtitle="Control when automated follow-ups are triggered">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <Clock className="h-4 w-4 text-slate-400" />
              Follow-up Delay
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={1}
                max={14}
                value={form.followUpDelayDays}
                onChange={(e) => set("followUpDelayDays", Number(e.target.value))}
                className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-primary dark:bg-slate-700"
              />
              <div className="flex h-10 w-20 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800">
                {form.followUpDelayDays}d
              </div>
            </div>
            <div className="flex justify-between text-xs text-slate-400">
              <span>1 day</span>
              <span>7 days</span>
              <span>14 days</span>
            </div>
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <Gauge className="h-4 w-4 text-slate-400" />
              Minimum interest for auto follow-up
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Only send an automated follow-up when the lead&apos;s interest score is at least this value. Set to{" "}
              <strong>0</strong> to include all leads. Example: require <strong>35</strong> after{" "}
              {form.followUpDelayDays}d silence so only engaged contacts get nudged.
            </p>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={100}
                value={form.followUpMinInterestScore ?? 0}
                onChange={(e) => set("followUpMinInterestScore", Number(e.target.value))}
                className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-primary dark:bg-slate-700"
              />
              <div className="flex h-10 w-14 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800">
                {form.followUpMinInterestScore ?? 0}
              </div>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Score bands: hello ~10 · product / card / inquiry ~20–60 · price or qty ~60–80 · order intent ~80–100
              (blended with AI on WhatsApp messages). The Follow-ups list shows “[Queue]” when the lead is above this
              score and has not written again since their last message (you replied last); due date is that message + delay days.
            </p>
          </div>

          {/* Human handover keywords */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <TriangleAlert className="h-4 w-4 text-red-400" />
              Human Handover Keywords
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Used for live replies and flags — when a customer message contains any of these, routing may request a human.
              Queued <span className="font-medium">auto follow-up</span> nudges are still sent (they do not use this block).
            </p>
            <KeywordInput
              keywords={form.humanHandoverKeywords}
              onChange={(kw) => set("humanHandoverKeywords", kw)}
            />
          </div>
        </Section>

        {/* ── Section 3: AI Tone ── */}
        <Section title="AI Tone" subtitle="Choose the voice and style of all automated messages">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TONE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => set("aiTone", opt.value)}
                className={cn(
                  "relative rounded-xl border-2 p-4 text-left transition",
                  form.aiTone === opt.value
                    ? opt.color + " shadow-sm"
                    : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900",
                )}
              >
                {form.aiTone === opt.value && (
                  <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                    <Check className="h-3 w-3 text-white" />
                  </span>
                )}
                <Sparkles className={cn(
                  "mb-2 h-5 w-5",
                  opt.value === "sales" ? "text-amber-500" :
                  opt.value === "friendly" ? "text-emerald-500" :
                  opt.value === "professional" ? "text-blue-500" : "text-violet-500"
                )} />
                <p className="font-semibold text-sm text-slate-900 dark:text-white">{opt.label}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{opt.desc}</p>
              </button>
            ))}
          </div>

          {/* Tone preview */}
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Preview — {form.aiTone}
            </p>
            <p className="text-sm text-slate-700 dark:text-slate-200 italic">
              {form.aiTone === "sales" && "\"Sir, is quantity ka best rate bata deta hoon — delivery pincode bhi bata dijiyega, main check karke confirm kar dunga! 😊\""}
              {form.aiTone === "friendly" && "\"Hey there! 😊 Just wanted to check in — did you get a chance to look at what we sent over?\""}
              {form.aiTone === "professional" && "\"Dear Sir/Madam, I am following up regarding our previous correspondence. Please let me know if you require further information.\""}
              {form.aiTone === "premium" && "\"As discussed, I wanted to ensure you had everything needed to make an informed decision. I'm available at your convenience.\""}
            </p>
          </div>
        </Section>

        {/* ── Section 4: AI Knowledge & Catalogue ── */}
        <Section
          title="AI Knowledge & Catalogue"
          subtitle="Knowledge base is loaded from the built-in product file. Only the catalogue link is configurable here."
        >
          {/* Knowledge base source notice */}
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/40 dark:bg-emerald-900/10">
            <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="text-xs text-emerald-700 dark:text-emerald-300">
              <p className="font-semibold">AgriBird knowledge base is active</p>
              <p className="mt-0.5 text-emerald-600/90 dark:text-emerald-400/90">
                All AI replies are sourced exclusively from{" "}
                <code className="rounded bg-emerald-100 px-1 py-0.5 font-mono text-[11px] dark:bg-emerald-900/50">
                  src/lib/knowledge.ts
                </code>
                {" "}— 53 products across 9 categories. To update product data, edit that file.
              </p>
              <p className="mt-1.5 flex items-center gap-1 font-medium">
                <ExternalLink className="h-3 w-3" />
                AgriBird · Satyam Techworks Pvt. Ltd. · Since 1996
              </p>
            </div>
          </div>

          <Toggle
            checked={form.autoShareCatalogue}
            onChange={(v) => set("autoShareCatalogue", v)}
            label="Auto-send catalogue PDF in product queries"
            description="When the customer asks about products or details, the PDF catalogue is sent automatically as a WhatsApp document."
            icon={MessageSquareText}
            accent="bg-blue-500"
          />

          {/* PDF file info */}
          <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900/40 dark:bg-blue-900/10">
            <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <div className="text-xs text-blue-700 dark:text-blue-300">
              <p className="font-semibold">Catalogue file: AgriBird Brochure.pdf</p>
              <p className="mt-0.5 text-blue-600/90 dark:text-blue-400/90">
                Located at{" "}
                <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-[11px] dark:bg-blue-900/50">
                  public/AgriBird Brochure.pdf
                </code>
                {" "}— sent as a WhatsApp document (Cloud API or QR). To replace it, drop a new PDF in the{" "}
                <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-[11px] dark:bg-blue-900/50">
                  public/
                </code>
                {" "}folder with the same name.
              </p>
            </div>
          </div>
        </Section>

        {/* ── Section 5: Message templates ── */}
        <Section title="Message Templates" subtitle="Customise automated messages sent to leads">

          {/* Greeting template */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <Globe className="h-4 w-4 text-slate-400" />
              Greeting Template
              <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800">
                Use {"{{name}}"} for personalisation
              </span>
            </label>
            <textarea
              value={form.greetingTemplate}
              onChange={(e) => set("greetingTemplate", e.target.value)}
              rows={4}
              placeholder="Hi {{name}}! 👋 Thanks for reaching out…"
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <p className="text-xs text-slate-400">
              {form.greetingTemplate.length} / 500 characters
            </p>
          </div>

          {/* Follow-up template */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <MessageSquareText className="h-4 w-4 text-slate-400" />
              Follow-up Template
            </label>
            <textarea
              value={form.followUpTemplate}
              onChange={(e) => set("followUpTemplate", e.target.value)}
              rows={4}
              placeholder="Hey {{name}}, just checking in…"
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <p className="text-xs text-slate-400">
              {form.followUpTemplate.length} / 500 characters
            </p>
          </div>
        </Section>

      </div>

      {/* Bottom save bar (sticky on mobile) */}
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-panel dark:border-slate-800 dark:bg-slate-900 sticky bottom-4">
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Zap className="h-4 w-4 text-primary" />
          {dirty ? (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Unsaved changes
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-emerald-500">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              All changes saved
            </span>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition",
            saved ? "bg-emerald-500" : "bg-primary hover:bg-primary/90",
            (saving || !dirty) && "opacity-50 cursor-not-allowed",
          )}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saving ? "Saving…" : saved ? "Saved!" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
