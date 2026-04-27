import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import {
  settingsCollection,
  getOrCreateSettings,
  type AutomationSettings,
} from "@/lib/models/settings";
import { normalizeAutoReplyExcludedPhones } from "@/lib/auto-reply-exclusions";
import { requireApiUser } from "@/lib/auth/session";

function clampInt(v: unknown, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

// GET /api/settings
export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiUser(req);
    if (auth instanceof Response) return auth;
    const db = await getDb();
    const settings = await getOrCreateSettings(db, auth.userId);
    return NextResponse.json(settings);
  } catch (err) {
    console.error("[GET /api/settings]", err);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

// PUT /api/settings  — full replace (upsert)
export async function PUT(req: NextRequest) {
  try {
    const auth = await requireApiUser(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const body: Partial<AutomationSettings> = await req.json();
    const db = await getDb();
    const col = settingsCollection(db);

    // Do not put userId in $set together with $setOnInsert:{ userId } — MongoDB rejects duplicate paths.
    const update: Partial<AutomationSettings> = {
      autoReply: Boolean(body.autoReply),
      autoReplyPauseAfterManualMinutes: clampInt(body.autoReplyPauseAfterManualMinutes, 0, 24 * 60),
      followUpDelayDays: Number(body.followUpDelayDays) || 1,
      followUpMinInterestScore: clampInt(body.followUpMinInterestScore, 0, 100),
      humanHandoverKeywords: Array.isArray(body.humanHandoverKeywords)
        ? body.humanHandoverKeywords.map(String)
        : [],
      autoReplyExcludedPhones: normalizeAutoReplyExcludedPhones(body.autoReplyExcludedPhones),
      languageMirrorMode: Boolean(body.languageMirrorMode),
      businessCardAutoSend: Boolean(body.businessCardAutoSend),
      restrictToKnowledgeBase: Boolean(body.restrictToKnowledgeBase),
      autoShareCatalogue: Boolean(body.autoShareCatalogue),
      companyInformation: String(body.companyInformation ?? ""),
      productCatalogueInformation: String(body.productCatalogueInformation ?? ""),
      catalogueLink: String(body.catalogueLink ?? ""),
      greetingTemplate: String(body.greetingTemplate ?? ""),
      followUpTemplate: String(body.followUpTemplate ?? ""),
      aiTone: (["sales", "friendly", "professional", "premium"].includes(body.aiTone as string)
        ? body.aiTone
        : "sales") as AutomationSettings["aiTone"],
      updatedAt: new Date(),
    };

    await col.updateOne(
      { userId },
      { $set: update, $setOnInsert: { userId } },
      { upsert: true }
    );

    return NextResponse.json({ success: true, updatedAt: update.updatedAt });
  } catch (err) {
    console.error("[PUT /api/settings]", err);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
