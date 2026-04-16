import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { templatesCollection } from "@/lib/models/template";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const db  = await getDb();
    const col = templatesCollection(db);
    await col.deleteOne({ _id: new ObjectId(params.id) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
