import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getOrCreateSettings } from "@/lib/models/settings";
import { waMessagesCollection } from "@/lib/models/webhook-log";
import { fetchCloudMediaBinary, resolveWhatsAppRuntimeConfig } from "@/lib/whatsapp";
import { requireApiUser } from "@/lib/auth/session";
import { resolveQrMediaAbsolutePath } from "@/lib/wa-qr-media-storage";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiUser(req);
    if (auth instanceof Response) return auth;

    const waMessageId = req.nextUrl.searchParams.get("waMessageId")?.trim();
    if (!waMessageId) {
      return NextResponse.json({ error: "waMessageId is required" }, { status: 400 });
    }

    const db = await getDb();
    const doc = await waMessagesCollection(db).findOne({
      userId: auth.userId,
      waMessageId,
    });
    if (!doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (doc.qrMediaRelPath) {
      const abs = resolveQrMediaAbsolutePath(doc.qrMediaRelPath, auth.userId.toHexString());
      if (!abs) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      try {
        const buf = await readFile(abs);
        const contentType = doc.mediaMime?.trim() || "application/octet-stream";
        return new NextResponse(new Uint8Array(buf), {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "private, no-store, max-age=0",
          },
        });
      } catch {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    if (!doc.mediaWaId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const settings = await getOrCreateSettings(db, auth.userId);
    const waConfig = resolveWhatsAppRuntimeConfig(settings);
    if (!waConfig?.token) {
      return NextResponse.json({ error: "WhatsApp not configured" }, { status: 503 });
    }

    const result = await fetchCloudMediaBinary(doc.mediaWaId, waConfig);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    const contentType = doc.mediaMime?.trim() || result.mimeType;
    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
