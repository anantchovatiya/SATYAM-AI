import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { leadsCollection, docToRow } from "@/lib/models/lead";
import { getOrCreateSettings } from "@/lib/models/settings";
import { syncAutoFollowupQueueFromLead, clearAutoFollowupQueueTask } from "@/lib/auto-followup-queue";
import { requireApiUser } from "@/lib/auth/session";

// PATCH /api/leads/:id  — partial update (status, assignedTo, etc.)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireApiUser(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const body = await req.json();
    const db = await getDb();
    const col = leadsCollection(db);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, id, ...fields } = body;
    const result = await col.findOneAndUpdate(
      { _id: new ObjectId(params.id), userId },
      { $set: { ...fields, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!result) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const updatedLead = await col.findOne({ _id: new ObjectId(params.id), userId });
    if (updatedLead) {
      const settings = await getOrCreateSettings(db, userId);
      await syncAutoFollowupQueueFromLead(db, userId, updatedLead, settings).catch(() => {});
    }

    return NextResponse.json(docToRow(result));
  } catch (err) {
    console.error("[PATCH /api/leads/:id]", err);
    return NextResponse.json({ error: "Failed to update lead" }, { status: 500 });
  }
}

// DELETE /api/leads/:id
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireApiUser(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const db = await getDb();
    const col = leadsCollection(db);

    await clearAutoFollowupQueueTask(db, userId, params.id);

    const del = await col.deleteOne({ _id: new ObjectId(params.id), userId });
    if (del.deletedCount === 0) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/leads/:id]", err);
    return NextResponse.json({ error: "Failed to delete lead" }, { status: 500 });
  }
}
