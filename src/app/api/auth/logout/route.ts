import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { deleteSessionByToken, readSessionTokenFromRequest, SESSION_COOKIE_NAME } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const token = readSessionTokenFromRequest(req);
  if (token) {
    const db = await getDb();
    await deleteSessionByToken(db, token);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0, httpOnly: true });
  return res;
}
