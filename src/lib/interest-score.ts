function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Persist `analyzeChat().leadScore` only — neutral default when the model omits a number. */
export function clampAiInterestScore0to100(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 35;
  return clamp(Math.round(v), 0, 100);
}
