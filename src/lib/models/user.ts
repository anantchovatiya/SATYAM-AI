import { ObjectId, type Collection, type Db } from "mongodb";

export interface UserDoc {
  _id?: ObjectId;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPublic {
  id: string;
  email: string;
  name: string;
}

export function usersCollection(db: Db): Collection<UserDoc> {
  return db.collection<UserDoc>("users");
}

export function userToPublic(doc: UserDoc): UserPublic {
  return {
    id: doc._id!.toHexString(),
    email: doc.email,
    name: doc.name,
  };
}
