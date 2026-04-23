function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Clamp score from `analyzeChat` / `resolveGeminiLeadScoreLast5` (last-5 message window). */
export function clampAiInterestScore0to100(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 35;
  return clamp(Math.round(v), 0, 100);
}
