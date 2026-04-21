import { NextRequest, NextResponse } from "next/server";
import { type Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { leadsCollection, docToRow, type LeadDoc, type LeadStatus } from "@/lib/models/lead";
import { requireApiUser } from "@/lib/auth/session";

// GET /api/leads?status=Hot
export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiUser(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const db = await getDb();
    const col = leadsCollection(db);

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") as LeadStatus | null;

    const filter: Filter<LeadDoc> = { userId };
    if (status && status !== ("All" as string)) {
      filter.status = status;
    }
    const docs = await col.find(filter).sort({ createdAt: -1 }).toArray();

    return NextResponse.json(docs.map(docToRow));
  } catch (err) {
    console.error("[GET /api/leads]", err);
    return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 });
  }
}

// POST /api/leads  — create a new lead
export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiUser(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const body = await req.json();
    const db = await getDb();
    const col = leadsCollection(db);

    const now = new Date();
    const doc: LeadDoc = {
      userId,
      name: body.name,
      phone: body.phone ?? "",
      source: body.source ?? "Manual",
      status: body.status ?? "New",
      lastMessage: body.lastMessage ?? "",
      interestScore: typeof body.interestScore === "number" ? body.interestScore : 10,
      assignedTo: body.assignedTo ?? "Unassigned",
      lastFollowup: body.lastFollowup ?? "Just now",
      createdAt: now,
      updatedAt: now,
    };

    const result = await col.insertOne(doc);
    return NextResponse.json({ id: result.insertedId.toHexString() }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/leads]", err);
    return NextResponse.json({ error: "Failed to create lead" }, { status: 500 });
  }
}
