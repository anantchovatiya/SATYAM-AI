/**
 * Build Cloud API "components" for template sends from a Meta
 * `GET /{waba-id}/message_templates` component definition.
 */

export type MetaTemplateComponent = {
  type: string;
  format?: string;
  text?: string;
  example?: { header_text?: string[]; body_text?: string[][]; header_handle?: string[] };
  buttons?: Array<{ type: string; text?: string; url?: string; phone_number?: string }>;
};

const PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g;

/**
 * Every `{{…}}` in order (left to right) — the send API expects one `parameters` entry
 * per placeholder occurrence.
 */
export function parsePlaceholderKeysInOrder(text: string): string[] {
  const keys: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER_RE);
  while ((m = re.exec(text)) !== null) {
    keys.push(m[1]!.trim());
  }
  return keys;
}

function isNumberedKey(key: string): boolean {
  return /^\d+$/.test(key);
}

/**
 * Produces a valid send payload: header / body / button blocks with placeholder values
 * the user can replace before sending.
 */
export function buildSendComponentsScaffold(components: MetaTemplateComponent[]): {
  components: unknown[];
  notes: string[];
} {
  const out: unknown[] = [];
  const notes: string[] = [];

  for (const c of components) {
    const t = (c.type || "").toUpperCase();
    if (t === "HEADER") {
      const f = (c.format || "").toUpperCase();
      if (f === "TEXT" && c.text) {
        const keys = parsePlaceholderKeysInOrder(c.text);
        if (keys.length) {
          out.push({
            type: "header",
            parameters: keys.map((k) =>
              isNumberedKey(k)
                ? { type: "text", text: "Header text – replace" }
                : { type: "text", parameter_name: k, text: "Header text – replace" }
            ),
          });
          notes.push(`Header has ${keys.length} text variable(s) — keep order, edit text.`);
        }
      } else if (f === "IMAGE") {
        out.push({
          type: "header",
          parameters: [
            {
              type: "image",
              image: { link: "https://example.com/replace-with-public-https-image.jpg" },
            },
          ],
        });
        notes.push("Header is IMAGE: replace `image.link` with a public https URL to your image.");
      } else if (f === "VIDEO") {
        out.push({
          type: "header",
          parameters: [
            { type: "video", video: { link: "https://example.com/replace-with-public-https.mp4" } },
          ],
        });
        notes.push("Header is VIDEO: replace the link (public https, ≤ 16 MB for typical limits).");
      } else if (f === "DOCUMENT") {
        out.push({
          type: "header",
          parameters: [
            {
              type: "document",
              document: { link: "https://example.com/replace.pdf", filename: "document.pdf" },
            },
          ],
        });
        notes.push("Header is DOCUMENT: replace link and filename.");
      }
    }
    if (t === "BODY" && c.text) {
      const keys = parsePlaceholderKeysInOrder(c.text);
      if (keys.length) {
        out.push({
          type: "body",
          parameters: keys.map((k) =>
            isNumberedKey(k)
              ? { type: "text", text: "Body value – replace" }
              : { type: "text", parameter_name: k, text: "Body value – replace" }
          ),
        });
        notes.push(
          `Body has ${keys.length} variable(s) (${keys.map((k) => `{{${k}}}`).join(", ")}). For named fields, do not remove parameter_name.`
        );
      }
    }
    if (t === "BUTTONS" && Array.isArray(c.buttons)) {
      c.buttons.forEach((btn, index) => {
        const btype = (btn.type || "").toUpperCase();
        if (btype === "URL" && typeof btn.url === "string" && /\{\{[^}]+\}\}/.test(btn.url)) {
          out.push({
            type: "button",
            sub_type: "url",
            index: String(index),
            parameters: [{ type: "text", text: "url-path-suffix" }],
          });
          notes.push(
            `Button index ${index} (URL) has a variable in the link — set the subpath text only (as Meta expects for this button).`
          );
        }
      });
    }
  }

  return { components: out, notes };
}

export type FetchedMessageTemplate = {
  name: string;
  language: string;
  status?: string;
  components: MetaTemplateComponent[];
};

function normalizeLang(code: string): string {
  return String(code)
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
}

function languageMatches(templatesLang: string, requested: string): boolean {
  const a = normalizeLang(templatesLang);
  const b = normalizeLang(requested);
  if (a === b) return true;
  const ap = a.split("_")[0];
  const bp = b.split("_")[0];
  if (ap && bp && ap === bp && (a.length <= 3 || b.length <= 3)) return true;
  return false;
}

/**
 * Fetches all message templates and returns the one matching name + language (best effort).
 * Requires `whatsapp_business_management` on the system user token.
 */
export async function fetchMessageTemplateByName(
  wabaId: string,
  accessToken: string,
  templateName: string,
  languageCode: string
): Promise<FetchedMessageTemplate | null> {
  const v = "v22.0";
  const base = `https://graph.facebook.com/${v}/${encodeURIComponent(wabaId)}/message_templates`;
  const url = new URL(base);
  url.searchParams.set("fields", "name,status,language,components");
  url.searchParams.set("limit", "500");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json()) as {
    data?: Array<{
      name: string;
      language?: string;
      status?: string;
      components?: MetaTemplateComponent[];
    }>;
    error?: { message?: string; code?: number };
  };
  if (json.error || !res.ok) {
    const msg = json.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Meta message_templates: ${msg}`);
  }

  const items = json.data ?? [];
  const nameLower = templateName.trim().toLowerCase();
  const sameName = items.filter((x) => (x.name ?? "").toLowerCase() === nameLower);
  const approved = sameName.filter(
    (x) => (x.status ?? "").toUpperCase() === "APPROVED" || (x.status ?? "") === ""
  );
  const pool = approved.length > 0 ? approved : sameName;
  const byLang = pool.filter((x) => x.language && languageMatches(x.language, languageCode));
  const pick = byLang[0] ?? pool[0];
  if (!pick) return null;

  return {
    name: pick.name,
    language: pick.language ?? languageCode,
    status: pick.status,
    components: pick.components ?? [],
  };
}
