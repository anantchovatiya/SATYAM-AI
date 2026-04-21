import { NextRequest, NextResponse } from "next/server";
import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { leadsCollection } from "@/lib/models/lead";
import { settingsCollection, getOrCreateSettings } from "@/lib/models/settings";
import { waMessagesCollection } from "@/lib/models/webhook-log";
import { getQrSnapshot, startQrConnection, stopQrConnection } from "@/lib/whatsapp-qr-connector";
import { getBusinessCardCount } from "@/lib/business-card";
import { requireApiUser } from "@/lib/auth/session";

const GRAPH_API_VERSION = "v19.0";
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiUser(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;
    const userIdHex = userId.toHexString();

    const db = await getDb();
    const settings = await getOrCreateSettings(db, userId);
    const [stats, businessCardsCollected] = await Promise.all([
      getSyncStats(db, userId),
      getBusinessCardCount(userIdHex),
    ]);
    const qr = getQrSnapshot(userIdHex);

    const hasStoredConnection = Boolean(
      settings.whatsapp?.token && settings.whatsapp.phoneNumberId
    );
    const hasEnvConnection = Boolean(
      process.env.WHATSAPP_TOKEN &&
        process.env.WHATSAPP_PHONE_NUMBER_ID &&
        !settings.whatsappEnvDisabled
    );
    const qrConnected = qr.state === "connected";
    const connected = hasStoredConnection || hasEnvConnection || qrConnected;
    const source = hasStoredConnection
      ? "dashboard"
      : hasEnvConnection
      ? "env"
      : qrConnected
      ? "qr"
      : "none";

    return NextResponse.json({
      connected,
      source,
      phoneNumberId:
        settings.whatsapp?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? null,
      displayPhoneNumber: settings.whatsapp?.displayPhoneNumber ?? null,
      verifiedName: settings.whatsapp?.verifiedName ?? null,
      lastSyncAt: settings.whatsapp?.lastSyncAt ?? null,
      envDisabled: settings.whatsappEnvDisabled ?? false,
      hasEnvCredentials: Boolean(
        process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
      ),
      stats: { ...stats, businessCardsCollected },
      qr,
    });
  } catch (err) {
    console.error("[GET /api/whatsapp/connect]", err);
    return NextResponse.json({ error: "Failed to load WhatsApp connection status" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiUser(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;
    const userIdHex = userId.toHexString();

    const body = (await req.json()) as {
      action?: string;
      token?: string;
      phoneNumberId?: string;
      verifyToken?: string;
    };

    if (body.action === "sync") {
      const db = await getDb();
      const settings = await getOrCreateSettings(db, userId);
      const hasConnection =
        Boolean(settings.whatsapp?.token && settings.whatsapp.phoneNumberId) ||
        Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

      if (!hasConnection) {
        return NextResponse.json(
          { error: "Connect WhatsApp first, then sync data." },
          { status: 400 }
        );
      }

      const sync = await syncWhatsAppData(db, userId);
      return NextResponse.json({ ok: true, connected: true, sync });
    }

    if (body.action === "qr_start") {
      const qr = await startQrConnection(userIdHex);
      return NextResponse.json({ ok: true, qr });
    }

    if (body.action === "qr_restart") {
      const qr = await startQrConnection(userIdHex, true);
      return NextResponse.json({ ok: true, qr });
    }

    if (body.action === "qr_status") {
      return NextResponse.json({ ok: true, qr: getQrSnapshot(userIdHex) });
    }

    if (body.action === "qr_disconnect") {
      await stopQrConnection(userIdHex);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "cloud_disconnect") {
      const db = await getDb();
      await settingsCollection(db).updateOne(
        { userId },
        {
          $unset: { whatsapp: "" },
          $set: { whatsappEnvDisabled: true, updatedAt: new Date() },
        },
        { upsert: true }
      );
      return NextResponse.json({ ok: true });
    }

    if (body.action === "cloud_reconnect_env") {
      const db = await getDb();
      await settingsCollection(db).updateOne(
        { userId },
        { $set: { whatsappEnvDisabled: false, updatedAt: new Date() } },
        { upsert: true }
      );
      return NextResponse.json({ ok: true });
    }

    const token = String(body.token ?? "").trim();
    const phoneNumberId = String(body.phoneNumberId ?? "").trim();
    const verifyToken = String(body.verifyToken ?? "satyam_ai_verify").trim();

    if (!token || !phoneNumberId) {
      return NextResponse.json(
        { error: "token and phoneNumberId are required" },
        { status: 400 }
      );
    }

    const profileRes = await fetch(
      `${GRAPH_BASE_URL}/${encodeURIComponent(
        phoneNumberId
      )}?fields=id,display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const profileJson = (await profileRes.json()) as {
      error?: { message?: string };
      id?: string;
      display_phone_number?: string;
      verified_name?: string;
    };

    if (!profileRes.ok || profileJson.error) {
      return NextResponse.json(
        {
          error:
            profileJson.error?.message ??
            `Failed to validate WhatsApp credentials (HTTP ${profileRes.status})`,
        },
        { status: 400 }
      );
    }

    const db = await getDb();
    const col = settingsCollection(db);
    const now = new Date();

    await col.updateOne(
      { userId },
      {
        $set: {
          userId,
          updatedAt: now,
          whatsapp: {
            token,
            verifyToken,
            phoneNumberId,
            displayPhoneNumber: profileJson.display_phone_number,
            verifiedName: profileJson.verified_name,
            connectedAt: now,
          },
        },
      },
      { upsert: true }
    );

    return NextResponse.json({
      ok: true,
      connected: true,
      displayPhoneNumber: profileJson.display_phone_number ?? null,
      verifiedName: profileJson.verified_name ?? null,
    });
  } catch (err) {
    console.error("[POST /api/whatsapp/connect]", err);
    return NextResponse.json({ error: "Failed to connect WhatsApp" }, { status: 500 });
  }
}

async function syncWhatsAppData(db: Awaited<ReturnType<typeof getDb>>, userId: ObjectId) {
  const leadsCol = leadsCollection(db);
  const messagesCol = waMessagesCollection(db);

  const contacts = await messagesCol
    .aggregate<{
      from: string;
      senderName?: string;
      lastText: string;
      lastTimestamp: Date;
    }>([
      { $match: { userId } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: "$from",
          senderName: { $first: "$senderName" },
          lastText: { $first: "$text" },
          lastTimestamp: { $first: "$timestamp" },
        },
      },
      {
        $project: {
          _id: 0,
          from: "$_id",
          senderName: 1,
          lastText: 1,
          lastTimestamp: 1,
        },
      },
    ])
    .toArray();

  let imported = 0;
  let updated = 0;
  const now = new Date();

  for (const contact of contacts) {
    const normalizedPhone = normalizePhone(contact.from);
    const lead = await leadsCol.findOne({ userId, phone: normalizedPhone });

    if (!lead) {
      const importScore = contact.lastText?.trim() ? 35 : 10;
      await leadsCol.insertOne({
        userId,
        name: contact.senderName ?? normalizedPhone,
        phone: normalizedPhone,
        source: "WhatsApp",
        status: "New",
        lastMessage: contact.lastText,
        interestScore: importScore || 10,
        assignedTo: "Unassigned",
        lastFollowup: "Just now",
        createdAt: now,
        updatedAt: now,
      });
      imported += 1;
      continue;
    }

    await leadsCol.updateOne(
      { _id: lead._id },
      {
        $set: {
          name: lead.name || contact.senderName || lead.name,
          source: lead.source || "WhatsApp",
          lastMessage: contact.lastText || lead.lastMessage,
          updatedAt: now,
        },
      }
    );
    updated += 1;
  }

  await settingsCollection(db).updateOne(
    { userId },
    { $set: { "whatsapp.lastSyncAt": now, updatedAt: now } }
  );

  const stats = await getSyncStats(db, userId);
  return { imported, updated, ...stats, syncedAt: now };
}

async function getSyncStats(db: Awaited<ReturnType<typeof getDb>>, userId: ObjectId) {
  const messagesCol = waMessagesCollection(db);
  const leadsCol = leadsCollection(db);

  const [totalMessages, totalWhatsAppLeads, contacts, latestMessage] = await Promise.all([
    messagesCol.countDocuments({ userId }),
    leadsCol.countDocuments({ userId, source: "WhatsApp" }),
    messagesCol.distinct("from", { userId }),
    messagesCol.find({ userId }).sort({ timestamp: -1 }).limit(1).toArray(),
  ]);

  return {
    totalMessages,
    totalContacts: Math.max(contacts.length, totalWhatsAppLeads),
    totalWhatsAppLeads,
    latestMessageAt: latestMessage[0]?.timestamp ?? null,
  };
}

function normalizePhone(raw: string): string {
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return raw;
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}
