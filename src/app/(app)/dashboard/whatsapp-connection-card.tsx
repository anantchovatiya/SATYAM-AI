"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
  Unplug,
  Building2,
  WifiOff,
  PhoneCall,
  Send,
  MessageSquare,
} from "lucide-react";
import Image from "next/image";

type WhatsAppStats = {
  totalMessages: number;
  totalContacts: number;
  totalWhatsAppLeads: number;
  latestMessageAt: string | null;
  /** Rows saved from WhatsApp business-card images → Excel */
  businessCardsCollected?: number;
};

export type WhatsAppStatus = {
  connected: boolean;
  source: "dashboard" | "env" | "qr" | "none";
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  lastSyncAt: string | null;
  envDisabled?: boolean;
  hasEnvCredentials?: boolean;
  stats: WhatsAppStats;
  qr?: {
    state: "idle" | "connecting" | "qr_ready" | "connected" | "error";
    qrDataUrl: string | null;
    connectedPhone: string | null;
    error: string | null;
    updatedAt: string;
  };
};

export function WhatsAppConnectionCard({ initialStatus }: { initialStatus: WhatsAppStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [token, setToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState(status.phoneNumberId ?? "");
  const [verifyToken, setVerifyToken] = useState("satyam_ai_verify");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState<
    | "connect"
    | "sync"
    | "refresh"
    | "qr"
    | "qr_disconnect"
    | "cloud_disconnect"
    | "cloud_reconnect_env"
    | "test_send"
    | null
  >(null);
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Hello! This is a test message from Satyam AI CRM. ✅");
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    text: string;
    messageId?: string;
    channel?: string;
  } | null>(null);
  const [showTestPanel, setShowTestPanel] = useState(false);

  const qrState = status.qr?.state ?? "idle";
  const qrDataUrl = status.qr?.qrDataUrl ?? null;
  const shouldPollQr = useMemo(
    () => qrState === "connecting" || qrState === "qr_ready",
    [qrState]
  );

  const qrActive = status.source === "qr";
  const cloudActive = status.source === "dashboard" || status.source === "env";

  const refreshStatus = useCallback(async (silent = false) => {
    if (!silent) setLoading("refresh");
    setError("");
    try {
      const res = await fetch("/api/whatsapp/connect", { cache: "no-store" });
      const data = (await res.json()) as WhatsAppStatus & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load WhatsApp status.");
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load WhatsApp status.");
    } finally {
      if (!silent) setLoading(null);
    }
  }, []);

  useEffect(() => {
    if (!shouldPollQr) return;
    const timer = setInterval(() => {
      refreshStatus(true).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [shouldPollQr, refreshStatus]);

  async function connectViaQr() {
    setLoading("qr");
    setError("");
    setOk("");
    try {
      const action = qrActive ? "qr_restart" : "qr_start";
      const res = await fetch("/api/whatsapp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not start QR connection.");
      setOk(
        qrActive
          ? "Reconnect started. Scan the new QR to switch linked WhatsApp."
          : "QR session started. Scan the QR with WhatsApp on your phone."
      );
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start QR connection.");
    } finally {
      setLoading(null);
    }
  }

  async function disconnectQr() {
    setLoading("qr_disconnect");
    setError("");
    setOk("");
    try {
      const res = await fetch("/api/whatsapp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "qr_disconnect" }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not disconnect.");
      setOk("QR session disconnected.");
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect.");
    } finally {
      setLoading(null);
    }
  }

  async function connectWhatsApp(e: React.FormEvent) {
    e.preventDefault();
    setLoading("connect");
    setError("");
    setOk("");
    try {
      const res = await fetch("/api/whatsapp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, phoneNumberId, verifyToken }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not connect WhatsApp.");
      setOk("WhatsApp Business API connected. Data synced successfully.");
      setToken("");
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect WhatsApp.");
    } finally {
      setLoading(null);
    }
  }

  async function disconnectCloud() {
    setLoading("cloud_disconnect");
    setError("");
    setOk("");
    try {
      const res = await fetch("/api/whatsapp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cloud_disconnect" }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not disconnect.");
      setOk("WhatsApp Business API disconnected.");
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect.");
    } finally {
      setLoading(null);
    }
  }

  async function reconnectEnv() {
    setLoading("cloud_reconnect_env");
    setError("");
    setOk("");
    try {
      const res = await fetch("/api/whatsapp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cloud_reconnect_env" }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not reconnect.");
      setOk("WhatsApp Business API re-enabled.");
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reconnect.");
    } finally {
      setLoading(null);
    }
  }

  async function syncData() {
    setLoading("sync");
    setError("");
    setOk("");
    try {
      const res = await fetch("/api/whatsapp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Sync failed.");
      setOk("WhatsApp data fetch completed.");
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setLoading(null);
    }
  }

  async function sendTestMessage(e: React.FormEvent) {
    e.preventDefault();
    setLoading("test_send");
    setTestResult(null);
    try {
      const res = await fetch("/api/inbox/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testPhone, text: testMessage }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        channel?: string;
        messageId?: string;
        mode?: string;
      };
      if (!res.ok || !data.ok) {
        setTestResult({ ok: false, text: data.error ?? "Failed to send message." });
      } else {
        setTestResult({
          ok: true,
          text: `Accepted by ${data.channel === "qr" ? "QR/Baileys" : "Meta Business API"}`,
          messageId: data.messageId,
          channel: data.channel,
        });
      }
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : "Send failed." });
    } finally {
      setLoading(null);
    }
  }

  const latestMessage = status.stats.latestMessageAt
    ? new Date(status.stats.latestMessageAt).toLocaleString("en-IN")
    : "No messages yet";
  const lastSync = status.lastSyncAt
    ? new Date(status.lastSyncAt).toLocaleString("en-IN")
    : "Never";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel dark:border-slate-800 dark:bg-slate-900">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
            <Smartphone className="h-4 w-4 text-emerald-500" />
            WhatsApp Integration
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Choose one connection method. Only one can be active at a time.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
            status.connected
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
          }`}
        >
          {status.connected ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <Unplug className="h-3.5 w-3.5" />
          )}
          {status.connected ? `Connected via ${status.source}` : "Not connected"}
        </span>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Stat label="Messages" value={String(status.stats.totalMessages)} />
        <Stat label="Contacts" value={String(status.stats.totalContacts)} />
        <Stat label="WhatsApp Leads" value={String(status.stats.totalWhatsAppLeads)} />
        <Stat
          label="Business cards"
          value={String(status.stats.businessCardsCollected ?? 0)}
          sub={
            <a
              href="/api/business-cards"
              className="mt-0.5 block text-[10px] font-medium text-primary underline-offset-2 hover:underline"
            >
              Download Excel
            </a>
          }
        />
        <Stat label="Latest Message" value={latestMessage} />
      </div>

      {/* Two sections */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {/* ── Section 1: QR Login ── */}
        <ConnectionSection
          active={qrActive}
          blocked={cloudActive}
          blockedReason="Disconnect Business API first to use QR login."
          icon={<QrCode className="h-4 w-4" />}
          title="QR Login"
          badge={
            qrActive
              ? "Connected"
              : qrState !== "idle"
              ? qrStateLabel(qrState)
              : undefined
          }
          badgeColor={qrActive ? "emerald" : "amber"}
          description="Scan a QR code with your phone to connect — works like WhatsApp Web."
        >
          {qrActive ? (
            /* Connected state */
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-900/20">
                <PhoneCall className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  {status.qr?.connectedPhone ?? "Connected"}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={loading !== null}
                  onClick={connectViaQr}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {loading === "qr" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Reconnect
                </button>
                <button
                  type="button"
                  disabled={loading !== null}
                  onClick={disconnectQr}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-60 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
                >
                  {loading === "qr_disconnect" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5" />
                  )}
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            /* Idle / QR scanning state */
            <div className="space-y-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Open WhatsApp → Linked Devices → Link a Device → scan the QR.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={loading !== null}
                  onClick={connectViaQr}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
                >
                  {loading === "qr" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <QrCode className="h-4 w-4" />
                  )}
                  {qrState === "idle" || qrState === "error" ? "Start QR Session" : "Reconnect QR"}
                </button>
                {(qrState === "connecting" || qrState === "qr_ready") && (
                  <button
                    type="button"
                    disabled={loading !== null}
                    onClick={disconnectQr}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-60 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
                  >
                    {loading === "qr_disconnect" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <WifiOff className="h-4 w-4" />
                    )}
                    Cancel
                  </button>
                )}
              </div>
              {qrState !== "idle" && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Status: <strong>{qrStateLabel(qrState)}</strong>
                </p>
              )}
              {qrDataUrl && (
                <div>
                  <Image
                    src={qrDataUrl}
                    alt="WhatsApp QR Code"
                    width={192}
                    height={192}
                    className="h-48 w-48 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700"
                  />
                </div>
              )}
              {status.qr?.error && (
                <p className="text-xs text-red-500">{status.qr.error}</p>
              )}
            </div>
          )}
        </ConnectionSection>

        {/* ── Section 2: WhatsApp Business API ── */}
        <ConnectionSection
          active={cloudActive}
          blocked={qrActive}
          blockedReason="Disconnect QR login first to use Business API."
          icon={<Building2 className="h-4 w-4" />}
          title="WhatsApp Business API"
          badge={cloudActive ? "Connected" : undefined}
          badgeColor="emerald"
          description="Connect using Meta Cloud API credentials from the Meta Developer Console."
        >
          {cloudActive ? (
            /* Connected state */
            <div className="space-y-3">
              <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs dark:bg-emerald-900/20">
                <p className="font-medium text-emerald-700 dark:text-emerald-300">
                  {status.verifiedName ?? "Connected"}
                </p>
                {status.displayPhoneNumber && (
                  <p className="mt-0.5 text-emerald-600/80 dark:text-emerald-400/80">
                    {status.displayPhoneNumber}
                  </p>
                )}
                <p className="mt-0.5 text-emerald-600/70 dark:text-emerald-400/70">
                  Last sync: {lastSync}
                </p>
                {status.source === "env" && (
                  <p className="mt-1 text-slate-500 dark:text-slate-400">
                    Source: environment variables
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={loading !== null}
                  onClick={syncData}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary/90 disabled:opacity-60"
                >
                  {loading === "sync" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Fetch Data
                </button>
                <button
                  type="button"
                  disabled={loading !== null}
                  onClick={disconnectCloud}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-60 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
                >
                  {loading === "cloud_disconnect" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5" />
                  )}
                  Disconnect
                </button>
              </div>
            </div>
          ) : status.envDisabled && status.hasEnvCredentials ? (
            /* Env was manually disabled — offer to re-enable */
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-900/40 dark:bg-amber-900/10">
                <p className="font-medium text-amber-700 dark:text-amber-300">
                  Disconnected (env credentials exist but are disabled)
                </p>
                <p className="mt-0.5 text-amber-600/80 dark:text-amber-400/80">
                  Your <code>.env</code> credentials are still present. Re-enable to connect again.
                </p>
              </div>
              <button
                type="button"
                disabled={loading !== null}
                onClick={reconnectEnv}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
              >
                {loading === "cloud_reconnect_env" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Re-enable Connection
              </button>
            </div>
          ) : (
            /* Connect form */
            <form onSubmit={connectWhatsApp} className="space-y-3">
              <label className="block text-xs text-slate-500 dark:text-slate-400">
                Access Token
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  type="password"
                  placeholder="EAAB..."
                  required
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-400">
                Phone Number ID
                <input
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="1163979433458067"
                  required
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-400">
                Verify Token{" "}
                <span className="text-slate-400">(for webhook)</span>
                <input
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  placeholder="satyam_ai_verify"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <button
                type="submit"
                disabled={loading !== null}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90 disabled:opacity-60"
              >
                {loading === "connect" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Connect & Fetch Data
              </button>
            </form>
          )}
        </ConnectionSection>
      </div>

      {/* Test Message Panel */}
      {status.connected && (
        <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => {
              setShowTestPanel((v) => !v);
              setTestResult(null);
            }}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <MessageSquare className="h-4 w-4 text-primary" />
              Send Test Message
            </span>
            <span className="text-xs text-slate-400">
              {showTestPanel ? "▲ Hide" : "▼ Expand"}
            </span>
          </button>

          {showTestPanel && (
            <div className="border-t border-slate-200 px-4 pb-4 pt-3 dark:border-slate-700">
              {/* Business API restriction notice */}
              {(status.source === "env" || status.source === "dashboard") && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900/40 dark:bg-amber-900/10">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    ⚠️ WhatsApp Business API — 24-hour window rule
                  </p>
                  <p className="mt-1 text-xs text-amber-700/90 dark:text-amber-300/90">
                    Free-form messages only deliver if the recipient <strong>messaged your business number first</strong> within the last 24 hours.
                    Outside that window the API returns success but the message is <strong>silently dropped</strong> by Meta.
                  </p>
                  <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <strong>Fix:</strong> Have the recipient send any message to your WhatsApp Business number first, then test again. Or use an approved template message.
                  </p>
                </div>
              )}

              <form onSubmit={sendTestMessage} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs text-slate-500 dark:text-slate-400">
                    Recipient phone number
                    <input
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      placeholder="919879374135"
                      required
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950"
                    />
                    <span className="mt-0.5 block text-slate-400">
                      Country code without + (e.g. 919876543210)
                    </span>
                  </label>
                  <label className="block text-xs text-slate-500 dark:text-slate-400">
                    Message
                    <textarea
                      value={testMessage}
                      onChange={(e) => setTestMessage(e.target.value)}
                      rows={3}
                      required
                      className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-start gap-3">
                  <button
                    type="submit"
                    disabled={loading !== null}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90 disabled:opacity-60"
                  >
                    {loading === "test_send" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {loading === "test_send" ? "Sending…" : "Send Test Message"}
                  </button>

                  {testResult && (
                    <div
                      className={`rounded-lg px-3 py-2 text-xs ${
                        testResult.ok
                          ? "border border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-900/10"
                          : "border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/10"
                      }`}
                    >
                      <p
                        className={`font-semibold ${
                          testResult.ok
                            ? "text-emerald-700 dark:text-emerald-300"
                            : "text-red-700 dark:text-red-300"
                        }`}
                      >
                        {testResult.ok ? "✓ Request accepted" : "✗ " + testResult.text}
                      </p>
                      {testResult.ok && (
                        <>
                          <p className="mt-0.5 text-slate-600 dark:text-slate-400">
                            Channel: <strong>{testResult.channel === "qr" ? "QR / Baileys" : "Meta Business API"}</strong>
                          </p>
                          {testResult.messageId && (
                            <p className="mt-0.5 font-mono text-slate-500 dark:text-slate-400">
                              ID: {testResult.messageId}
                            </p>
                          )}
                          {testResult.channel !== "qr" && (
                            <p className="mt-1 text-amber-600 dark:text-amber-400">
                              If not received: the recipient must message your business number first (24-hour rule).
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Refresh + messages */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => refreshStatus().catch(() => {})}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          {loading === "refresh" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh Status
        </button>
        {(error || ok) && (
          <p className={`text-xs ${error ? "text-red-500" : "text-emerald-500"}`}>
            {error || ok}
          </p>
        )}
      </div>
    </section>
  );
}

function qrStateLabel(state: string): string {
  switch (state) {
    case "connecting":
      return "Connecting…";
    case "qr_ready":
      return "Scan QR";
    case "connected":
      return "Connected";
    case "error":
      return "Error";
    default:
      return state;
  }
}

function ConnectionSection({
  active,
  blocked,
  blockedReason,
  icon,
  title,
  badge,
  badgeColor,
  description,
  children,
}: {
  active: boolean;
  blocked: boolean;
  blockedReason: string;
  icon: React.ReactNode;
  title: string;
  badge?: string;
  badgeColor?: "emerald" | "amber";
  description: string;
  children: React.ReactNode;
}) {
  const borderColor = active
    ? "border-emerald-300 dark:border-emerald-700"
    : blocked
    ? "border-slate-200 dark:border-slate-700 opacity-60"
    : "border-slate-200 dark:border-slate-700";

  const bgColor = active
    ? "bg-emerald-50/50 dark:bg-emerald-900/10"
    : "bg-slate-50/50 dark:bg-slate-800/30";

  return (
    <div className={`rounded-xl border p-4 transition-all ${borderColor} ${bgColor}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-lg ${
              active
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
            }`}
          >
            {icon}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          </div>
        </div>
        {badge && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              badgeColor === "emerald"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            }`}
          >
            <CheckCircle2 className="h-3 w-3" />
            {badge}
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{description}</p>

      {blocked ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/40 dark:bg-amber-900/10">
          <Unplug className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-700 dark:text-amber-300">{blockedReason}</p>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{value}</p>
      {sub}
    </div>
  );
}
