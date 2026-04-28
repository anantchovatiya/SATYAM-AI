"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { type Contact, type ChatMessage, type ChatNote } from "@/lib/chat-data";
import { cn } from "@/lib/cn";
import {
  ArrowLeft,
  Bot,
  CheckCheck,
  Check,
  Clock,
  Lightbulb,
  Paperclip,
  Search,
  Send,
  StickyNote,
  Smile,
  Plus,
  Phone,
  MoreVertical,
} from "lucide-react";

// ── Emoji picker data ──────────────────────────────────────────────────────────
const EMOJI_GROUPS = [
  { label: "Smileys", emojis: ["😀","😊","😂","🤣","😍","🥰","😎","😅","😆","🤩","😇","🥳","😜","😏","🤔","😬","😴","😢","😤","🙄"] },
  { label: "Gestures", emojis: ["👍","👎","👏","🙌","🤝","👋","✌️","🤞","👌","🤙","💪","🙏","🫡","🫶","❤️","🔥","⭐","✅","🎉","💯"] },
  { label: "Objects",  emojis: ["📱","💻","📧","📎","🔗","📅","📊","💡","🔔","⏰","📝","🗂️","🚀","🎯","💼","🏆","💰","📈","🔑","✨"] },
];

function EmojiPicker({ onSelect, onClose }: { onSelect: (e: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-2 z-50 w-72 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900"
    >
      {EMOJI_GROUPS.map((group) => (
        <div key={group.label} className="mb-2">
          <p className="mb-1 text-xs font-semibold text-slate-400 uppercase tracking-wide">{group.label}</p>
          <div className="flex flex-wrap gap-1">
            {group.emojis.map((emoji) => (
              <button
                key={emoji}
                onClick={() => onSelect(emoji)}
                className="rounded p-1 text-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Status tick icons ──────────────────────────────────────────────────────────
function MessageTick({ status }: { status?: string }) {
  if (!status) return null;
  if (status === "read")      return <CheckCheck className="h-3.5 w-3.5 text-blue-400" />;
  if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5 text-slate-400" />;
  if (status === "sent")      return <Check className="h-3.5 w-3.5 text-slate-400" />;
  return <Clock className="h-3 w-3 text-slate-400" />;
}

// ── Contact list item ──────────────────────────────────────────────────────────
const STATUS_DOT: Record<string, string> = {
  Hot:    "bg-red-500",
  New:    "bg-blue-500",
  Silent: "bg-amber-400",
  Closed: "bg-slate-400",
};

function StatusDot({ status }: { status: string }) {
  return <span className={cn("h-2 w-2 rounded-full flex-shrink-0", STATUS_DOT[status] ?? "bg-slate-400")} />;
}

function ContactItem({ contact, active, onClick }: { contact: Contact; active: boolean; onClick: () => void }) {
  const lastMsg = contact.messages.at(-1);
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-left transition",
        active
          ? "bg-primary/10 dark:bg-primary/20"
          : "hover:bg-slate-50 dark:hover:bg-slate-800/60",
      )}
    >
      <div className="relative flex-shrink-0">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-base font-bold text-primary">
          {contact.name[0]}
        </span>
        {contact.online && (
          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <StatusDot status={contact.status} />
            <p className={cn("truncate text-sm font-semibold", active ? "text-primary" : "text-slate-900 dark:text-white")}>
              {contact.name}
            </p>
          </div>
          <span className="ml-2 flex-shrink-0 text-xs text-slate-400">{lastMsg?.timestamp}</span>
        </div>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {lastMsg?.direction === "out" && <span className="text-primary">You: </span>}
            {lastMsg?.text}
          </p>
          {contact.unread > 0 && (
            <span className="ml-1 flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
              {contact.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Date separator ─────────────────────────────────────────────────────────────
function DateSeparator({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 border-t border-slate-200 dark:border-slate-700" />
      <span className="rounded-full bg-slate-100 px-3 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        {date}
      </span>
      <div className="flex-1 border-t border-slate-200 dark:border-slate-700" />
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isOut = msg.direction === "out";
  const isPlaceholderOnly =
    Boolean(msg.mediaSrc) &&
    (msg.text === "[Image]" ||
      msg.text === "[Video]" ||
      msg.text === "[Document]" ||
      msg.text === "[Sticker]" ||
      msg.text === "[Voice message]" ||
      (isOut &&
        ((msg.mediaKind === "image" && msg.text.trimStart().startsWith("📷")) ||
          (msg.mediaKind === "document" && msg.text.trimStart().startsWith("📄")))));

  return (
    <div className={cn("flex items-end gap-2", isOut ? "flex-row-reverse" : "flex-row")}>
      {!isOut && (
        <div className="mb-1 h-7 w-7 flex-shrink-0 flex items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          L
        </div>
      )}
      <div
        className={cn(
          "group relative max-w-[72%] rounded-2xl px-4 py-2.5 shadow-sm",
          isOut
            ? "rounded-br-sm bg-primary text-white"
            : "rounded-bl-sm bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100",
        )}
      >
        {(msg.mediaKind === "image" || msg.mediaKind === "sticker") && msg.mediaSrc && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- session-authenticated media URL */}
            <img
              src={msg.mediaSrc}
              alt=""
              className="mb-2 max-h-56 max-w-full rounded-lg object-contain"
            />
          </>
        )}
        {msg.mediaKind === "video" && msg.mediaSrc && (
          <video src={msg.mediaSrc} controls className="mb-2 max-h-56 max-w-full rounded-lg" />
        )}
        {msg.mediaKind === "audio" && msg.mediaSrc && (
          <audio src={msg.mediaSrc} controls className="mb-2 w-full max-w-[260px]" />
        )}
        {msg.mediaKind === "document" && msg.mediaSrc && (
          <a
            href={msg.mediaSrc}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "mb-2 inline-block text-sm font-medium underline",
              isOut ? "text-white/90" : "text-primary",
            )}
          >
            Open document
          </a>
        )}
        {!isPlaceholderOnly && (
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>
        )}
        <div className={cn("mt-1 flex items-center gap-1", isOut ? "justify-end" : "justify-start")}>
          <span className={cn("text-[10px]", isOut ? "text-primary-foreground/70" : "text-slate-400")}>
            {msg.timestamp}
          </span>
          {isOut && <MessageTick status={msg.status} />}
        </div>
      </div>
    </div>
  );
}

// ── Right panel tabs ───────────────────────────────────────────────────────────
type RightTab = "chat" | "notes" | "ai";

// ── Main component ─────────────────────────────────────────────────────────────
export function InboxClient({ initialContacts }: { initialContacts: Contact[] }) {
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [activeId, setActiveId] = useState<string | null>(initialContacts[0]?.id ?? null);
  const [search, setSearch] = useState("");
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<RightTab>("chat");
  const [showEmoji, setShowEmoji] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);
  const sendLockRef = useRef(false);

  const active = contacts.find((c) => c.id === activeId) ?? null;

  const filteredContacts = contacts.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search)
  );
  const pendingContacts = filteredContacts.filter((c) => c.pendingHumanReply);
  const nonPendingContacts = filteredContacts.filter((c) => !c.pendingHumanReply);

  const applyServerContacts = useCallback((nextContacts: Contact[]) => {
    setContacts((prev) => {
      const noteMap = new Map(prev.map((c) => [c.id, c.notes]));
      return nextContacts.map((c) => ({
        ...c,
        notes: noteMap.get(c.id) ?? c.notes,
      }));
    });
    setActiveId((current) => {
      if (current && nextContacts.some((c) => c.id === current)) return current;
      return nextContacts[0]?.id ?? null;
    });
  }, []);

  const refreshInbox = useCallback(async () => {
    const res = await fetch("/api/inbox/contacts", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { contacts?: Contact[] };
    if (!Array.isArray(data.contacts)) return;
    applyServerContacts(data.contacts);
  }, [applyServerContacts]);

  useEffect(() => {
    pollRef.current = window.setInterval(() => {
      refreshInbox().catch(() => {});
    }, 4000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [refreshInbox]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeId, active?.messages.length]);

  // Group messages by date
  function groupByDate(messages: ChatMessage[]) {
    const groups: { date: string; messages: ChatMessage[] }[] = [];
    for (const msg of messages) {
      const last = groups.at(-1);
      if (last && last.date === msg.date) {
        last.messages.push(msg);
      } else {
        groups.push({ date: msg.date, messages: [msg] });
      }
    }
    return groups;
  }

  function selectContact(id: string) {
    setActiveId(id);
    setTab("chat");
    setMobileShowChat(true);
    // Clear unread
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c))
    );
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || !activeId || !active || sending || sendLockRef.current) return;

    sendLockRef.current = true;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/inbox/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: active.phone, text }),
      });
      const data = (await res.json()) as {
        error?: string;
        message?: ChatMessage;
      };
      if (!res.ok || !data.message) {
        throw new Error(data.error ?? "Failed to send WhatsApp message.");
      }

      setInput("");
      await refreshInbox();
      inputRef.current?.focus();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send WhatsApp message.");
    } finally {
      setSending(false);
      sendLockRef.current = false;
    }
  }

  async function sendAttachment(file: File) {
    if (!active?.phone || sending || sendLockRef.current) return;
    sendLockRef.current = true;
    setSending(true);
    setSendError(null);
    try {
      const fd = new FormData();
      fd.set("to", active.phone);
      fd.set("file", file);
      const res = await fetch("/api/inbox/send-media", { method: "POST", body: fd });
      const data = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Failed to send attachment.");
      }
      await refreshInbox();
      inputRef.current?.focus();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send attachment.");
    } finally {
      setSending(false);
      sendLockRef.current = false;
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function insertEmoji(emoji: string) {
    setInput((v) => v + emoji);
    setShowEmoji(false);
    inputRef.current?.focus();
  }

  const addNote = useCallback(() => {
    const text = newNote.trim();
    if (!text || !activeId) return;
    const note: ChatNote = {
      id: `note-${Date.now()}`,
      text,
      author: "Satyam",
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
    };
    setContacts((prev) =>
      prev.map((c) =>
        c.id === activeId ? { ...c, notes: [...c.notes, note] } : c
      )
    );
    setNewNote("");
  }, [newNote, activeId]);

  function applySuggestion(text: string) {
    setInput(text);
    setTab("chat");
    inputRef.current?.focus();
  }

  const totalUnread = contacts.reduce((s, c) => s + c.unread, 0);
  // AI suggestions are generated dynamically via /api/generate-reply
  const suggestions: string[] = [];

  return (
    <div className="flex h-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel dark:border-slate-800 dark:bg-slate-950">

      {/* ── LEFT SIDEBAR ── */}
      <div className={cn(
        "flex w-full flex-col border-r border-slate-200 dark:border-slate-800 md:w-80 md:flex-shrink-0",
        mobileShowChat ? "hidden md:flex" : "flex",
      )}>
        {/* Sidebar header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Inbox</h2>
            {totalUnread > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-white">
                {totalUnread}
              </span>
            )}
          </div>
          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800">
            <Search className="h-4 w-4 flex-shrink-0 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Contact list */}
        <div className="flex-1 overflow-y-auto">
          {filteredContacts.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">No contacts found.</p>
          ) : (
            <>
              {pendingContacts.length > 0 && (
                <div className="border-b border-slate-100 pb-1 dark:border-slate-800">
                  <div className="flex items-center justify-between px-4 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                      Pending for Reply
                    </p>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                      {pendingContacts.length}
                    </span>
                  </div>
                  {pendingContacts.map((c) => (
                    <ContactItem
                      key={c.id}
                      contact={c}
                      active={c.id === activeId}
                      onClick={() => selectContact(c.id)}
                    />
                  ))}
                </div>
              )}

              {nonPendingContacts.length > 0 && (
                <div>
                  <div className="px-4 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      All Chats
                    </p>
                  </div>
                  {nonPendingContacts.map((c) => (
                    <ContactItem
                      key={c.id}
                      contact={c}
                      active={c.id === activeId}
                      onClick={() => selectContact(c.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      {!active ? (
        <div className="hidden flex-1 flex-col items-center justify-center gap-3 text-center md:flex">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
            <Bot className="h-8 w-8 text-slate-400" />
          </div>
          <p className="font-medium text-slate-600 dark:text-slate-300">Select a conversation</p>
          <p className="text-sm text-slate-400">Choose a contact from the left to open the chat.</p>
        </div>
      ) : (
        <div className={cn(
          "flex-1 flex-col overflow-hidden",
          mobileShowChat ? "flex" : "hidden md:flex",
        )}>
          {/* Chat header */}
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <button
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden"
              onClick={() => setMobileShowChat(false)}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="relative">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                {active.name[0]}
              </span>
              {active.online && (
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-950" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900 dark:text-white">{active.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {active.online ? (
                  <span className="text-emerald-500">● Online</span>
                ) : (
                  active.phone
                )}
              </p>
            </div>
            {/* Tab switcher in header */}
            <div className="hidden items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800 sm:flex">
              {(["chat", "notes", "ai"] as RightTab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                    tab === t
                      ? "bg-white text-primary shadow-sm dark:bg-slate-700 dark:text-primary"
                      : "text-slate-500 hover:text-slate-700 dark:text-slate-400",
                  )}
                >
                  {t === "chat"  && <><Phone className="h-3 w-3" />Chat</>}
                  {t === "notes" && <><StickyNote className="h-3 w-3" />Notes</>}
                  {t === "ai"    && <><Lightbulb className="h-3 w-3" />AI</>}
                </button>
              ))}
            </div>
            <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>

          {/* ── CHAT TAB ── */}
          {tab === "chat" && (
            <>
              {/* Messages area */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-slate-50/50 dark:bg-slate-900/30">
                {groupByDate(active.messages).map(({ date, messages }) => (
                  <div key={date}>
                    <DateSeparator date={date} />
                    <div className="space-y-2">
                      {messages.map((msg) => (
                        <MessageBubble key={msg.id} msg={msg} />
                      ))}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <div className="border-t border-slate-100 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-900">
                  {/* Emoji */}
                  <div className="relative">
                    <button
                      onClick={() => setShowEmoji((v) => !v)}
                      className="mt-1 rounded-lg p-1.5 text-slate-400 hover:text-primary transition"
                    >
                      <Smile className="h-5 w-5" />
                    </button>
                    {showEmoji && (
                      <EmojiPicker
                        onSelect={insertEmoji}
                        onClose={() => setShowEmoji(false)}
                      />
                    )}
                  </div>

                  {/* Attachment */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void sendAttachment(f);
                    }}
                  />
                  <button
                    type="button"
                    title="Send photo or PDF"
                    disabled={sending || !active}
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-1 rounded-lg p-1.5 text-slate-400 transition hover:text-primary disabled:opacity-40"
                  >
                    <Paperclip className="h-5 w-5" />
                  </button>

                  {/* Textarea */}
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message… (Enter to send)"
                    rows={1}
                    className="flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-slate-400 max-h-32"
                    style={{ lineHeight: "1.5" }}
                  />

                  {/* Send */}
                  <button
                    onClick={sendMessage}
                    disabled={!input.trim() || sending}
                    className="mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-white transition hover:bg-primary/90 disabled:opacity-40"
                  >
                    {sending ? <Clock className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1 text-center text-[10px] text-slate-400">
                  Shift + Enter for new line
                </p>
                {sendError && (
                  <p className="mt-1 text-center text-[11px] text-red-500">{sendError}</p>
                )}
              </div>
            </>
          )}

          {/* ── NOTES TAB ── */}
          {tab === "notes" && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto space-y-3 p-4">
                {active.notes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
                    <StickyNote className="h-10 w-10 text-slate-300 dark:text-slate-700" />
                    <p className="text-sm text-slate-400">No notes yet. Add the first one.</p>
                  </div>
                ) : (
                  active.notes.map((note) => (
                    <div
                      key={note.id}
                      className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-900/20"
                    >
                      <p className="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap">{note.text}</p>
                      <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                        <span className="font-medium text-amber-600 dark:text-amber-400">— {note.author}</span>
                        <span>{note.timestamp}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {/* Add note input */}
              <div className="border-t border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                <div className="flex gap-2">
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Add a note about this lead…"
                    rows={2}
                    className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-amber-400 dark:border-slate-700 dark:bg-slate-900"
                  />
                  <button
                    onClick={addNote}
                    disabled={!newNote.trim()}
                    className="self-end rounded-xl bg-amber-400 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40 transition"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── AI SUGGESTIONS TAB ── */}
          {tab === "ai" && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-900/40 dark:bg-violet-900/20">
                  <Bot className="h-5 w-5 flex-shrink-0 text-violet-500" />
                  <p className="text-sm text-violet-700 dark:text-violet-300">
                    Based on this conversation, here are my suggested replies:
                  </p>
                </div>

                {suggestions.map((s, i) => (
                  <div
                    key={i}
                    className="group rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <p className="text-sm text-slate-700 dark:text-slate-200">{s}</p>
                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={() => applySuggestion(s)}
                        className="rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-white hover:bg-primary/90 transition"
                      >
                        Use this reply →
                      </button>
                    </div>
                  </div>
                ))}

                <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center dark:border-slate-700">
                  <p className="text-xs text-slate-400">More AI features (tone adjustment, translation) coming soon.</p>
                </div>
              </div>

              {/* Quick action bar */}
              <div className="border-t border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                <p className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Quick Actions</p>
                <div className="flex flex-wrap gap-2">
                  {["Send pricing", "Schedule demo", "Share brochure", "Mark as hot"].map((action) => (
                    <button
                      key={action}
                      onClick={() => applySuggestion(action)}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-primary/40 hover:text-primary transition dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Mobile tab bar */}
          <div className="flex border-t border-slate-100 dark:border-slate-800 sm:hidden">
            {(["chat", "notes", "ai"] as RightTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 py-2.5 text-xs font-medium transition",
                  tab === t ? "text-primary border-t-2 border-primary -mt-px" : "text-slate-400",
                )}
              >
                {t === "chat"  && <><Phone className="h-3.5 w-3.5" />Chat</>}
                {t === "notes" && <><StickyNote className="h-3.5 w-3.5" />Notes</>}
                {t === "ai"    && <><Lightbulb className="h-3.5 w-3.5" />AI</>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
