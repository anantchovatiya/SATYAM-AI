import type { ConversationStatus } from "@/lib/models/lead";

export function getConversationStatus(args: {
  lastInboundAt?: Date | null;
  lastOutboundAt?: Date | null;
  needsHuman?: boolean;
  now?: Date;
}): ConversationStatus {
  const now = args.now ?? new Date();
  const inAt = args.lastInboundAt ?? null;
  const outAt = args.lastOutboundAt ?? null;
  const needsHuman = Boolean(args.needsHuman);

  if (needsHuman) return "escalated";
  if (!inAt && !outAt) return "new_inquiry";
  if (inAt && (!outAt || inAt > outAt)) {
    const days = Math.floor((now.getTime() - inAt.getTime()) / 86_400_000);
    return days >= 2 ? "stalled" : "awaiting_team_reply";
  }
  return "awaiting_customer_reply";
}

export function hasSensitiveTopic(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

const GREETING_ONLY_RE =
  /^(hi+|hello+|hey+|hlo+|namaste|salam|assalamualaikum|good (morning|afternoon|evening))[\s!.,?]*$/i;
const ANGER_RE =
  /(angry|upset|complaint|refund|cancel|fraud|scam|worst|hate|terrible|not happy|very bad)/i;

export function shouldEscalateConversation(args: {
  latestText: string;
  keywords: string[];
  analysisNeedsHuman: boolean;
  sentiment?: "positive" | "neutral" | "negative";
}): boolean {
  const text = args.latestText.trim();
  if (!text) return false;
  if (GREETING_ONLY_RE.test(text)) return false;
  if (hasSensitiveTopic(text, args.keywords)) return true;
  if (ANGER_RE.test(text)) return true;

  // If model says human handover but content is short/neutral, do not escalate aggressively.
  if (args.analysisNeedsHuman && args.sentiment === "negative" && text.split(/\s+/).length >= 3) {
    return true;
  }
  return false;
}
