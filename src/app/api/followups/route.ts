import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { followupsCollection, followupDocToRow, type FollowupStatus } from "@/lib/models/followup";
import { ObjectId } from "mongodb";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") as FollowupStatus | null;
    const db  = await getDb();
    const col = followupsCollection(db);
    const filter = status ? { status } : {};
    const docs = await col.find(filter).sort({ dueDate: 1 }).toArray();
    return NextResponse.json({ followups: docs.map(followupDocToRow) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      leadId?: string; leadName?: string; phone?: string;
      task?: string; dueDate?: string; owner?: string; notes?: string;
    };
    const { leadId, leadName, phone, task, dueDate, owner, notes } = body;
    if (!leadName || !task || !dueDate || !owner) {
      return NextResponse.json({ error: "leadName, task, dueDate, owner required" }, { status: 400 });
    }
    const db  = await getDb();
    const col = followupsCollection(db);
    const now = new Date();
    const result = await col.insertOne({
      leadId: leadId ?? "",
      leadName,
      phone: phone ?? "",
      task,
      dueDate: new Date(dueDate),
      owner,
      status: "Pending",
      notes: notes ?? "",
      createdAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ id: result.insertedId.toHexString() }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { id?: string; status?: FollowupStatus };
    const { id, status } = body;
    if (!id || !status) return NextResponse.json({ error: "id and status required" }, { status: 400 });
    const db  = await getDb();
    const col = followupsCollection(db);
    await col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } }
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
