import { getDb } from "@/lib/mongodb";
import { leadsCollection } from "@/lib/models/lead";
import { waMessagesCollection } from "@/lib/models/webhook-log";
import { getOrCreateSettings } from "@/lib/models/settings";
import { getQrSnapshot } from "@/lib/whatsapp-qr-connector";
import type { Contact, ChatMessage, MessageChannel } from "@/lib/chat-data";

/** Determine which channel is currently active based on connection priority. */
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

export async function getInboxContacts(limitMessages = 300): Promise<Contact[]> {
  const db = await getDb();
  const lCol = leadsCollection(db);
  const mCol = waMessagesCollection(db);

  const activeChannel = await getActiveChannel();

  // Build the message filter: only fetch messages from the active connection.
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
  const seenMessageIds = new Set<string>();
  for (const m of messages) {
    if (seenMessageIds.has(m.waMessageId)) continue;
    seenMessageIds.add(m.waMessageId);

    const key = String(m.from).replace(/\D/g, "");
    if (!key) continue;
    if (!msgByPhone[key]) msgByPhone[key] = [];

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

  return leads
    .filter((lead) => {
      // When a specific channel is active, only show leads that have at least
      // one message from that channel — prevents ghost contacts from the other
      // connection appearing in the list.
      if (activeChannel === "all") return true;
      const key = lead.phone.replace(/\D/g, "");
      return Boolean(msgByPhone[key]?.length);
    })
    .map((lead) => {
      const key = lead.phone.replace(/\D/g, "");
      const msgs = (msgByPhone[key] ?? []).reverse();
      return {
        id: lead._id!.toHexString(),
        name: lead.name,
        phone: lead.phone,
        source: lead.source,
        status: lead.status,
        conversationStatus: lead.conversationStatus,
        needsHuman: lead.needsHuman ?? false,
        pendingHumanReply:
          Boolean(lead.needsHuman) ||
          lead.conversationStatus === "escalated" ||
          lead.conversationStatus === "awaiting_team_reply",
        assignedTo: lead.assignedTo,
        online: false,
        unread: msgs.some((m) => m.direction === "in") ? 1 : 0,
        messages: msgs,
        notes: [],
      } as Contact;
    });
}
