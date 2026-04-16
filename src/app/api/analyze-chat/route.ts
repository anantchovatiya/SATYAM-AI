/**
 * POST /api/analyze-chat
 *
 * Analyses a conversation thread and returns:
 *   language, sentiment, leadScore, stage, needsHuman
 *
 * Uses GPT-4o-mini when OPENAI_API_KEY is set,
 * otherwise falls back to the built-in heuristic engine.
 *
 * Body:
 * {
 *   messages: { text: string; direction: "in" | "out"; timestamp?: string }[];
 *   handoverKeywords?: string[];   // defaults to ["price","discount","urgent","complaint"]
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { analyzeChat, type IncomingMessage } from "@/lib/ai";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const messages: IncomingMessage[] = Array.isArray(body.messages)
      ? body.messages
      : [];

    if (messages.length === 0) {
      return NextResponse.json(
        { error: "messages array is required and must not be empty" },
        { status: 400 }
      );
    }

    const handoverKeywords: string[] = Array.isArray(body.handoverKeywords)
      ? body.handoverKeywords
      : ["price", "discount", "urgent", "complaint"];

    const result = await analyzeChat(messages, handoverKeywords);

    return NextResponse.json({
      ok: true,
      data: {
        language:   result.language,
        sentiment:  result.sentiment,
        leadScore:  result.leadScore,
        stage:      result.stage,
        needsHuman: result.needsHuman,
        confidence: result.confidence,
      },
      meta: {
        engine:       result.engine,
        messageCount: messages.length,
        inboundCount: messages.filter((m) => m.direction === "in").length,
        analyzedAt:   new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[POST /api/analyze-chat]", err);
    return NextResponse.json(
      { error: "Analysis failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
