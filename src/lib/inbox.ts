import { getDb } from "@/lib/mongodb";
import { leadsCollection } from "@/lib/models/lead";
import { waMessagesCollection } from "@/lib/models/webhook-log";
import { getOrCreateSettings } from "@/lib/models/settings";
import { getQrSnapshot } from "@/lib/whatsapp-qr-connector";
import {
  canonicalWaContactKey,
  formatLeadPhoneFromCanonical,
} from "@/lib/wa-phone";
import type { Contact, ChatMessage, MessageChannel } from "@/lib/chat-data";

async function getActiveChannel(): Promise<MessageChannel | "all"> {
  const db = await getDb();
  const settings = await getOrCreateSettings(db);

  const hasStoredConnection = Boolean(
    settings.whatsapp?.token && settings.whatsapp.phoneNumberId
  );
  const hasEnvConnection = Boolean(
    process.env.WHATSAPP_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      !settings.whatsappEnvDisabled
  );
  const qrConnected = getQrSnapshot().state === "connected";

  if (hasStoredConnection || hasEnvConnection) return "api";
  if (qrConnected) return "qr";
  return "all";
}

export async function getInboxContacts(limitMessages = 1500): Promise<Contact[]> {
  const db = await getDb();
  const lCol = leadsCollection(db);
  const mCol = waMessagesCollection(db);

  const activeChannel = await getActiveChannel();

  const channelFilter =
    activeChannel === "qr"
      ? { phoneNumberId: "qr-linked" }
      : activeChannel === "api"
      ? { phoneNumberId: { $ne: "qr-linked" } }
      : {};

  const [leads, messages] = await Promise.all([
    lCol.find({}).sort({ updatedAt: -1 }).toArray(),
    mCol
      .find(channelFilter)
      .sort({ timestamp: -1 })
      .limit(limitMessages)
      .toArray(),
  ]);

  const msgByPhone: Record<string, ChatMessage[]> = {};
  const lastTsByKey: Record<string, number> = {};
  const nameByKey: Record<string, string> = {};
  const seenMessageIds = new Set<string>();

  for (const m of messages) {
    if (seenMessageIds.has(m.waMessageId)) continue;
    seenMessageIds.add(m.waMessageId);

    const key = canonicalWaContactKey(m.from);
    if (!key) continue;
    if (!msgByPhone[key]) msgByPhone[key] = [];

    const ts = new Date(m.timestamp).getTime();
    if (!lastTsByKey[key] || ts > lastTsByKey[key]) lastTsByKey[key] = ts;

    if (m.direction === "in" && m.senderName?.trim() && !nameByKey[key]) {
      nameByKey[key] = m.senderName.trim();
    }

    const d = new Date(m.timestamp);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    let dateStr: string;
    if (d >= today) dateStr = "Today";
    else if (d >= yesterday) dateStr = "Yesterday";
    else dateStr = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

    const channel: MessageChannel =
      m.phoneNumberId === "qr-linked" ? "qr" : "api";

    msgByPhone[key].push({
      id: m.waMessageId,
      text: m.text,
      direction: m.direction,
      timestamp: d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      date: dateStr,
      status: m.direction === "out" ? "delivered" : undefined,
      channel,
    });
  }

  const leadKeys = new Set(
    leads.map((l) => canonicalWaContactKey(l.phone)).filter(Boolean)
  );

  function buildContact(
    id: string,
    name: string,
    phone: string,
    key: string,
    lead?: (typeof leads)[0]
  ): Contact {
    const msgs = (msgByPhone[key] ?? []).slice().reverse();
    return {
      id,
      name,
      phone,
      source: lead?.source ?? "WhatsApp",
      status: lead?.status ?? "New",
      conversationStatus: lead?.conversationStatus,
      needsHuman: lead?.needsHuman ?? false,
      pendingHumanReply:
        Boolean(lead?.needsHuman) ||
        lead?.conversationStatus === "escalated" ||
        lead?.conversationStatus === "awaiting_team_reply",
      assignedTo: lead?.assignedTo ?? "Unassigned",
      online: false,
      unread: msgs.some((m) => m.direction === "in") ? 1 : 0,
      messages: msgs,
      notes: [],
    };
  }

  const fromLead: Contact[] = leads
    .filter((lead) => {
      if (activeChannel === "all") return true;
      const k = canonicalWaContactKey(lead.phone);
      return Boolean(k && msgByPhone[k]?.length);
    })
    .map((lead) => {
      const key = canonicalWaContactKey(lead.phone);
      return buildContact(lead._id!.toHexString(), lead.name, lead.phone, key, lead);
    });

  const orphanKeys = Object.keys(msgByPhone).filter((k) => !leadKeys.has(k));
  const fromOrphan: Contact[] = orphanKeys.map((key) =>
    buildContact(
      `__orphan_${key}`,
      nameByKey[key] ?? formatLeadPhoneFromCanonical(key),
      formatLeadPhoneFromCanonical(key),
      key
    )
  );

  const combined = [...fromLead, ...fromOrphan];
  combined.sort((a, b) => {
    const ka = canonicalWaContactKey(a.phone);
    const kb = canonicalWaContactKey(b.phone);
    return (lastTsByKey[kb] ?? 0) - (lastTsByKey[ka] ?? 0);
  });

  return combined;
}
