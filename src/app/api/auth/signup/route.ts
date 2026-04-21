import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { usersCollection } from "@/lib/models/user";
import { hashPassword } from "@/lib/auth/password";
import { createSession, sessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { migrateLegacyDataToUser } from "@/lib/auth/migrate-legacy";
import { ensureTenantIndexes } from "@/lib/models/tenant-indexes";
import { ensureIndexes } from "@/lib/models/webhook-log";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string; password?: string; name?: string };
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const password = String(body.password ?? "");
    const name = String(body.name ?? "").trim() || email.split("@")[0] || "User";

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const db = await getDb();
    await ensureTenantIndexes(db).catch(() => {});
    await ensureIndexes(db).catch(() => {});

    const col = usersCollection(db);
    const existing = await col.findOne({ email });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }

    const now = new Date();
    const ins = await col.insertOne({
      email,
      passwordHash: hashPassword(password),
      name,
      createdAt: now,
      updatedAt: now,
    });
    const userId = ins.insertedId;

    const userCount = await col.countDocuments();
    if (userCount === 1) {
      await migrateLegacyDataToUser(db, userId);
    }

    const token = await createSession(db, userId);
    const res = NextResponse.json({ ok: true, user: { id: userId.toHexString(), email, name } });
    res.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
    return res;
  } catch (err) {
    console.error("[POST /api/auth/signup]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Signup failed" },
      { status: 500 }
    );
  }
}
