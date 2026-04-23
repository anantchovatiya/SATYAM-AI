import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getOrCreateSettings } from "@/lib/models/settings";
import { requireApiUser } from "@/lib/auth/session";
import { normalizeTemplateLanguageCode, resolveWhatsAppRuntimeConfig } from "@/lib/whatsapp";
import {
  buildSendComponentsScaffold,
  fetchMessageTemplateByName,
} from "@/lib/whatsapp-template-scaffold";

/**
 * GET ?templateName=hello&languageCode=en_US
 * Uses WHATSAPP_WABA_ID (env) and the same token as Cloud API to pull the template from Meta
 * and return a valid `components` array you can paste into bulk send.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiUser(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const { searchParams } = new URL(req.url);
    const templateName = String(searchParams.get("templateName") ?? "").trim();
    const languageCode = normalizeTemplateLanguageCode(
      String(searchParams.get("languageCode") ?? "en_US").trim() || "en_US"
    );

    if (!templateName) {
      return NextResponse.json({ error: "Query parameter templateName is required." }, { status: 400 });
    }

    const wabaId = process.env.WHATSAPP_WABA_ID?.trim();
    if (!wabaId) {
      return NextResponse.json(
        {
          error:
            "Set WHATSAPP_WABA_ID in the server environment (WhatsApp → Business settings → your account ID; same place as Business Manager). Then restart. Token needs `whatsapp_business_management`.",
        },
        { status: 400 }
      );
    }

    const db = await getDb();
    const settings = await getOrCreateSettings(db, userId);
    const wa = resolveWhatsAppRuntimeConfig(settings);
    if (!wa?.token) {
      return NextResponse.json(
        { error: "WhatsApp token is not configured (env or dashboard)." },
        { status: 400 }
      );
    }

    const tmpl = await fetchMessageTemplateByName(wabaId, wa.token, templateName, languageCode);
    if (!tmpl) {
      return NextResponse.json(
        {
          error: `No APPROVED template named "${templateName}" with language like "${languageCode}" was found. Check spelling, language in Manager (en vs en_US), and template status.`,
        },
        { status: 404 }
      );
    }

    const { components, notes } = buildSendComponentsScaffold(tmpl.components);

    return NextResponse.json({
      ok: true,
      templateName: tmpl.name,
      language: tmpl.language,
      status: tmpl.status,
      /** Paste into "Template components (JSON)" */
      components,
      /** Human checklist */
      notes,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/whatsapp/template-scaffold]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
