import type { Db } from "mongodb";
import { leadsCollection } from "@/lib/models/lead";
import { settingsCollection } from "@/lib/models/settings";
import { templatesCollection } from "@/lib/models/template";
import { followupsCollection } from "@/lib/models/followup";
import { usersCollection } from "@/lib/models/user";
import { sessionsCollection } from "@/lib/models/session";

export async function ensureTenantIndexes(db: Db): Promise<void> {
  await usersCollection(db).createIndex({ email: 1 }, { unique: true });
  await sessionsCollection(db).createIndex({ token: 1 }, { unique: true });
  await sessionsCollection(db).createIndex({ expiresAt: 1 });

  await leadsCollection(db).createIndex({ userId: 1, updatedAt: -1 });
  await leadsCollection(db).createIndex({ userId: 1, phone: 1 });

  await settingsCollection(db).createIndex({ userId: 1 }, { unique: true, sparse: true });
  await settingsCollection(db).createIndex({ "whatsapp.phoneNumberId": 1 }, { sparse: true });
  await settingsCollection(db).createIndex({ "whatsapp.verifyToken": 1 }, { sparse: true });

  await templatesCollection(db).createIndex({ userId: 1, updatedAt: -1 });
  await followupsCollection(db).createIndex({ userId: 1, dueDate: 1 });
}
