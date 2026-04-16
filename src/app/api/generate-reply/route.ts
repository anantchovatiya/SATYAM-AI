/**
 * POST /api/generate-reply
 *
 * Generates a CRM reply in the same language as the customer message,
 * using the workspace AI tone from Automation Settings.
 *
 * Uses GPT-4o-mini when OPENAI_API_KEY is set,
 * otherwise falls back to the built-in template engine.
 *
 * Body:
 * {
 *   customerMessage: string;
 *   leadName?:       string;
 *   context?:        { text: string; direction: "in" | "out" }[];  // recent messages for context
 *   settings?: {
 *     aiTone?:             "friendly" | "professional" | "premium";
 *     handoverKeywords?:   string[];
 *     companyInformation?: string;
 *     productCatalogueInformation?: string;
 *     catalogueLink?: string;
 *     restrictToKnowledgeBase?: boolean;
 *     autoShareCatalogue?: boolean;
 *   };
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { generateReply } from "@/lib/ai";
import { getEffectiveKnowledge } from "@/lib/knowledge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const customerMessage: string = body.customerMessage ?? "";
    if (!customerMessage.trim()) {
      return NextResponse.json(
        { error: "customerMessage is required" },
        { status: 400 }
      );
    }

    const leadName: string       = body.leadName ?? "there";
    const context                = Array.isArray(body.context) ? body.context : [];
    const settings               = body.settings ?? {};
    const aiTone: string         = settings.aiTone ?? "friendly";
    const handoverKeywords: string[] = Array.isArray(settings.handoverKeywords)
      ? settings.handoverKeywords
      : ["price", "discount", "urgent", "complaint"];

    const kb = getEffectiveKnowledge({
      companyInformation: String(settings.companyInformation ?? ""),
      productCatalogueInformation: String(settings.productCatalogueInformation ?? ""),
      catalogueLink: String(settings.catalogueLink ?? ""),
      restrictToKnowledgeBase: Boolean(settings.restrictToKnowledgeBase),
    });
    const result = await generateReply(customerMessage, {
      aiTone,
      leadName,
      context,
      handoverKeywords,
      companyInformation: kb.companyInformation,
      productCatalogueInformation: kb.productCatalogueInformation,
      catalogueLink: kb.catalogueLink,
      restrictToKnowledgeBase: kb.restrictToKnowledgeBase,
      autoShareCatalogue: settings.autoShareCatalogue !== false,
    });

    return NextResponse.json({
      ok: true,
      data: {
        reply:      result.reply,
        language:   result.language,
        needsHuman: result.needsHuman,
      },
      meta: {
        engine:      result.engine,
        tone:        aiTone,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[POST /api/generate-reply]", err);
    return NextResponse.json(
      { error: "Reply generation failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
