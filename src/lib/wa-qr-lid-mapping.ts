import { readFile } from "node:fs/promises";
import path from "node:path";
import { isPhoneExcludedFromAutoReply } from "@/lib/auto-reply-exclusions";
import type { AutomationSettings } from "@/lib/models/settings";
import { canonicalWaContactKey } from "@/lib/wa-phone";

/**
 * Baileys `useMultiFileAuthState` stores PN↔LID pairs as:
 * - `lid-mapping-{phoneDigits}.json` → LID string
 * - `lid-mapping-{lidDigits}_reverse.json` → phone string
 *
 * When `remoteJidAlt` is missing on inbound messages, `from` is still the LID local part;
 * auto-reply exclusions use real MSISDN, so we resolve via these files.
 */
async function readJsonStringFile(filePath: string): Promise<string | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
  } catch {
    // missing or invalid
  }
  return null;
}

export async function resolvePnFromLidReverseMappingFile(
  authDir: string,
  lidLocalPart: string
): Promise<string | null> {
  const c = canonicalWaContactKey(lidLocalPart);
  if (!c) return null;
  return readJsonStringFile(path.join(authDir, `lid-mapping-${c}_reverse.json`));
}

export async function resolveLidFromPnForwardMappingFile(
  authDir: string,
  canonicalPn: string
): Promise<string | null> {
  const c = canonicalWaContactKey(canonicalPn);
  if (!c) return null;
  return readJsonStringFile(path.join(authDir, `lid-mapping-${c}.json`));
}

export async function isAutoReplyExcludedForQrInbound(
  settings: AutomationSettings,
  rawFromLocalPart: string,
  authDir: string | null
): Promise<boolean> {
  if (isPhoneExcludedFromAutoReply(settings, rawFromLocalPart)) return true;
  if (!authDir) return false;

  const cFrom = canonicalWaContactKey(rawFromLocalPart);
  if (!cFrom) return false;

  const pnFromReverse = await resolvePnFromLidReverseMappingFile(authDir, rawFromLocalPart);
  if (pnFromReverse && isPhoneExcludedFromAutoReply(settings, pnFromReverse)) return true;

  for (const ex of settings.autoReplyExcludedPhones ?? []) {
    const mappedLid = await resolveLidFromPnForwardMappingFile(authDir, ex);
    if (mappedLid && canonicalWaContactKey(mappedLid) === cFrom) return true;
  }

  return false;
}
