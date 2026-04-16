import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { templatesCollection, templateDocToRow, type TemplateChannel } from "@/lib/models/template";

export async function GET() {
  try {
    const db  = await getDb();
    const col = templatesCollection(db);
    const docs = await col.find({}).sort({ updatedAt: -1 }).toArray();
    return NextResponse.json({ templates: docs.map(templateDocToRow) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { name?: string; channel?: string; body?: string; tags?: string[] };
    const { name, channel, body: tmplBody, tags } = body;
    if (!name || !channel || !tmplBody) {
      return NextResponse.json({ error: "name, channel, body are required" }, { status: 400 });
    }
    const db  = await getDb();
    const col = templatesCollection(db);
    const now = new Date();
    const result = await col.insertOne({
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
