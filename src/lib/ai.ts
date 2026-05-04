/**
 * Shared AI layer.
 *
 * Provider priority:
 * 1) Gemini (GEMINI_API_KEY)
 * 2) OpenAI (OPENAI_API_KEY)
 * 3) Deterministic heuristic fallback
 *
 * Interest (`leadScore`): primarily from the last `INTEREST_SCORE_MESSAGE_WINDOW` messages
 * (inbound + outbound), via `resolveGeminiLeadScoreLast5` / `geminiInterestScoreFromMessages` —
 * not from a single last message. A wider-thread commerce floor corrects the score when
 * the model only sees a short “ok / yes I see” tail but quantity/order context is one screen up.
 * Full `analyzeChat` still uses a dual-window prompt for language / sentiment / stage.
 */
import OpenAI from "openai";
import { shouldSkipAutoReplyForInboundText } from "@/lib/auto-reply-skip-media";

// ── Types (re-exported for use in route handlers) ─────────────────────────────

export interface IncomingMessage {
  text: string;
  direction: "in" | "out";
  timestamp?: string;
}

export type Sentiment = "positive" | "neutral" | "negative";
export type LeadStage =
  | "awareness"
  | "interest"
  | "consideration"
  | "intent"
  | "purchase"
  | "closed_won"
  | "closed_lost";

export interface AnalyzeResult {
  language: string;
  sentiment: Sentiment;
  leadScore: number;        // 0–100
  stage: LeadStage;
  needsHuman: boolean;
  confidence: number;       // 0–1
  engine: "openai" | "gemini" | "heuristic";
}

export interface ReplyResult {
  reply: string;
  language: string;
  needsHuman: boolean;
  engine: "openai" | "gemini" | "heuristic";
  sharedCatalogue: boolean;
  /** When true, WhatsApp layer must not send text or catalogue for this turn (human-only follow-up or silent ack). */
  skipOutbound?: boolean;
  /** After a normal outbound message, mark the lead for human handoff (e.g. phone callback promised). */
  escalateAfterOutbound?: boolean;
}

export interface FollowUpResult {
  shouldSend: boolean;
  followUp: string;
  reason: string;
  engine: "openai" | "gemini" | "heuristic";
}

// ── OpenAI client (lazy) ──────────────────────────────────────────────────────

function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === "sk-...") return null;
  return new OpenAI({ apiKey: key });
}

function getGeminiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key ? key : null;
}

function getGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
}

const GEMINI_QUOTA_COOLDOWN_MS = 5 * 60 * 1000;
let geminiBlockedUntil = 0;

function clampLeadScore0to100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function clampAnalyzeConfidence(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.72;
  return Math.max(0.2, Math.min(1, n));
}

/** Model-only interest: use JSON leadScore when valid, else neutral placeholder (no keyword rules). */
function leadScoreFromModelOrDefault(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 35;
  return clampLeadScore0to100(n);
}

async function callGemini(args: {
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<string | null> {
  const key = getGeminiKey();
  if (!key) return null;
  if (Date.now() < geminiBlockedUntil) return null;

  const models = Array.from(
    new Set([
      getGeminiModel(),
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-1.5-flash",
    ])
  );
  const errors: string[] = [];

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: args.system }] },
            contents: [
              {
                role: "user",
                parts: [{ text: args.prompt }],
              },
            ],
            generationConfig: {
              temperature: args.temperature ?? 0.4,
              maxOutputTokens: args.maxOutputTokens ?? 400,
            },
          }),
        }
      );

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        errors.push(`${model}: HTTP ${res.status}${errText ? ` - ${errText.slice(0, 180)}` : ""}`);
        if (res.status === 429) {
          geminiBlockedUntil = Date.now() + GEMINI_QUOTA_COOLDOWN_MS;
        }
        continue;
      }
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
      if (text) return text;
      errors.push(`${model}: empty response`);
    } catch {
      errors.push(`${model}: request failed`);
    }
  }

  if (errors.length) {
    console.warn("[AI] Gemini unavailable, falling back:", errors.join(" | "));
  }

  return null;
}

function parseJsonFromText(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    if (fenced) {
      try {
        return JSON.parse(fenced) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return {};
  }
}

// ── Tone system prompts ───────────────────────────────────────────────────────

const TONE_SYSTEM: Record<string, string> = {
  sales:
    "You are an enthusiastic on-the-ground sales rep on WhatsApp — consultative, helpful, never stiff. Sound like a real person closing the next step (size, delivery, sample, price band). Use light emojis occasionally (😊👍). Keep lines short; build rapport; one clear ask at the end.",
  friendly:
    "You are a warm, helpful sales assistant. Use casual language and occasional emojis (😊👍). Keep sentences short and natural.",
  professional:
    "You are a professional B2B sales representative. Use formal language, structured responses, and always end with a clear call to action.",
  premium:
    "You are a concise, authoritative advisor for a premium product. Responses should be brief, confident, and value-focused — no filler.",
};

function buildDefaultLanguageInstruction(languageMirrorMode: boolean): string {
  if (languageMirrorMode) {
    return `LANGUAGE: Match the customer's language and script from their latest message (e.g. English → English, Devanagari Hindi → Hindi in Devanagari).`;
  }
  return `LANGUAGE (default): Write in Hinglish — Hindi phrasing typed in Roman/English letters (WhatsApp style), e.g. "Kaise hain aap Sir", "aapka kitna quantity chahiye", "main abhi details bhejta hoon". Do NOT use Devanagari script unless the customer wrote in Devanagari. Plain English-only messages can get a short mix of simple English + Hinglish. Never default to stiff formal English.`;
}

function buildAddressingInstruction(): string {
  return `ADDRESSING: Prefer "Sir" (or "Ma'am" only if the name or context clearly suggests). Do NOT use the lead's personal name in the message — it is for your context only. Never open with "Hi [Name]" or repeat their name; "Sir" is enough.`;
}

/** B2B sales rules: do not over-promise delivery or waive KYC / payment terms. */
function buildCommerceGuardrails(): string {
  return `COMMERCE GUARDRAILS (non-negotiable — follow even if the customer pushes back):
- GST / tax ID: If the customer says they have no GST, cannot provide GST, or ask to skip it, do NOT say it is optional or "no problem". Politely explain that for proper billing and compliance a valid GSTIN OR a valid PAN (as per your company rule) is required — offer PAN if they have no GST, and keep tone helpful but firm. Never suggest doing business without any tax identity when they raised the issue.
- Payments: Standard terms are advance payment before dispatch. If they refuse advance, want only credit/udhaar, COD-only, or "pay after delivery" without your approval — do NOT agree or say "that's ok / theek hai / no issue". Politely clarify you do not operate on open credit; advance (or your standard policy) is required to process the order. Stay respectful.
- Delivery timing: Do NOT promise "sending today", "reaching today", "dispatch today", or specific dates/hours unless the knowledge base or an earlier confirmed fact in this chat explicitly states it. Prefer wording like you will confirm dispatch / timeline or arrange dispatch after payment and document details — avoid invented urgency.`;
}

/**
 * Shown in interest-only mini prompts. Score reflects the last
 * `INTEREST_SCORE_MESSAGE_WINDOW` messages only (both LEAD and AGENT) — not one message, not
 * the whole chat history. Agent lines still count: quantities, SKUs, prices, shipping, confirmations.
 */
const LEAD_SCORE_RUBRIC = `leadScore (integer 0-100): buying strength from ONLY these messages (LEAD + AGENT, in order). Do not infer from older history outside this window.
Bands: 0-15 greetings or chit-chat only; 16-40 light product mentions without commitment; 41-60 product interest, specs, catalogue, "send details"; 61-78 pricing, MOQ, delivery, negotiation, piece/qty talk; 79-100 firm purchase intent or order step (confirm order, committed qty, invoice/payment, agent confirms their order). If the agent confirms an order or the lead commits qty/SKU, use at least 85 unless the lead clearly cancelled.
If the last LEAD line is a short ack ("yes I see", "ok", "got it", "sounds good") but the same window still contains the AGENT recapping a concrete quantity, SKU, or "we can get that order ready" for them, treat the thread as high intent: use at least 72–90 (acknowledging an order discussion is not a 30–50 score).
IMPORTANT: If the last messages are mostly from AGENT but they say the order is packed, shipping, dispatched, confirmed, payment received, out for delivery, or "getting your order ready" / similar fulfillment — that means an active sale; use leadScore 88–98 (not 30–45). If AGENT says they are getting that order ready / "we can definitely get that order" (even before ship), that is also strong: use 82–95.
Low scores are wrong when the business is clearly discussing or fulfilling a concrete order in this window.
confidence (0-1): how sure you are; use roughly 0.85-1 when evidence is explicit (numbers, "confirm", "order", prices), and 0.45-0.7 when the window is vague.`;

/** Last N turns used for Gemini interest-only scoring and for the RECENT_WINDOW in analyzeChat. */
export const INTEREST_SCORE_MESSAGE_WINDOW = 10;

export function getLastMessagesForInterestScore(messages: IncomingMessage[]): IncomingMessage[] {
  if (messages.length <= INTEREST_SCORE_MESSAGE_WINDOW) return messages;
  return messages.slice(-INTEREST_SCORE_MESSAGE_WINDOW);
}

function formatChatLines(messages: IncomingMessage[]): string {
  return messages
    .map((m) => `[${m.direction === "in" ? "LEAD" : "AGENT"}] ${m.text}`)
    .join("\n");
}

/** Agent said order is in fulfillment → floor score so UI is not stuck at neutral when Gemini under-reads AGENT-only tails. */
const AGENT_FULFILLMENT_SHIPPED_RE =
  /\b(getting\s+your\s+order\s+packed|order\s+packed|packed\s+up|packed\s+up\s+and\s+ready|ready\s+to\s+go|on\s+the\s+way|out\s+for\s+delivery|dispatched|shipp(ed|ing)|your\s+order\s+(has\s+been\s+)?(shipped|dispatched|confirmed)|order\s+is\s+confirmed|payment\s+received|invoice\s+paid|tracking\s+(id|number|link))\b/i;

/**
 * Agent commits to a concrete order (qty/product) or “we can get that order ready” before dispatch — not yet shipped, but high intent.
 */
const AGENT_ORDER_COMMITMENT_RE =
  /\b(we\s+can\s+(?:definitely\s+)?get\s+that\s+order|get(?:ting)?\s+that\s+order\s+ready|get\s+that\s+order\s+ready|get\s+that\s+order|definitely\s+get\s+that|that('?s| is)\s+\d{1,5}\s*pieces?|get\s+that\s+order\s+ready\s+for|order\s+ready\s+for\s+you|confirm(?:ed|ing)\s+that|your\s+order\s+of\s+\d{1,5})\b/i;

const WIDE_COMMERCE_LOOKBACK = 25;
const THREAD_QTY_ORDER_RE = /\b\d{2,5}\s*(?:pieces?|pcs?|nos?|units?)\b/i;

/**
 * Wider than the last-N window: if quantity/order language appears in recent thread but the model only
 * scored a short “yes / ok / I see” tail, don’t show a low score (common CRM bug).
 */
export function applyCommerceContextFloor(allMessages: IncomingMessage[], score: number): number {
  const base = clampLeadScore0to100(score);
  const recent =
    allMessages.length > WIDE_COMMERCE_LOOKBACK
      ? allMessages.slice(-WIDE_COMMERCE_LOOKBACK)
      : allMessages;
  const blob = formatChatLines(recent).toLowerCase();
  if (THREAD_QTY_ORDER_RE.test(blob)) {
    return Math.max(base, 82);
  }
  if (
    /\b(order|quote|moq|proforma|invoice|payment|dispatch|catalogue|send\s+details|brass|spray|sku)\b/.test(
      blob
    ) &&
    (/\b\d{1,5}\b/.test(blob) || AGENT_ORDER_COMMITMENT_RE.test(blob) || /pieces?|pcs?|length|cm|mm/.test(blob))
  ) {
    return Math.max(base, 70);
  }
  return base;
}

/**
 * Raise `score` when recent AGENT text clearly indicates an active sale: shipped/dispatch, or order commitment / qty recap.
 */
export function applyAgentFulfillmentFloor(window: IncomingMessage[], score: number): number {
  const base = clampLeadScore0to100(score);
  for (const m of window) {
    if (m.direction !== "out") continue;
    const t = m.text ?? "";
    if (AGENT_FULFILLMENT_SHIPPED_RE.test(t)) return Math.max(base, 88);
  }
  for (const m of window) {
    if (m.direction !== "out") continue;
    if (AGENT_ORDER_COMMITMENT_RE.test(m.text ?? "")) return Math.max(base, 84);
  }
  return base;
}

/** Dual-section transcript: model must base `leadScore` only on RECENT_WINDOW when present. */
function buildDualWindowAnalyzePrompt(messages: IncomingMessage[]): string {
  const last5 = getLastMessagesForInterestScore(messages);
  if (messages.length <= INTEREST_SCORE_MESSAGE_WINDOW) {
    return `Thread (${messages.length} message(s); use for all fields including leadScore):\n${formatChatLines(messages)}`;
  }
  return (
    `===RECENT_WINDOW (last ${INTEREST_SCORE_MESSAGE_WINDOW} messages; leadScore MUST be inferred ONLY from this block)===\n` +
    `${formatChatLines(last5)}\n\n` +
    `===FULL_THREAD (${messages.length} messages; use for language, sentiment, stage, needsHuman, confidence)===\n` +
    `${formatChatLines(messages)}`
  );
}

/**
 * Gemini-only: `leadScore` + `confidence` from the given slice (typically last `INTEREST_SCORE_MESSAGE_WINDOW` messages).
 * Returns null if GEMINI_API_KEY is missing or the API fails.
 */
export async function geminiInterestScoreFromMessages(
  recent: IncomingMessage[]
): Promise<{ leadScore: number; confidence: number } | null> {
  if (!getGeminiKey() || recent.length === 0) return null;
  const text = await callGemini({
    system: `You score B2B buying interest from WhatsApp-style lines. Return ONLY valid JSON with keys:
leadScore (integer 0-100), confidence (number 0-1).
${LEAD_SCORE_RUBRIC}`,
    prompt: `Chronological messages (${recent.length}):\n${formatChatLines(recent)}`,
    temperature: 0.2,
    maxOutputTokens: 220,
  });
  if (!text) return null;
  const raw = parseJsonFromText(text);
  const leadScore = applyAgentFulfillmentFloor(recent, leadScoreFromModelOrDefault(raw.leadScore));
  const confidence = clampAnalyzeConfidence(raw.confidence);
  return { leadScore, confidence };
}

/** Clamped 0–100; 35 when Gemini is unavailable or fails. Applies thread commerce floor on full `messages`. */
export async function resolveGeminiLeadScoreLast5(messages: IncomingMessage[]): Promise<number> {
  const slice = getLastMessagesForInterestScore(messages);
  const w = slice.length ? slice : messages;
  const g = await geminiInterestScoreFromMessages(w.length ? w : messages);
  if (!g) {
    const s0 = applyAgentFulfillmentFloor(w, 35);
    return applyCommerceContextFloor(messages, s0);
  }
  const s1 = applyAgentFulfillmentFloor(w, g.leadScore);
  return applyCommerceContextFloor(messages, s1);
}

// ── 1. analyzeChat ────────────────────────────────────────────────────────────

export async function analyzeChat(
  messages: IncomingMessage[],
  handoverKeywords: string[] = ["price", "discount", "urgent", "complaint"]
): Promise<AnalyzeResult> {
  const geminiKey = getGeminiKey();
  const openai = getOpenAI();
  const inbound = messages.filter((m) => m.direction === "in");
  const fullText = inbound.map((m) => m.text).join(" ");

  if (geminiKey) {
    try {
      const text = await callGemini({
        system: `You are a CRM analytics engine.
Return ONLY valid JSON with keys:
language, sentiment, leadScore, stage, needsHuman, confidence.
sentiment must be one of: positive|neutral|negative.
stage must be one of: awareness|interest|consideration|intent|purchase|closed_won|closed_lost.
needsHuman should be true ONLY for abusive content, legal threats, refund/chargeback demands, or if any of [${handoverKeywords.join(", ")}] appears in the LEAD lines. Do NOT set needsHuman for normal product questions, requests for details/specs/quotes, or SKU choices.
When the user prompt contains ===RECENT_WINDOW===, you MUST base leadScore ONLY on that block (not on older lines in FULL_THREAD).

${LEAD_SCORE_RUBRIC}`,
        prompt: buildDualWindowAnalyzePrompt(messages),
        temperature: 0.2,
        maxOutputTokens: 300,
      });

      if (text) {
        const raw = parseJsonFromText(text);
        const leadScore = await resolveGeminiLeadScoreLast5(messages);
        return {
          language: String(raw.language ?? "English"),
          sentiment: (["positive", "neutral", "negative"].includes(String(raw.sentiment))
            ? raw.sentiment
            : "neutral") as Sentiment,
          leadScore,
          stage: ([
            "awareness",
            "interest",
            "consideration",
            "intent",
            "purchase",
            "closed_won",
            "closed_lost",
          ].includes(String(raw.stage))
            ? raw.stage
            : "interest") as LeadStage,
          needsHuman: Boolean(raw.needsHuman),
          confidence: clampAnalyzeConfidence(raw.confidence),
          engine: "gemini",
        };
      }
    } catch {
      // fall through
    }
  }

  if (openai) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `You are a CRM analytics engine. Analyse the provided lead conversation and return ONLY a JSON object with these exact keys:
- language (string): detected spoken language, e.g. "English", "Hindi", "Spanish"
- sentiment ("positive" | "neutral" | "negative")
- ${LEAD_SCORE_RUBRIC.replace(/\n/g, " ")}
- stage ("awareness" | "interest" | "consideration" | "intent" | "purchase" | "closed_won" | "closed_lost")
- needsHuman (boolean): true only if LEAD messages are abusive/threatening, demand refunds/chargebacks, or contain [${handoverKeywords.join(", ")}]. False for routine “send details / quote / specs” or SKU picks.
- confidence (float 0-1): overall certainty of this JSON (see leadScore rubric for calibration).
When the user message contains ===RECENT_WINDOW===, base leadScore ONLY on that section.`,
          },
          {
            role: "user",
            content: buildDualWindowAnalyzePrompt(messages),
          },
        ],
      });

      const raw = JSON.parse(completion.choices[0].message.content ?? "{}");
      const leadScore = await resolveGeminiLeadScoreLast5(messages);
      return {
        language:    raw.language   ?? "English",
        sentiment:   raw.sentiment  ?? "neutral",
        leadScore,
        stage:       raw.stage      ?? "interest",
        needsHuman:  Boolean(raw.needsHuman),
        confidence:  clampAnalyzeConfidence(raw.confidence),
        engine: "openai",
      };
    } catch {
      // fall through to heuristic
    }
  }

  const h = heuristicAnalyze(fullText, messages, handoverKeywords);
  const ls = await resolveGeminiLeadScoreLast5(messages);
  h.leadScore = ls;
  const lower = fullText.toLowerCase();
  if (lower.includes("cancel") || lower.includes("not interested")) h.stage = "closed_lost";
  else if (ls >= 80) h.stage = "intent";
  else if (ls >= 60) h.stage = "consideration";
  else if (ls >= 35) h.stage = "interest";
  else if (lower.includes("bought") || lower.includes("paid")) h.stage = "purchase";
  else h.stage = "awareness";
  return h;
}

// ── 2. generateReply ─────────────────────────────────────────────────────────

export async function generateReply(
  customerMessage: string,
  options: {
    aiTone?: string;
    leadName?: string;
    context?: IncomingMessage[];
    handoverKeywords?: string[];
    companyInformation?: string;
    productCatalogueInformation?: string;
    catalogueLink?: string;
    restrictToKnowledgeBase?: boolean;
    autoShareCatalogue?: boolean;
    /** false = Hinglish (Roman) default; true = match customer's language. */
    languageMirrorMode?: boolean;
  } = {}
): Promise<ReplyResult> {
  const {
    aiTone = "sales",
    leadName = "there",
    context = [],
    handoverKeywords = ["price", "discount", "urgent", "complaint"],
    companyInformation = "",
    productCatalogueInformation = "",
    catalogueLink = "",
    restrictToKnowledgeBase = false,
    autoShareCatalogue = true,
    languageMirrorMode = false,
  } = options;

  const inboundIntent = classifyInboundReplyIntent(customerMessage, context, languageMirrorMode);
  if (inboundIntent.kind === "silent_skip") {
    const lang = detectLanguageHeuristic(customerMessage);
    return {
      reply: "",
      language: lang,
      needsHuman: inboundIntent.escalateToHuman,
      engine: "heuristic",
      sharedCatalogue: false,
      skipOutbound: true,
      escalateAfterOutbound: inboundIntent.escalateToHuman,
    };
  }
  if (inboundIntent.kind === "team_call_script") {
    const lang = detectLanguageHeuristic(customerMessage);
    return {
      reply: ensureTerminalPunctuation(inboundIntent.replyText),
      language: lang,
      needsHuman: false,
      engine: "heuristic",
      sharedCatalogue: false,
      skipOutbound: false,
      escalateAfterOutbound: true,
    };
  }

  const lower = customerMessage.toLowerCase();
  const needsHuman = handoverKeywords.some((kw) => lower.includes(kw));
  const geminiKey = getGeminiKey();
  const openai = getOpenAI();
  const language = detectLanguageHeuristic(customerMessage);
  const fallbackReply = () =>
    heuristicReply(customerMessage, { aiTone, leadName, needsHuman, context, languageMirrorMode });
  const knowledgeBase = [companyInformation.trim(), productCatalogueInformation.trim()]
    .filter(Boolean)
    .join("\n\n");
  const shouldIncludeDetails = shouldIncludeCatalogueDetails({
    customerMessage,
    context,
    productCatalogueInformation,
  });
  const shouldAppendCatalogue = shouldShareCatalogue({
    customerMessage,
    context,
    catalogueLink,
    autoShareCatalogue,
  });
  const repeatCatalogueRequest =
    catalogueAlreadySentInContext(context) && customerExplicitlyRequestsCatalogue(customerMessage);
  if (restrictToKnowledgeBase && !knowledgeBase) {
    const limitedReply =
      "Thanks Sir! Product info abhi update ho rahi hai — thodi der mein main aapko details share kar dunga.";
    return {
      reply: finalizeReply({
        reply: limitedReply,
        catalogueLink,
        shouldAppendCatalogue,
      }),
      language,
      needsHuman: true,
      engine: "heuristic",
      sharedCatalogue: shouldAppendCatalogue,
    };
  }
  const isOngoing = context.length > 0;
  const baseSystem = `${TONE_SYSTEM[aiTone] ?? TONE_SYSTEM.sales}
You reply on behalf of Agribird Sales Person as a real team member — NOT a bot.
CRITICAL: NEVER reveal or hint that you are an AI, bot, or automated system. Never say things like "as an AI", "I'm a bot", "connect you with a human", "our team will assist", or "a specialist will follow up". Respond naturally as a knowledgeable sales person.
${buildDefaultLanguageInstruction(languageMirrorMode)}
${buildAddressingInstruction()}
${buildCommerceGuardrails()}
Keep response 2-4 concise sentences.
Do NOT return a partial or unfinished sentence.
Always end with proper sentence punctuation (. ! ?).
GREETING RULE: Do NOT start with their personal name. ${isOngoing ? "Ongoing thread — get straight to the point; optional light \"Sir\"." : "Brief hello is ok; prefer addressing as Sir, not by name."}
IMPORTANT: Never copy-paste raw catalogue lines or data codes. Always describe product details naturally in conversational sentences.
${restrictToKnowledgeBase ? "Use ONLY the provided business knowledge base as factual source. If the answer is not present, say you will look into it and get back to them shortly." : ""}
${shouldIncludeDetails ? "User is asking for product details. Describe the relevant product(s) naturally — include model name, size, key features, and carton/pack quantity if available. Do NOT list raw codes or paste catalogue lines." : ""}
${shouldAppendCatalogue ? "The AgriBird product catalogue PDF will be sent to the customer as a separate WhatsApp document right after this message. Do NOT mention any URL or link. Do NOT say 'here is a link' or 'check this link'. Simply acknowledge you are sending the catalogue now (e.g. 'I'm sending you our AgriBird catalogue now! 📄')." : ""}
${repeatCatalogueRequest ? "IMPORTANT: The catalogue PDF was already sent earlier in this WhatsApp chat — the customer can scroll up to open it again. They are asking to send it again (or for product photos / pictures). Politely confirm it is already in the chat above; the PDF usually includes product images and model range. Offer help on a specific model. Do NOT say it failed to deliver, did not come through, or was unclear. Do NOT promise to resend the file." : ""}
${needsHuman ? "The customer needs special attention. Acknowledge their concern warmly and let them know you will look into it and get back to them." : ""}`;
  const contextText = context
    .slice(-8)
    .map((m) => `${m.direction === "in" ? "LEAD" : "AGENT"}: ${m.text}`)
    .join("\n");
  const basePrompt = `Lead reference name (context only; do not address by name; use Sir): ${leadName}
Conversation context:
${contextText || "(none)"}

Customer message:
${customerMessage}

Return only reply text.
${knowledgeBase ? `\nBusiness knowledge base:\n${knowledgeBase}` : ""}`;

  if (geminiKey) {
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const text = await callGemini({
          system:
            attempt === 0
              ? baseSystem
              : `${baseSystem}
Your previous answer was incomplete. Rewrite from scratch with full, natural completion.`,
          prompt: basePrompt,
          temperature: attempt === 0 ? 0.35 : 0.2,
          maxOutputTokens: 400,
        });
        if (!text?.trim()) continue;
        const cleaned = normalizeReplyText(text);
        if (!isLikelyIncompleteReply(cleaned)) {
          return {
            // AI already used the full knowledge base — don't append raw detailsSnippet
            reply: finalizeReply({
              reply: cleaned,
              catalogueLink,
              shouldAppendCatalogue,
            }),
            language,
            needsHuman,
            engine: "gemini",
            sharedCatalogue: shouldAppendCatalogue,
          };
        }
        console.warn("[AI] Rejected incomplete Gemini reply:", cleaned);
      }
    } catch {
      // fall through
    }
  }

  if (openai) {
    try {
      const contextBlock = context.slice(-6).map((m) =>
        m.direction === "in"
          ? { role: "user" as const, content: m.text }
          : { role: "assistant" as const, content: m.text }
      );

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: attempt === 0 ? 0.35 : 0.2,
          max_tokens: 300,
          messages: [
            {
              role: "system",
              content: `${TONE_SYSTEM[aiTone] ?? TONE_SYSTEM.sales}
You are replying on behalf of SATYAM AI CRM as a real team member — NOT a bot.
CRITICAL: NEVER reveal or hint that you are an AI, bot, or automated system. Never say "connect you with a human", "our team will assist", or "a specialist will follow up". Respond naturally as a knowledgeable sales person.
${buildDefaultLanguageInstruction(languageMirrorMode)}
${buildAddressingInstruction()}
${buildCommerceGuardrails()}
Lead's name (context only, do not use in the reply; use Sir): ${leadName}.
Keep replies concise (2-4 sentences max).
Do NOT return a partial or unfinished sentence.
Always end with proper sentence punctuation (. ! ?).
${shouldAppendCatalogue ? "A catalogue PDF will be sent as a separate WhatsApp document after your reply. Briefly acknowledge that you are sending it now — do not paste raw URLs." : ""}
${repeatCatalogueRequest ? "IMPORTANT: The catalogue PDF was already sent earlier in this chat — the customer can scroll up to open it again (or for product photos / pictures). Confirm it is above; the PDF includes range images. Offer specific model help. Do NOT say it failed to deliver or promise to resend." : ""}
${needsHuman ? "The customer needs special attention. Acknowledge their concern warmly and let them know you will look into it and get back to them." : ""}
${attempt === 1 ? "Your previous answer was incomplete. Rewrite from scratch as a complete response." : ""}`,
            },
            ...contextBlock,
            {
              role: "user",
              content: `${customerMessage}
${knowledgeBase ? `\n\nBusiness knowledge base:\n${knowledgeBase}` : ""}`,
            },
          ],
        });

        const reply = normalizeReplyText(completion.choices[0].message.content ?? "");
        if (!isLikelyIncompleteReply(reply)) {
          return {
            // AI already used the full knowledge base — don't append raw detailsSnippet
            reply: finalizeReply({
              reply,
              catalogueLink,
              shouldAppendCatalogue,
            }),
            language,
            needsHuman,
            engine: "openai",
            sharedCatalogue: shouldAppendCatalogue,
          };
        }
        console.warn("[AI] Rejected incomplete OpenAI reply:", reply);
      }
    } catch {
      // fall through
    }
  }

  const fallback = fallbackReply();
  return {
    ...fallback,
    // Never append raw detailsSnippet — heuristic replies are already generic enough
    reply: finalizeReply({
      reply: fallback.reply,
      catalogueLink,
      shouldAppendCatalogue,
    }),
    sharedCatalogue: shouldAppendCatalogue,
  };
}

// ── 3. generateFollowUp ──────────────────────────────────────────────────────

const DEFAULT_FOLLOW_UP_TEMPLATE =
  "Hello Sir! 😊 Kaise hain aap? Bas connect kar raha tha — jo bhi product / quantity par baat chal rahi thi, agar aapko aur clarity chahiye ho to bata dijiyega.";

/** Lead text usable for a contextual nudge (not empty, not media-only placeholder, not emoji-only noise). */
function hasSubstantiveLeadLastMessageForFollowUp(text: string): boolean {
  if (shouldSkipAutoReplyForInboundText(text)) return false;
  const t = text.trim();
  const core = t.replace(/[\s\p{Extended_Pictographic}\uFE0F\u200D]+/gu, "").trim();
  return core.length >= 2;
}

function followUpGreetingOnlyFallback(aiTone: string): string {
  if (aiTone === "professional") {
    return "Namaste Sir. Asha hai aap theek honge — kaise chal raha hai? Zarurat ho to likhiyega.";
  }
  if (aiTone === "premium") {
    return "Sir, hope you are well — kaise hain aap? Batayein agar aapko abhi koi cheez par discuss karna ho.";
  }
  return "Hello Sir! Kaise hain aap? 😊 Bas yeh jaanne ke liye likha — sab theek hai na?";
}

function buildFollowUpStrictInstructions(): string {
  return `FOLLOW-UP RULES (WhatsApp — lead has gone quiet after they messaged):
- Always open with a brief warm check-in (e.g. kaise hain / hope you are doing well). Do not skip it.
- Do NOT mention proposals, quotations, invoices, or “documents/PDF we sent” unless the LAST LEAD MESSAGE or the LAST OUR MESSAGE below explicitly refers to that exact thing (same topic).
- Never pretend or assume a proposal was shared if there is no evidence in those lines.
- If the last lead message clearly mentions a product, quantity, price, delivery, photos, or demo, you may add ONE short gentle question tied only to that topic — otherwise stay at greeting + open offer to help.
- Maximum 2–3 short sentences total. Address as Sir only (not by personal name). Prefer Hinglish (Roman Hindi) unless the lead wrote only in another script/language — then mirror that script lightly.
- Do not sound robotic or sales-pressurey.`;
}

export async function generateFollowUp(options: {
  leadName: string;
  leadId?: string;
  daysSinceLastMessage: number;
  lastMessage: string;
  /** Last outbound text from our side (same thread), if known — improves context without inventing proposals. */
  lastOutboundMessage?: string;
  followUpDelayDays?: number;
  followUpTemplate?: string;
  aiTone?: string;
}): Promise<FollowUpResult> {
  const {
    leadName,
    daysSinceLastMessage,
    lastMessage,
    lastOutboundMessage = "",
    followUpDelayDays = 2,
    followUpTemplate = DEFAULT_FOLLOW_UP_TEMPLATE,
    aiTone = "sales",
  } = options;

  const shouldSend = daysSinceLastMessage >= followUpDelayDays;
  const reason = shouldSend
    ? `No response for ${daysSinceLastMessage} day(s) (threshold: ${followUpDelayDays} day(s))`
    : `Only ${daysSinceLastMessage} day(s) since last message — threshold not reached (${followUpDelayDays} day(s))`;

  if (!shouldSend) {
    return { shouldSend: false, followUp: "", reason, engine: "heuristic" };
  }

  const substantiveInbound = hasSubstantiveLeadLastMessageForFollowUp(lastMessage);
  const outboundTrimmed = lastOutboundMessage.trim();
  const outboundBlock =
    outboundTrimmed.length > 0
      ? `LAST OUR MESSAGE (verbatim excerpt; may be truncated):\n"""${outboundTrimmed.slice(0, 600)}${outboundTrimmed.length > 600 ? "…" : ""}"""\n`
      : "LAST OUR MESSAGE: (not available — do not invent what we sent).\n";

  const geminiKey = getGeminiKey();
  const openai = getOpenAI();
  const followUpFallback = () => {
    const baseTpl =
      /\bproposal\b/i.test(followUpTemplate) ? DEFAULT_FOLLOW_UP_TEMPLATE : followUpTemplate;
    return baseTpl
      .replace(/{{name}}/gi, "Sir")
      .replace(/{{days}}/gi, String(daysSinceLastMessage));
  };

  if (!substantiveInbound) {
    const followUp = ensureTerminalPunctuation(followUpGreetingOnlyFallback(aiTone));
    return { shouldSend: true, followUp, reason, engine: "heuristic" };
  }

  if (geminiKey) {
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const text = await callGemini({
          system: `${TONE_SYSTEM[aiTone] ?? TONE_SYSTEM.sales}
${buildFollowUpStrictInstructions()}
Do NOT return a partial or unfinished sentence.
Always end with proper sentence punctuation (. ! ?).
${attempt === 1 ? "Your previous response was incomplete. Rewrite from scratch as a complete follow-up." : ""}`,
          prompt: `Lead reference name (do not use in text; say Sir): ${leadName}
Days without response from lead: ${daysSinceLastMessage}

LAST LEAD MESSAGE (verbatim):
"""${lastMessage}"""

${outboundBlock}
Optional style hint from workspace template (do not copy blindly if it mentions proposals without evidence above): "${followUpTemplate}"

Return only follow-up text.`,
          temperature: attempt === 0 ? 0.35 : 0.2,
          maxOutputTokens: 300,
        });
        if (!text?.trim()) continue;
        const cleaned = normalizeReplyText(text);
        if (!isLikelyIncompleteReply(cleaned)) {
          return {
            shouldSend: true,
            followUp: ensureTerminalPunctuation(cleaned),
            reason,
            engine: "gemini",
          };
        }
        console.warn("[AI] Rejected incomplete Gemini follow-up:", cleaned);
      }
    } catch {
      // fall through
    }
  }

  if (openai) {
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: attempt === 0 ? 0.35 : 0.2,
          max_tokens: 250,
          messages: [
            {
              role: "system",
              content: `${TONE_SYSTEM[aiTone] ?? TONE_SYSTEM.sales}
${buildFollowUpStrictInstructions()}
Do NOT return a partial or unfinished sentence.
Always end with proper sentence punctuation (. ! ?).
${attempt === 1 ? "Your previous response was incomplete. Rewrite from scratch as a complete follow-up." : ""}`,
            },
            {
              role: "user",
              content: `Lead reference name (do not use in text): ${leadName}
Days without response from lead: ${daysSinceLastMessage}

LAST LEAD MESSAGE:
"""${lastMessage}"""

${outboundBlock}
Workspace template hint (optional; must follow strict rules above): "${followUpTemplate}"`,
            },
          ],
        });

        const followUp = normalizeReplyText(completion.choices[0].message.content ?? "");
        if (!isLikelyIncompleteReply(followUp)) {
          return {
            shouldSend: true,
            followUp: ensureTerminalPunctuation(followUp),
            reason,
            engine: "openai",
          };
        }
        console.warn("[AI] Rejected incomplete OpenAI follow-up:", followUp);
      }
    } catch {
      // fall through
    }
  }

  const followUp = ensureTerminalPunctuation(followUpFallback());

  return { shouldSend: true, followUp, reason, engine: "heuristic" };
}

// ── Heuristic helpers ─────────────────────────────────────────────────────────

function heuristicAnalyze(
  fullText: string,
  messages: IncomingMessage[],
  handoverKeywords: string[]
): AnalyzeResult {
  const lower = fullText.toLowerCase();

  // Language detection
  const language = detectLanguageHeuristic(fullText);

  // Sentiment
  const positiveWords = ["great","thanks","interested","awesome","perfect","yes","sure","love","excited","good","happy","please","okay","ok"];
  const negativeWords = ["no","not","never","bad","terrible","angry","cancel","refund","complaint","issue","problem","disappointed","worst"];
  const posCount = positiveWords.filter((w) => lower.includes(w)).length;
  const negCount = negativeWords.filter((w) => lower.includes(w)).length;
  const sentiment: Sentiment = negCount > posCount ? "negative" : posCount > negCount ? "positive" : "neutral";

  // Needs human
  const needsHuman = handoverKeywords.some((kw) => lower.includes(kw.toLowerCase())) || sentiment === "negative";

  const leadScore = 35;

  // Stage (no LLM — keep conservative funnel position)
  let stage: LeadStage = "awareness";
  if (leadScore >= 80) stage = "intent";
  else if (leadScore >= 60) stage = "consideration";
  else if (leadScore >= 35) stage = "interest";
  else if (lower.includes("bought") || lower.includes("paid")) stage = "purchase";
  else if (lower.includes("cancel") || lower.includes("not interested")) stage = "closed_lost";

  return { language, sentiment, leadScore, stage, needsHuman, confidence: 0.65, engine: "heuristic" };
}

function heuristicReply(
  customerMessage: string,
  {
    aiTone,
    leadName: _leadName,
    needsHuman,
    context,
    languageMirrorMode = false,
  }: {
    aiTone: string;
    leadName: string;
    needsHuman: boolean;
    context: IncomingMessage[];
    languageMirrorMode?: boolean;
  }
): ReplyResult {
  void _leadName;
  let language = detectLanguageHeuristic(customerMessage);
  if (!languageMirrorMode && language === "English") {
    language = "Hindi";
  }
  const lower = customerMessage.toLowerCase();
  const lastOutbound = [...context].reverse().find((m) => m.direction === "out")?.text?.trim();
  const outboundCount = context.filter((m) => m.direction === "out").length;
  const isFirstReply = outboundCount === 0;

  const wantsCatalogue =
    /\b(catalog|catalogue|brochure|pdf|send.*catalogue|catalogue.*send)\b/.test(lower) ||
    customerAsksForProductPhotos(customerMessage);
  const repeatCatRequest =
    catalogueAlreadySentInContext(context) && customerExplicitlyRequestsCatalogue(customerMessage);

  const mentionsNoGstOrPan =
    /\b(no\s+gst|without\s+gst|don'?t\s+have\s+gst|do\s+not\s+have\s+gst|gst\s+nahi|gst\s+नहीं|gst\s+nahi\s+hai|have\s+no\s+gst|gst\s+available\s+nahi)\b/i.test(
      lower
    ) ||
    /\b(no\s+pan|don'?t\s+have\s+pan|pan\s+nahi|pan\s+नहीं|pan\s+card\s+nahi|without\s+pan)\b/i.test(
      lower
    );

  const refusesAdvanceOrWantsCredit =
    /\b(no\s+advance|not\s+doing\s+advance|won'?t\s+pay\s+advance|without\s+advance|advance\s+nahi|advance\s+नहीं|advance\s+nahi\s+denge|credit\s+only|on\s+credit|udhaar|pure\s+udhaar|cash\s+on\s+delivery|\bcod\s+only\b|pay\s+after\s+delivery|payment\s+after\s+delivery|pehle\s+maal|pehle\s+delivery)\b/i.test(
      lower
    );

  let reply: string;
  if (mentionsNoGstOrPan) {
    reply =
      language === "Hindi" || language === "Urdu"
        ? `Sir, billing / compliance ke liye valid GST number ya valid PAN card zaroori hai — bina inme se kisi ek ke process aage nahi badha sakte. Agar aapke paas abhi GST nahi hai lekin PAN hai, to PAN details share kar dijiye; dono nahi ho to pehle arrangement kar lena better hoga.`
        : `Sir, for proper billing we need a valid GST number or a valid PAN — we can't process orders without one of these on file. If you don't have GST yet but have a PAN, please share it; otherwise we’ll need you to arrange this before we can go ahead.`;
  } else if (refusesAdvanceOrWantsCredit) {
    reply =
      language === "Hindi" || language === "Urdu"
        ? `Samajh gaya Sir. Hamare yahan dispatch advance payment ke baad hi hota hai — open credit / full udhaar par kaam nahi karte. Advance confirm hone ke baad hi order process karte hain; thoda adjust ho sake to next step bata dijiye.`
        : `I understand Sir. We work on advance payment before dispatch — we don't do business on open credit. Once advance is confirmed we process the order; if that works for you, share the details and I'll guide the next step.`;
  } else if (needsHuman) {
    reply = localizedHandoverReply(language, aiTone);
  } else if (wantsCatalogue && repeatCatRequest) {
    reply =
      language === "Hindi"
        ? `Catalogue PDF pehle hi isi chat mein upar bhej diya gaya hai — thoda scroll karke dubara khol sakte hain. Kaunsa product ya model chahiye Sir, bataiye!`
        : language === "Urdu"
        ? `Catalogue PDF pehle hi is chat mein upar bheja ja chuka hai — scroll kar ke dobara khol lein. Kaunsa product aap chahte hain?`
        : `Sir, catalogue PDF pehle hi is chat mein upar share ho chuki hai — scroll up karke dekh lijiye. Kaunsa product / model aapka focus hai?`;
  } else if (wantsCatalogue) {
    reply =
      language === "Hindi"
        ? `Bilkul Sir! 😊 Main abhi AgriBird product catalogue PDF bhej raha hoon. Koi bhi sawaal ho toh zaroor poochein!`
        : language === "Urdu"
        ? `Zaroor Sir! 😊 Main abhi AgriBird catalogue PDF bhej raha hoon — koi sawaal ho to poochiye.`
        : `Sure Sir! 😊 Sending the AgriBird catalogue PDF now — boliye agar kuch aur chahiye.`;
  } else if (
    /\b(demo|demonstration)\b/.test(lower) ||
    /\bmeeting\b/.test(lower) ||
    (/\bcall\b/.test(lower) &&
      /\b(schedule|setup|book|demo|zoom|video|karwa|fix)\b/.test(lower))
  ) {
    reply = localizedDemoReply(language, aiTone);
  } else if (lower.includes("price") || lower.includes("cost") || lower.includes("plan")) {
    reply = localizedPricingReply(language, aiTone);
  } else if (isFirstReply) {
    reply = localizedGreetingReply(language, aiTone);
  } else {
    reply = localizedGenericReply(language, aiTone);
  }

  if (lastOutbound && normalizeText(lastOutbound) === normalizeText(reply)) {
    reply += language === "Hindi"
      ? " Aap apni exact requirement share kar dijiye Sir, main best option suggest karta hoon."
      : language === "Urdu"
      ? " Aap apni exact requirement share karein, main behtareen option suggest karta hoon."
      : " Sir, exact requirement bata dijiyega — main best next step suggest kar dunga.";
  }

  return { reply, language, needsHuman, engine: "heuristic", sharedCatalogue: false };
}

function detectLanguageHeuristic(text: string): string {
  // Devanagari script (Hindi, Marathi)
  if (/[\u0900-\u097F]/.test(text)) return "Hindi";
  // Arabic script
  if (/[\u0600-\u06FF]/.test(text)) return "Urdu";
  // Hinglish hints
  if (/\b(kya|hai|nahi|haan|karna|chahiye|kitna|bhai|acha|achha|ji)\b/i.test(text)) return "Hindi";
  // Chinese characters
  if (/[\u4E00-\u9FFF]/.test(text)) return "Chinese";
  // Spanish markers
  if (/[ñáéíóú¿¡]/i.test(text)) return "Spanish";
  return "English";
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeReplyText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isLikelyIncompleteReply(reply: string): boolean {
  if (!reply) return true;
  const compact = normalizeReplyText(reply);
  const endingCheckText = stripTrailingDecorativeTokens(compact);
  if (!endingCheckText) return true;

  // Fast-path: long, clearly punctuated content is usually complete.
  if (
    endingCheckText.length >= 60 &&
    /[.!?]/.test(endingCheckText) &&
    /[.!?]["')\]]?\s*$/.test(endingCheckText) &&
    !/[,:;]\s*$/.test(endingCheckText) &&
    !/['"“”‘’`]\s*$/.test(endingCheckText)
  ) {
    return false;
  }

  // Very short responses are usually low quality for this workflow.
  if (endingCheckText.length < 16) return true;

  // Must end like a complete sentence.
  if (!/[.!?]["')\]]?\s*$/.test(endingCheckText)) return true;

  // Obvious truncation patterns.
  if (/[,:;]\s*$/.test(endingCheckText)) return true;
  if (/['"“”‘’`]\s*$/.test(endingCheckText)) return true;
  if (/\b\w+'\s*$/i.test(endingCheckText)) return true;

  // Dangling connector only when no terminal punctuation context exists.
  if (/\b(to|for|with|and|or|but|because|if|that|of|in|on)\s*$/i.test(endingCheckText)) return true;

  return false;
}

function ensureTerminalPunctuation(reply: string): string {
  const compact = normalizeReplyText(reply);
  if (!compact) return compact;
  if (/[.!?]["')\]]?\s*$/.test(stripTrailingDecorativeTokens(compact))) return compact;
  return `${compact}.`;
}

function stripTrailingDecorativeTokens(value: string): string {
  return value
    .replace(/[\s\p{Extended_Pictographic}\uFE0F\u200D]+$/gu, "")
    .trim();
}

/** Customer wants to see product visuals; catalogue PDF is the right asset (photos, models, range). */
function customerAsksForProductPhotos(message: string): boolean {
  const t = message.toLowerCase().trim();
  if (!/\b(photo|photos|pic|pics|picture|pictures|image|images|snapshot|snapshots|gallery|tasveer)\b/i.test(t)) {
    return false;
  }
  const shareOrView =
    /\b(send|share|show|forward|attach|give|whatsapp|mail|email|bhej|bhejo|bhejna|dikha|dikhao|dikhaie|dikhaye|chahiye|chahie|manga|mangta|mangte|dekhna|dekho|see|want|need)\b/i.test(
      t
    );
  if (!shareOrView) return false;

  const productish =
    /\b(gun|guns|spray|sprayer|sprayers|knapsack|pump|pumps|nozzle|tank|hose|product|products|model|models|item|items|equipment|machine|machines|tool|tools|catalog|catalogue|brochure|range|line|variant|variants|size|sizes|type|types|agribird)\b/i.test(
      t
    );

  const photoOfSomething =
    /\b(photo|photos|pic|pics|picture|pictures|image|images)\b[\s\S]{0,24}\bof\b/i.test(t) ||
    /\bof\b[\s\S]{0,24}\b(photo|photos|pic|pics|picture|pictures|image|images)\b/i.test(t);
  if (photoOfSomething) {
    const m = t.match(/\bof\b\s+([a-z0-9_-]+)/i);
    const junk = /^(me|us|it|you|this|that|here|there|the|a|an|my|your|invoice|bill|receipt)$/i;
    if (m && !junk.test(m[1] ?? "")) return true;
  }

  return productish;
}

/** Customer wants a phone callback (not a product “spray gun” or generic “call” mention). */
function asksPhoneCallback(message: string): boolean {
  const t = message.normalize("NFC").trim();
  const lower = t.toLowerCase();

  if (!t) return false;
  if (/\b(video\s+call|zoom\s+call|google\s+meet|teams\s+meeting)\b/i.test(lower)) return false;

  if (
    /\b(call\s+me|give\s+(me\s+)?a\s+call|ring\s+me|phone\s+me|callback|call\s+back)\b/i.test(lower)
  ) {
    return true;
  }

  if (
    /\bcall\b[\s\S]{0,8}\b(updaiye|update|upd)\b/i.test(lower) ||
    /\b(updaiye|update)\b[\s\S]{0,12}\bcall\b/i.test(lower)
  ) {
    return true;
  }

  const romanPhoneAsk =
    /\b(call|phone)\b[\s\S]{0,16}\b(kijiye|kariye|karo|kar\s*do|karwa|lagao|lagwa|lagwa\s*dijiye|lagwa\s*dijie|len|lena|loon|lo)\b/i.test(
      lower
    ) ||
    /\b(kijiye|kariye|karo|kar\s*do|karwa|lagao|lagwa)\b[\s\S]{0,16}\b(call|phone)\b/i.test(lower) ||
    /\b(mujhe|mujhko|humko|hame|hamen)\b[\s\S]{0,24}\b(call|phone)\b/i.test(lower);

  const devanagariPhoneAsk =
    /कॉल\s*(करें|करो|कीजिए|लगा|लगाएं|पर\s*बात)/.test(t) ||
    /फ़ोन\s*(करें|करो|कीजिए|लगा|लगाएं|पर\s*बात)/.test(t) ||
    /फोन\s*(करें|करो|कीजिए|लगा|लगाएं|पर\s*बात)/.test(t) ||
    /\b(call|phone)\b[\s\S]{0,12}(करें|करो|कीजिए|लगा)/i.test(t);

  return romanPhoneAsk || devanagariPhoneAsk;
}

/** Photo / video / demo asks: bot must not loop with clarifying questions — human sends assets or handles demo. */
function asksForPhotoVideoOrDemo(message: string): boolean {
  const t = message.normalize("NFC").trim();
  const lower = t.toLowerCase();

  const hasDemo =
    /\b(demo|demonstration|walk\s*through)\b/i.test(lower) ||
    /\u0921\u0947\u092e\u094b/.test(t); // डेमो

  const hasVisual =
    /\b(photo|photos|photograph|pic|pics|picture|pictures|image|images|snapshot|gallery|video|videos|clip|recording)\b/i.test(
      lower
    ) ||
    /फ़ोटो|फोटो|तस्वीर|चित्र|वीडियो|व्हिडिओ|विडियो/.test(t);

  const wantsAction =
    /\b(send|share|show|forward|attach|whatsapp|mail|email|bhej|bhejo|bhejna|bheje|dikha|dikhao|dikhayi|dikhaye|chahiye|chahie|manga|mangta|mangte|dekhna|dekho|want|need|please|plz)\b/i.test(
      lower
    ) ||
    /भेज|दिखा|चाहिए|भेजें|भेजो|देखना|दिखाएं/.test(t);

  if (hasDemo && !/\b(no\s+demo|without\s+demo)\b/i.test(lower)) {
    if (wantsAction || lower.trim().length <= 14) return true;
  }

  if (hasVisual && wantsAction) return true;

  return customerAsksForProductPhotos(message);
}

/** Short “ok / yes / हाँ” after we already spoke — do not send another bot message. */
function isStandaloneAcknowledgementOnly(message: string, context: IncomingMessage[]): boolean {
  const outboundBefore = context.filter((m) => m.direction === "out").length;
  if (outboundBefore === 0) return false;

  const core = message.trim().replace(/^[\s"'“‘]+|[\s"'”’!.]+$/g, "").trim();
  if (!core || core.length > 42) return false;

  if (asksPhoneCallback(core) || asksForPhotoVideoOrDemo(core)) return false;
  if (/[?؟]/.test(core)) return false;

  const lower = core.toLowerCase();

  const latinAck =
    /^(ok|okay|o\.?\s*k\.?|k\.?|yes|yeah|yep|yup|yess|haan|haan ji|ha|han|han ji|hmm+|hm+|ji|ji sir|sir ji|theek|thik|thik hai|theek hai|thik h|accha|acha|achha|achha ji|sure|right|alright|fine|cool|got it|gotcha|samajh gaya|samajh gayi|samajh liya|thanks|thank you|thank u|thx|tnx|shukriya|dhanyawad|noted|understood)(\s+(sir|ji)(\s+ji)?)?$/i.test(
      lower
    );

  const devanagariAck =
    /^(\u0939\u093e\u0902|\u0939\u093e\u0902\u091c\u0940|\u091c\u0940|\u092f\u0938|\u092c\u093f\u0932\u094d\u0915\u0941\u0932|\u0920\u0940\u0915|\u0920\u0940\u0915\u094d|\u0928\u092e\u0938\u094d\u0924\u0947|\u0927\u0928\u094d\u092f\u0935\u093e\u0926)(\s+[\u0900-\u097F\s]{0,10}(sir|\u0938\u0930)?)?$/u.test(
      core
    );

  return latinAck || devanagariAck;
}

function localizedTeamWillCallReply(customerMessage: string, languageMirrorMode: boolean): string {
  const mirrorScript =
    languageMirrorMode &&
    (/[\u0900-\u097F]/.test(customerMessage) || detectLanguageHeuristic(customerMessage) === "Hindi");
  if (mirrorScript) {
    return "जी Sir, हमारी टीम का सदस्य अभी आपको कॉल करेगा।";
  }
  return "Ji Sir, hamara team member abhi aapko call karega.";
}

type InboundReplyIntent =
  | { kind: "continue" }
  | { kind: "silent_skip"; escalateToHuman: boolean }
  | { kind: "team_call_script"; replyText: string };

function classifyInboundReplyIntent(
  customerMessage: string,
  context: IncomingMessage[],
  languageMirrorMode: boolean
): InboundReplyIntent {
  const trimmed = customerMessage.trim();
  if (!trimmed) return { kind: "continue" };

  if (asksPhoneCallback(trimmed)) {
    return { kind: "team_call_script", replyText: localizedTeamWillCallReply(trimmed, languageMirrorMode) };
  }

  if (asksForPhotoVideoOrDemo(trimmed)) {
    return { kind: "silent_skip", escalateToHuman: true };
  }

  if (isStandaloneAcknowledgementOnly(trimmed, context)) {
    return { kind: "silent_skip", escalateToHuman: false };
  }

  return { kind: "continue" };
}

/** True if an earlier AGENT message shows we already shared the PDF or discussed the catalogue as already available in the chat. */
function catalogueAlreadySentInContext(context: IncomingMessage[]): boolean {
  return context
    .filter((m) => m.direction === "out")
    .some((m) => {
      const t = m.text.toLowerCase();
      if (t.includes("[agribird catalogue pdf]")) return true;
      // Explicit send / share language
      if (
        /\b(i'?m sending|sending you|sent you|i'?ve sent|already sent|shared the|attached the|send it over|sending it)\b/.test(t) &&
        /\b(catalog|catalogue|brochure|pdf)\b/.test(t)
      ) {
        return true;
      }
      // Follow-up implies catalogue was already shared — scroll up for the PDF
      if (
        /\b(catalog|catalogue|brochure)\b/.test(t) &&
        /\b(look at|look through|went through|questions about|specific questions|had a chance|did you get|get a chance|checking in)\b/.test(
          t
        )
      ) {
        return true;
      }
      return false;
    });
}

/** Customer is explicitly asking to receive the catalogue / PDF again. */
function customerExplicitlyRequestsCatalogue(message: string): boolean {
  const t = message.toLowerCase().trim();
  return (
    /\b(send|share|email|forward|give|whatsapp)\b[\s\S]{0,48}\b(catalog|catalogue|brochure|pdf)\b/.test(t) ||
    /\b(catalog|catalogue|brochure|pdf)\b[\s\S]{0,48}\b(send|share|please|bhej|bhejo)\b/.test(t) ||
    /\b(send me|share the|share your|mail me)\b[\s\S]{0,32}\b(catalog|catalogue|brochure)\b/.test(t) ||
    customerAsksForProductPhotos(message)
  );
}

function shouldShareCatalogue(args: {
  customerMessage: string;
  context?: IncomingMessage[];
  catalogueLink?: string;
  autoShareCatalogue: boolean;
}): boolean {
  if (!args.autoShareCatalogue) return false;

  // Never send again if the catalogue was already shared in this conversation.
  if (catalogueAlreadySentInContext(args.context ?? [])) return false;

  const text = args.customerMessage.toLowerCase();
  if (customerAsksForProductPhotos(args.customerMessage)) return true;
  if (/\b(price|pricing|product|catalog|catalogue|brochure|details|spec|feature|model|plan|quote|carton|qty|quantity)\b/.test(text)) {
    return true;
  }
  return isAffirmativeForDetails(args.customerMessage, args.context ?? []);
}

function finalizeReply(args: {
  reply: string;
  detailsSnippet?: string;
  catalogueLink?: string;
  shouldAppendCatalogue: boolean;
}): string {
  const base = ensureTerminalPunctuation(args.reply);
  const withDetails = args.detailsSnippet?.trim()
    ? `${base}\n\nDetails:\n${args.detailsSnippet.trim()}`
    : base;
  if (!args.shouldAppendCatalogue || !args.catalogueLink?.trim()) return withDetails;
  const link = args.catalogueLink.trim();
  if (withDetails.toLowerCase().includes(link.toLowerCase())) return withDetails;
  return `${withDetails}\n\nCatalogue: ${link}`;
}

function shouldIncludeCatalogueDetails(args: {
  customerMessage: string;
  context: IncomingMessage[];
  productCatalogueInformation: string;
}): boolean {
  if (!args.productCatalogueInformation.trim()) return false;
  const text = args.customerMessage.toLowerCase();
  if (customerAsksForProductPhotos(args.customerMessage)) return true;
  if (/\b(details?|spec|specification|price|pricing|carton|qty|quantity|model|feature|catalog|catalogue|brochure)\b/.test(text)) {
    return true;
  }
  return isAffirmativeForDetails(args.customerMessage, args.context);
}

function isAffirmativeForDetails(message: string, context: IncomingMessage[]): boolean {
  const text = message.toLowerCase().trim();
  const affirmative = /^(yes|yeah|yep|ok|okay|sure|haan|ha|yes pls|yes please)(\b|$)/.test(text);
  if (!affirmative) return false;
  const recent = context.slice(-6).map((m) => m.text.toLowerCase()).join(" ");
  return /\b(details?|catalog|catalogue|brochure|price|pricing|spec|carton|qty|quantity|model|photo|photos|pic|pics|picture|pictures|image|images)\b/.test(
    recent
  );
}

function localizedGreetingReply(language: string, aiTone: string): string {
  if (language === "Hindi") {
    return aiTone === "professional"
      ? `Namaste Sir, message ke liye dhanyavaad. Please bataiye kis product / service mein help chahiye.`
      : `Hello Sir! 😊 Thanks for message — kaunsa product ya quantity dekh rahe ho, bataiye?`;
  }
  if (language === "Urdu") {
    return `Assalamualaikum Sir! Shukriya — kis cheez mein help chahiye?`;
  }
  return aiTone === "professional"
    ? `Thank you for writing in, Sir. Please share your requirement so I can suggest the right option.`
    : `Hi Sir! 😊 Thanks for reaching out — bataiye kya requirement hai, main help kar dunga.`;
}

function localizedGenericReply(language: string, aiTone: string): string {
  if (language === "Hindi") {
    return aiTone === "premium"
      ? `Samajh gaya Sir. Aapki requirement note kar raha hoon — best-fit option bata dunga.`
      : `Samajh gaya Sir 😊 Thoda use-case detail mein bata dijiye, main best option suggest kar dunga.`;
  }
  if (language === "Urdu") {
    return `Samajh gaya Sir. Thori si detail bhej dein, main best option suggest karta hoon.`;
  }
  return aiTone === "professional"
    ? `Thank you, Sir. A bit more detail and I can guide you accurately.`
    : `Got it Sir! Thoda detail share kariye, main sahi option suggest kar dunga.`;
}

function localizedDemoReply(language: string, aiTone: string): string {
  if (language === "Hindi") {
    return `Sir, demo set kar lete hain — kaun sa date & time aapke liye theek rahega?`;
  }
  if (language === "Urdu") {
    return `Sir, demo schedule kar lete hain — preferred date & time?`;
  }
  return aiTone === "professional"
    ? `Sure Sir, I can set up a demo. Please share a preferred date and time.`
    : `Zaroor Sir! Demo ke liye kaun sa date & time bataiye?`;
}

function localizedPricingReply(language: string, aiTone: string): string {
  if (language === "Hindi") {
    return `Sir, pricing aapke use-case aur quantity pe depend karti hai — thoda order size / model bata dijiye, main exact quote share kar dunga.`;
  }
  if (language === "Urdu") {
    return `Sir, pricing requirement pe depend karti hai — quantity / model bata dijiye, main exact quote bhejta hoon.`;
  }
  return aiTone === "premium"
    ? `Sir, plans depend on your exact need. Share team size or qty and I will send a precise quote.`
    : `Good question Sir — price use-case & qty pe based hai. Woh bata dijiyega, exact quote bhej dunga.`;
}

function localizedHandoverReply(language: string, aiTone: string): string {
  if (language === "Hindi") {
    return `Bilkul Sir, samajh gaya. Is par main check karke jald aapko update kar dunga.`;
  }
  if (language === "Urdu") {
    return `Zaroor Sir, main is par dhyan deke jald update karunga.`;
  }
  return aiTone === "professional"
    ? `Noted, Sir. I will look into this and get back to you shortly.`
    : `Thik hai Sir! Main dekh ke jald reply kar dunga.`;
}
