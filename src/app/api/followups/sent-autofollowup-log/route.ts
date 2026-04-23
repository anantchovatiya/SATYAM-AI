import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { followupsCollection } from "@/lib/models/followup";
import { requireApiUser } from "@/lib/auth/session";

/**
 * Remove all "Auto follow-up sent" / "Auto follow-up blocked" log rows for the user.
 * No list of rows is required — deletes by task pattern.
 */
export async function DELETE(_req: NextRequest) {
  try {
    const auth = await requireApiUser(_req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const db = await getDb();
    const col = followupsCollection(db);
    const res = await col.deleteMany({
      userId,
      $or: [
        { task: { $regex: /^Auto follow-up sent/i } },
        { task: { $regex: /^Auto follow-up blocked/i } },
      ],
    });
    return NextResponse.json({ ok: true, deleted: res.deletedCount });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
