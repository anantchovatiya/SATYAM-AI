import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import {
  settingsCollection,
  getOrCreateSettings,
  type AutomationSettings,
} from "@/lib/models/settings";

// GET /api/settings
export async function GET() {
  try {
    const db = await getDb();
    const settings = await getOrCreateSettings(db);
    return NextResponse.json(settings);
  } catch (err) {
    console.error("[GET /api/settings]", err);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

// PUT /api/settings  — full replace (upsert)
export async function PUT(req: NextRequest) {
  try {
    const body: Partial<AutomationSettings> = await req.json();
    const db = await getDb();
    const col = settingsCollection(db);

    const update: Partial<AutomationSettings> = {
      autoReply: Boolean(body.autoReply),
      followUpDelayDays: Number(body.followUpDelayDays) || 1,
      humanHandoverKeywords: Array.isArray(body.humanHandoverKeywords)
        ? body.humanHandoverKeywords.map(String)
        : [],
      languageMirrorMode: Boolean(body.languageMirrorMode),
      businessCardAutoSend: Boolean(body.businessCardAutoSend),
      restrictToKnowledgeBase: Boolean(body.restrictToKnowledgeBase),
      autoShareCatalogue: Boolean(body.autoShareCatalogue),
      companyInformation: String(body.companyInformation ?? ""),
      productCatalogueInformation: String(body.productCatalogueInformation ?? ""),
      catalogueLink: String(body.catalogueLink ?? ""),
      greetingTemplate: String(body.greetingTemplate ?? ""),
      followUpTemplate: String(body.followUpTemplate ?? ""),
      aiTone: (["friendly", "professional", "premium"].includes(body.aiTone as string)
        ? body.aiTone
        : "friendly") as AutomationSettings["aiTone"],
      updatedAt: new Date(),
    };

    await col.updateOne(
      { workspaceId: "default" },
      { $set: update, $setOnInsert: { workspaceId: "default" } },
      { upsert: true }
    );

    return NextResponse.json({ success: true, updatedAt: update.updatedAt });
  } catch (err) {
    console.error("[PUT /api/settings]", err);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
