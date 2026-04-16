"use client";

import { useState } from "react";
import { Plus, MessageSquare, Mail, Phone, Pencil, Trash2, X, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import type { TemplateRow, TemplateChannel } from "@/lib/models/template";

const CHANNEL_STYLES: Record<TemplateChannel, string> = {
  WhatsApp: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Email:    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  SMS:      "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
};

const CHANNEL_ICON: Record<TemplateChannel, React.ReactNode> = {
  WhatsApp: <MessageSquare className="h-3.5 w-3.5" />,
  Email:    <Mail className="h-3.5 w-3.5" />,
  SMS:      <Phone className="h-3.5 w-3.5" />,
};

interface Props { templates: TemplateRow[] }

export function TemplatesClient({ templates: initial }: Props) {
  const [items, setItems]     = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [form, setForm]       = useState({ name: "", channel: "WhatsApp" as TemplateChannel, body: "", tags: "" });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          channel: form.channel,
          body: form.body,
          tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      const { id } = await res.json() as { id: string };
      const now = new Date().toISOString();
      setItems((prev) => [{
        id, name: form.name, channel: form.channel, body: form.body,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        usageCount: 0, createdAt: new Date(now), updatedAt: new Date(now),
      }, ...prev]);
      setForm({ name: "", channel: "WhatsApp", body: "", tags: "" });
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setItems((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Templates</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Reusable message blocks · {items.length} saved
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow hover:bg-primary/90 transition"
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? "Cancel" : "New Template"}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="rounded-2xl border border-violet-200 bg-violet-50/50 p-5 dark:border-violet-900/40 dark:bg-violet-950/20 space-y-4">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">Create Template</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Name</label>
              <input
                required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-900"
                placeholder="Welcome Sequence"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Channel</label>
              <select
                value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as TemplateChannel })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-900"
              >
                <option>WhatsApp</option>
                <option>Email</option>
                <option>SMS</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Message Body</label>
            <textarea
              required rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-900"
              placeholder="Hi {name}, welcome to SATYAM AI! ..."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Tags (comma separated)</label>
            <input
              value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-900"
              placeholder="greeting, onboarding"
            />
          </div>
          <button
            type="submit" disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition"
          >
            <Check className="h-4 w-4" />
            {saving ? "Saving…" : "Save Template"}
          </button>
        </form>
      )}

      {/* Empty state */}
      {items.length === 0 && !showForm && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 py-20 dark:border-slate-800">
          <MessageSquare className="h-10 w-10 text-slate-300 dark:text-slate-700" />
          <p className="text-slate-500">No templates yet.</p>
          <button onClick={() => setShowForm(true)} className="text-sm text-primary hover:underline">
            Create your first template →
          </button>
        </div>
      )}

      {/* Grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((t) => (
          <div key={t.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-panel dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-slate-800 dark:text-slate-100 line-clamp-1">{t.name}</p>
              <div className="flex gap-1">
                <button onClick={() => handleDelete(t.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition dark:hover:bg-red-900/20">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <span className={cn("flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", CHANNEL_STYLES[t.channel])}>
              {CHANNEL_ICON[t.channel]} {t.channel}
            </span>
            <p className="flex-1 text-sm text-slate-500 dark:text-slate-400 line-clamp-3">{t.body}</p>
            {t.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {t.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-400 dark:border-slate-800">
              <span>Used {t.usageCount}×</span>
              <span className="flex items-center gap-1">
                <Pencil className="h-3 w-3" />
                {new Date(t.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
