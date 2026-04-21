import { ObjectId, type Collection, type Db } from "mongodb";

export interface SessionDoc {
  _id?: ObjectId;
  token: string;
  userId: ObjectId;
  expiresAt: Date;
  createdAt: Date;
}

export function sessionsCollection(db: Db): Collection<SessionDoc> {
  return db.collection<SessionDoc>("sessions");
}
