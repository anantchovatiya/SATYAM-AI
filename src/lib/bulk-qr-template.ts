/** Rows parsed from the bulk QR recipients textarea (CSV / TSV). */
export interface BulkQrRecipientInput {
  phoneDigits: string;
  /** Full display name when only one name column is present. */
  name?: string;
  firstname?: string;
  lastname?: string;
  company?: string;
}

const PLACEHOLDER_RE = /\{(firstname|lastname|name|phone|company)\}/gi;

export function applyPlaceholders(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER_RE, (_, raw: string) => {
    const k = String(raw).toLowerCase();
    return vars[k] ?? "";
  });
}

export function buildPlaceholderVars(
  row: BulkQrRecipientInput,
  leadNameFallback?: string | null
): Record<string, string> {
  let firstname = (row.firstname ?? "").trim();
  let lastname = (row.lastname ?? "").trim();
  let name = (row.name ?? "").trim();
  const company = (row.company ?? "").trim();

  if (!name && leadNameFallback) {
    name = leadNameFallback.trim();
  }

  if (!name && (firstname || lastname)) {
    name = [firstname, lastname].filter(Boolean).join(" ").trim();
  }

  if ((!firstname || !lastname) && name) {
    const bits = name.split(/\s+/).filter(Boolean);
    if (!firstname && bits.length) firstname = bits[0] ?? "";
    if (!lastname && bits.length > 1) lastname = bits.slice(1).join(" ");
  }

  const phone = row.phoneDigits;
  if (!name) name = phone;

  return {
    firstname,
    lastname,
    name,
    phone,
    company,
  };
}

/**
 * One phone per line, or `phone,name`, or `phone,firstname,lastname`, optional 4th: company.
 * Header row `phone,...` is skipped.
 */
export function parseBulkQrRecipientLines(raw: string): BulkQrRecipientInput[] {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: BulkQrRecipientInput[] = [];
  let allowHeader = true;

  for (const line of lines) {
    const parts = line.split(/[,;\t]/).map((p) => p.trim()).filter((p) => p.length > 0);
    if (parts.length === 0) continue;

    if (allowHeader && /^phone$/i.test(parts[0] ?? "")) {
      allowHeader = false;
      continue;
    }
    allowHeader = false;

    const phoneRaw = parts[0] ?? "";
    const digits = phoneRaw.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) continue;

    if (parts.length === 1) {
      out.push({ phoneDigits: digits });
    } else if (parts.length === 2) {
      out.push({ phoneDigits: digits, name: parts[1] });
    } else if (parts.length === 3) {
      out.push({
        phoneDigits: digits,
        firstname: parts[1] ?? "",
        lastname: parts[2] ?? "",
      });
    } else {
      const company = parts[parts.length - 1] ?? "";
      const lastname =
        parts.slice(2, -1).join(" ").trim() || (parts[2] ?? "");
      out.push({
        phoneDigits: digits,
        firstname: parts[1] ?? "",
        lastname,
        company,
      });
    }
  }

  return out;
}
