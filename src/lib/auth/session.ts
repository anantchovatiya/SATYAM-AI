import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { sessionsCollection } from "@/lib/models/session";
import { usersCollection, type UserDoc, userToPublic, type UserPublic } from "@/lib/models/user";
import { SESSION_COOKIE_NAME, SESSION_DAYS } from "@/lib/auth/session-constants";

export { SESSION_COOKIE_NAME } from "@/lib/auth/session-constants";

export function readSessionTokenFromRequest(req: NextRequest): string | null {
  return req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function resolveSessionUser(
  db: Db,
  token: string | null | undefined
): Promise<{ userId: ObjectId; user: UserDoc } | null> {
  if (!token?.trim()) return null;
  const col = sessionsCollection(db);
  const now = new Date();
  const sess = await col.findOne({ token: token.trim(), expiresAt: { $gt: now } });
  if (!sess) return null;
  const user = await usersCollection(db).findOne({ _id: sess.userId });
  if (!user) return null;
  return { userId: user._id!, user };
}

export async function getSessionFromRequest(req: NextRequest): Promise<{ userId: ObjectId; user: UserDoc } | null> {
  const token = readSessionTokenFromRequest(req);
  const db = await getDb();
  return resolveSessionUser(db, token);
}

/** Server Components / server actions */
export async function getServerSessionUser(): Promise<{ userId: ObjectId; user: UserDoc } | null> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value ?? null;
  const db = await getDb();
  return resolveSessionUser(db, token);
}

export async function createSession(db: Db, userId: ObjectId): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await sessionsCollection(db).insertOne({
    token,
    userId,
    expiresAt,
    createdAt: now,
  });
  return token;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  };
}

export async function deleteSessionByToken(db: Db, token: string): Promise<void> {
  await sessionsCollection(db).deleteMany({ token });
}

export type ApiUser = { userId: ObjectId; user: UserDoc; public: UserPublic };

export async function requireApiUser(req: NextRequest): Promise<ApiUser | Response> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return {
    userId: session.userId,
    user: session.user,
    public: userToPublic(session.user),
  };
}
