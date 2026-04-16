import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { leadsCollection, docToRow } from "@/lib/models/lead";

// PATCH /api/leads/:id  — partial update (status, assignedTo, etc.)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const db = await getDb();
    const col = leadsCollection(db);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, id, ...fields } = body;
    const result = await col.findOneAndUpdate(
      { _id: new ObjectId(params.id) },
      { $set: { ...fields, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!result) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    return NextResponse.json(docToRow(result));
  } catch (err) {
    console.error("[PATCH /api/leads/:id]", err);
    return NextResponse.json({ error: "Failed to update lead" }, { status: 500 });
  }
}

// DELETE /api/leads/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const db = await getDb();
    const col = leadsCollection(db);

    await col.deleteOne({ _id: new ObjectId(params.id) });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/leads/:id]", err);
    return NextResponse.json({ error: "Failed to delete lead" }, { status: 500 });
  }
}
