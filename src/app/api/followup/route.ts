/**
 * POST /api/followup
 *
 * Decides whether to send a follow-up and generates the message.
 * Returns shouldSend: false when daysSinceLastMessage < followUpDelayDays.
 *
 * Uses GPT-4o-mini when OPENAI_API_KEY is set,
 * otherwise renders the follow-up template directly.
 *
 * Body:
 * {
 *   leadId?:               string;
 *   leadName:              string;
 *   daysSinceLastMessage:  number;
 *   lastMessage:           string;
 *   lastOutboundMessage?:  string; // optional — last text we sent; improves AI context
 *   settings?: {
 *     followUpDelayDays?:  number;   // default 2
 *     followUpTemplate?:   string;
 *     aiTone?:             string;
 *   };
 * }
 *
 * GET /api/followup?leadId=xxx
 * Convenience method — returns the same result by loading the lead from MongoDB.
 */

import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { generateFollowUp } from "@/lib/ai";
import { getDb } from "@/lib/mongodb";
import { leadsCollection } from "@/lib/models/lead";
import { getOrCreateSettings } from "@/lib/models/settings";
import { requireApiUser } from "@/lib/auth/session";

// ── POST ───────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const leadName: string = body.leadName ?? "there";
    const daysSince: number = Number(body.daysSinceLastMessage) || 0;
    const lastMessage: string = body.lastMessage ?? "";
    const lastOutboundMessage: string =
      typeof body.lastOutboundMessage === "string" ? body.lastOutboundMessage : "";
    const settings = body.settings ?? {};

    const result = await generateFollowUp({
      leadId:               body.leadId,
      leadName,
      daysSinceLastMessage: daysSince,
      lastMessage,
      lastOutboundMessage,
      followUpDelayDays:    Number(settings.followUpDelayDays) || 2,
      followUpTemplate:     settings.followUpTemplate,
      aiTone:               settings.aiTone ?? "friendly",
    });

    return NextResponse.json({
      ok: true,
      data: {
        shouldSend: result.shouldSend,
        followUp:   result.followUp,
        reason:     result.reason,
      },
      meta: {
        engine:      result.engine,
        leadName,
        daysSince,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[POST /api/followup]", err);
    return NextResponse.json(
      { error: "Follow-up generation failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// ── GET ─────────────────────────────────────────────────────────────────────────
// GET /api/followup?leadId=<mongo_id>
// Loads lead + workspace settings from MongoDB, then generates the follow-up.
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req);
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const leadId = new URL(req.url).searchParams.get("leadId");

  if (!leadId) {
    return NextResponse.json(
      { error: "leadId query param is required" },
      { status: 400 }
    );
  }

  try {
    const db = await getDb();
    const col = leadsCollection(db);

    let lead;
    try {
      lead = await col.findOne({ _id: new ObjectId(leadId), userId });
    } catch {
      return NextResponse.json({ error: "Invalid leadId format" }, { status: 400 });
    }

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const settings = await getOrCreateSettings(db, userId);

    // Calculate days since last followup — crude but serviceable for demo
    const daysSince = parseDaysAgo(lead.lastFollowup);

    const result = await generateFollowUp({
      leadId,
      leadName:             lead.name,
      daysSinceLastMessage: daysSince,
      lastMessage:          lead.lastMessage,
      followUpDelayDays:    settings.followUpDelayDays,
      followUpTemplate:     settings.followUpTemplate,
      aiTone:               settings.aiTone,
    });

    return NextResponse.json({
      ok: true,
      data: {
        shouldSend: result.shouldSend,
        followUp:   result.followUp,
        reason:     result.reason,
      },
      meta: {
        engine:      result.engine,
        leadId,
        leadName:    lead.name,
        daysSince,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[GET /api/followup]", err);
    return NextResponse.json(
      { error: "Follow-up check failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// ── Helper ─────────────────────────────────────────────────────────────────────
function parseDaysAgo(str: string): number {
  if (!str) return 0;
  const lower = str.toLowerCase();
  if (lower.includes("just now") || lower.includes("min") || lower.includes("h ago")) return 0;
  const dayMatch = lower.match(/(\d+)\s*d/);
  if (dayMatch) return parseInt(dayMatch[1], 10);
  const weekMatch = lower.match(/(\d+)\s*w/);
  if (weekMatch) return parseInt(weekMatch[1], 10) * 7;
  if (lower === "yesterday") return 1;
  return 0;
}
