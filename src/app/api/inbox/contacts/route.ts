import { NextResponse } from "next/server";
import { getInboxContacts } from "@/lib/inbox";

export async function GET() {
  try {
    const contacts = await getInboxContacts(400);
    return NextResponse.json({ contacts, refreshedAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
