import { ObjectId, type Db } from "mongodb";
import { leadsCollection } from "@/lib/models/lead";
import { settingsCollection, DEFAULT_SETTINGS } from "@/lib/models/settings";
import { waMessagesCollection, webhookLogsCollection } from "@/lib/models/webhook-log";
import { templatesCollection } from "@/lib/models/template";
import { followupsCollection } from "@/lib/models/followup";

/**
 * Attach documents created before multi-tenant support to the first signed-up user.
 */
export async function migrateLegacyDataToUser(db: Db, userId: ObjectId): Promise<void> {
  const uid = userId;

  await leadsCollection(db).updateMany({ userId: { $exists: false } }, { $set: { userId: uid } });
  await waMessagesCollection(db).updateMany({ userId: { $exists: false } }, { $set: { userId: uid } });
  await webhookLogsCollection(db).updateMany({ userId: { $exists: false } }, { $set: { userId: uid } });
  await templatesCollection(db).updateMany({ userId: { $exists: false } }, { $set: { userId: uid } });
  await followupsCollection(db).updateMany({ userId: { $exists: false } }, { $set: { userId: uid } });

  const sCol = settingsCollection(db);
  const legacy = await sCol.findOne({ workspaceId: "default", userId: { $exists: false } });
  if (legacy) {
    await sCol.updateOne(
      { _id: legacy._id },
      {
        $set: { userId: uid, updatedAt: new Date() },
        $unset: { workspaceId: "" },
      }
    );
  }

  const hasUserSettings = await sCol.findOne({ userId: uid });
  if (!hasUserSettings) {
    await sCol.insertOne({
      ...DEFAULT_SETTINGS,
      userId: uid,
      updatedAt: new Date(),
    } as never);
  }
}
