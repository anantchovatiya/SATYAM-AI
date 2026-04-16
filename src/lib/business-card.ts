/**
 * Business card detection, data extraction (via Gemini Vision), and Excel export.
 *
 * Flow:
 *  1. Customer sends an image over WhatsApp.
 *  2. extractBusinessCardData() checks if it's a business card and, if so,
 *     returns structured English-language contact data.
 *  3. saveBusinessCardToExcel() appends the data to business-cards.xlsx in the
 *     project root, creating the file + sheet if they don't exist yet.
 */

import { writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BusinessCardData {
  name: string;
  jobTitle: string;
  company: string;
  phones: string[];
  emails: string[];
  website: string;
  address: string;
}

// ── Paths ────────────────────────────────────────────────────────────────────

const EXCEL_PATH = path.join(process.cwd(), "business-cards.xlsx");

// ── Gemini Vision helpers ────────────────────────────────────────────────────

function getGeminiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Gemini v1beta often returns 404 for 1.5-era IDs — never use them. */
function isUnsupportedGeminiModelId(id: string): boolean {
  const x = id.trim().toLowerCase().replace(/^models\//, "");
  return (
    x.includes("1.5-flash") ||
    x.includes("1.5-pro") ||
    x.includes("gemini-1.5") ||
    x === "gemini-pro" ||
    x.includes("text-bison") ||
    x.includes("chat-bison")
  );
}

/** Map env value to a model id that works on generativelanguage v1beta. */
function sanitizeGeminiModelId(raw: string): string {
  const s = raw.trim().replace(/^models\//i, "");
  if (!s) return "gemini-2.5-flash";
  if (isUnsupportedGeminiModelId(s)) return "gemini-2.5-flash";
  return s;
}

function getGeminiModels(): string[] {
  const preferred = sanitizeGeminiModelId(
    process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash"
  );
  const candidates = [
    preferred,
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
  ];
  return Array.from(new Set(candidates.filter((id) => !isUnsupportedGeminiModelId(id))));
}

const EXTRACTION_PROMPT = `Analyze this image carefully.

First, determine: Is this a business card (visiting card / name card)?

If it is NOT a business card, respond with exactly one word: NOT_A_BUSINESS_CARD

If it IS a business card, extract every piece of contact information visible on the card.
Translate ALL text to English, regardless of the original language on the card.
Respond with ONLY a compact JSON object — no markdown fences, no commentary. Use this exact shape (phones and emails as single comma-separated strings to keep the reply short):

{
  "name": "Full name of the person",
  "jobTitle": "Job title or empty string",
  "company": "Company name or empty string",
  "phones": "+91 999..., +91 ... (comma-separated, all numbers from card)",
  "emails": "a@b.com, c@d.com (comma-separated, or empty string)",
  "website": "URL or empty string",
  "address": "one line in English or empty string"
}

Rules:
- Keep strings short; truncate a very long address to ~120 characters.
- If a field has no data, use "".
- Output ONLY the JSON object — nothing else.`;

/** Strip fences / prose and parse JSON from Gemini output. */
function parseBusinessCardJson(raw: string): BusinessCardData | null {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  }
  const normalizeRecord = (rec: Record<string, unknown>): BusinessCardData => {
    const phonesRaw = rec.phones;
    const emailsRaw = rec.emails;
    const phones: string[] = Array.isArray(phonesRaw)
      ? (phonesRaw as unknown[]).map(String)
      : String(phonesRaw ?? "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
    const emails: string[] = Array.isArray(emailsRaw)
      ? (emailsRaw as unknown[]).map(String)
      : String(emailsRaw ?? "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
    return {
      name: String(rec.name ?? ""),
      jobTitle: String(rec.jobTitle ?? ""),
      company: String(rec.company ?? ""),
      phones,
      emails,
      website: String(rec.website ?? ""),
      address: String(rec.address ?? ""),
    };
  };

  const tryParse = (s: string): BusinessCardData | null => {
    try {
      const raw = JSON.parse(s) as Record<string, unknown>;
      if (raw && typeof raw === "object") return normalizeRecord(raw);
    } catch {
      /* ignore */
    }
    return null;
  };

  const direct = tryParse(text);
  if (direct) return direct;

  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        const parsed = tryParse(slice);
        if (parsed) return parsed;
      }
    }
  }
  return null;
}

/** Last resort when JSON is truncated mid-stream (still has useful fields). */
function extractBusinessCardFieldsLoose(text: string): BusinessCardData | null {
  const pickStr = (key: string): string => {
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i");
    const m = text.match(re);
    return m?.[1]?.replace(/\\"/g, '"').trim() ?? "";
  };
  /** Comma-separated string OR legacy JSON array (possibly truncated mid last string). */
  const pickList = (key: string): string[] => {
    const asStr = pickStr(key);
    if (asStr) {
      return asStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const arrRe = new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)`, "i");
    const innerRaw = text.match(arrRe)?.[1] ?? "";
    const inner = innerRaw.trim();
    const items: string[] = [];
    const re = /"((?:\\\\.|[^"\\\\])*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner)) !== null) {
      items.push(m[1].replace(/\\"/g, '"').trim());
    }
    const after = inner.slice(re.lastIndex).trim();
    if (after.startsWith('"')) {
      const partial = after.slice(1).trim();
      if (partial) items.push(partial);
    }
    return items.filter(Boolean);
  };

  const name = pickStr("name");
  if (!name) return null;
  return {
    name,
    jobTitle: pickStr("jobTitle"),
    company: pickStr("company"),
    phones: pickList("phones"),
    emails: pickList("emails"),
    website: pickStr("website"),
    address: pickStr("address"),
  };
}

// ── Core: extract data from image buffer ─────────────────────────────────────

export async function extractBusinessCardData(
  imageBuffer: Buffer,
  mimeType = "image/jpeg"
): Promise<BusinessCardData | null> {
  const key = getGeminiKey();
  if (!key) {
    console.warn("[business-card] GEMINI_API_KEY not set — skipping extraction");
    return null;
  }

  const base64 = imageBuffer.toString("base64");
  const models = getGeminiModels();

  for (const model of models) {
    try {
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) {
          await sleep(400 * attempt * attempt);
        }
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            model
          )}:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    { inlineData: { mimeType, data: base64 } },
                    { text: EXTRACTION_PROMPT },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 8192,
              },
            }),
          }
        );

        if (res.ok) break;
        const retryable = res.status === 503 || res.status === 502 || res.status === 429;
        if (retryable && attempt < 2) {
          console.warn(
            `[business-card] Gemini ${model} HTTP ${res.status} (attempt ${attempt + 1}/3), retrying…`
          );
          continue;
        }
        console.warn(`[business-card] Gemini ${model} HTTP ${res.status}`);
        res = null;
        break;
      }

      if (!res?.ok) continue;

      const json = (await res.json()) as {
        candidates?: {
          content?: { parts?: { text?: string }[] };
          finishReason?: string;
        }[];
      };
      const candidate = json.candidates?.[0];
      const text = candidate?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim();

      if (!text) continue;

      if (text.toUpperCase().includes("NOT_A_BUSINESS_CARD")) {
        return null; // image is not a business card
      }

      if (candidate?.finishReason === "MAX_TOKENS") {
        console.warn(`[business-card] Gemini ${model} hit MAX_TOKENS — try another model or smaller image`);
      }

      let data = parseBusinessCardJson(text);
      if (!data) {
        data = extractBusinessCardFieldsLoose(text);
      }
      if (!data) {
        console.warn("[business-card] Could not parse JSON from Gemini:", text.slice(0, 280));
        continue; // try next model
      }

      return data;
    } catch (err) {
      console.warn(`[business-card] Error with model ${model}:`, err);
    }
  }

  return null;
}

// ── Core: append row to Excel ─────────────────────────────────────────────────

export async function saveBusinessCardToExcel(
  data: BusinessCardData,
  senderPhone: string
): Promise<void> {
  const row: Record<string, string> = {
    Name: data.name || "",
    "Job Title": data.jobTitle || "",
    Company: data.company || "",
    "Phone Numbers": (data.phones ?? []).join(", "),
    Emails: (data.emails ?? []).join(", "),
    Website: data.website || "",
    Address: data.address || "",
    "Received From (WhatsApp)": senderPhone,
    "Date Received": new Date().toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
  };

  let workbook: XLSX.WorkBook;
  let worksheet: XLSX.WorkSheet;

  try {
    await access(EXCEL_PATH);
    const fileBuffer = await readFile(EXCEL_PATH);
    workbook = XLSX.read(fileBuffer, { type: "buffer" });

    const sheetName = "Business Cards";
    if (workbook.Sheets[sheetName]) {
      worksheet = workbook.Sheets[sheetName];
      XLSX.utils.sheet_add_json(worksheet, [row], {
        skipHeader: true,
        origin: -1, // append after last row
      });
    } else {
      worksheet = XLSX.utils.json_to_sheet([row]);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    }
  } catch {
    // File doesn't exist yet — create fresh
    workbook = XLSX.utils.book_new();
    worksheet = XLSX.utils.json_to_sheet([row]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Business Cards");
  }

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  await writeFile(EXCEL_PATH, buffer);

  console.log(
    `[business-card] Saved: ${data.name} (${data.company}) from ${senderPhone}`
  );
}

/** Number of data rows in the Business Cards sheet (0 if file or sheet missing). */
export async function getBusinessCardCount(): Promise<number> {
  try {
    await access(EXCEL_PATH);
    const fileBuffer = await readFile(EXCEL_PATH);
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const worksheet = workbook.Sheets["Business Cards"];
    if (!worksheet) return 0;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);
    return rows.length;
  } catch {
    return 0;
  }
}
