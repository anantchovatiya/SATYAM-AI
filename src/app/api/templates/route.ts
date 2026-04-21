import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { templatesCollection, templateDocToRow, type TemplateChannel } from "@/lib/models/template";
import { requireApiUser } from "@/lib/auth/session";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiUser(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const db = await getDb();
    const col = templatesCollection(db);
    const docs = await col.find({ userId }).sort({ updatedAt: -1 }).toArray();
    return NextResponse.json({ templates: docs.map(templateDocToRow) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiUser(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const body = await req.json() as { name?: string; channel?: string; body?: string; tags?: string[] };
    const { name, channel, body: tmplBody, tags } = body;
    if (!name || !channel || !tmplBody) {
      return NextResponse.json({ error: "name, channel, body are required" }, { status: 400 });
    }
    const db = await getDb();
    const col = templatesCollection(db);
    const now = new Date();
    const result = await col.insertOne({
      userId,
      name,
      channel: channel as TemplateChannel,
      body: tmplBody,
      tags: tags ?? [],
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ id: result.insertedId.toHexString() }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
