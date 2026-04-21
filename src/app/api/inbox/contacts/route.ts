import { NextRequest, NextResponse } from "next/server";
import { getInboxContacts } from "@/lib/inbox";
import { requireApiUser } from "@/lib/auth/session";

/** Per-user inbox data must never be cached at the edge/CDN (stale poll would overwrite fresh SSR). */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiUser(req);
    if (auth instanceof Response) return auth;
    const contacts = await getInboxContacts(auth.userId, 400);
    return NextResponse.json(
      { contacts, refreshedAt: new Date().toISOString() },
      { headers: NO_STORE }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: NO_STORE }
    );
  }
}
