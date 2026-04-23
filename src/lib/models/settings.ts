import { ObjectId, type Collection, type Db } from "mongodb";

export type AiTone = "friendly" | "professional" | "premium";

export interface WhatsAppConnectionSettings {
  token: string;
  verifyToken: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  connectedAt: Date;
  lastSyncAt?: Date;
}

export interface AutomationSettings {
  _id?: ObjectId;
  /** Tenant owner — every row must have this after migration. */
  userId?: ObjectId;
  /** @deprecated Legacy single-tenant key; use userId. */
  workspaceId?: string;
  whatsappEnvDisabled?: boolean;
  autoReply: boolean;
  followUpDelayDays: number;
  /** Only run auto follow-up when `lead.interestScore` is at least this (0 = no minimum). */
  followUpMinInterestScore: number;
  humanHandoverKeywords: string[];
  languageMirrorMode: boolean;
  businessCardAutoSend: boolean;
  restrictToKnowledgeBase: boolean;
  autoShareCatalogue: boolean;
  companyInformation: string;
  productCatalogueInformation: string;
  catalogueLink: string;
  greetingTemplate: string;
  followUpTemplate: string;
  aiTone: AiTone;
  whatsapp?: WhatsAppConnectionSettings;
  updatedAt: Date;
}

export const DEFAULT_SETTINGS: Omit<AutomationSettings, "_id" | "userId"> = {
  autoReply: true,
  followUpDelayDays: 2,
  followUpMinInterestScore: 0,
  humanHandoverKeywords: ["price", "discount", "urgent", "complaint"],
  languageMirrorMode: true,
  businessCardAutoSend: false,
  restrictToKnowledgeBase: false,
  autoShareCatalogue: true,
  companyInformation: "",
  productCatalogueInformation: "",
  catalogueLink: "",
  greetingTemplate:
    "Hi {{name}}! 👋 Thanks for reaching out to SATYAM AI.\nHow can we help you today?",
  followUpTemplate:
    "Hey {{name}}, just checking in! 😊\nHave you had a chance to review our proposal?\nWe're here if you have any questions.",
  aiTone: "friendly",
  updatedAt: new Date(),
};

/** Safe to pass from Server Components → client (no `ObjectId` / BSON types). */
export type AutomationSettingsClient = Omit<AutomationSettings, "_id" | "userId">;

export function stripSettingsForClient(doc: AutomationSettings): AutomationSettingsClient {
  const { _id, userId, ...rest } = doc;
  void _id;
  void userId;
  return rest;
}

export function settingsCollection(db: Db): Collection<AutomationSettings> {
  return db.collection<AutomationSettings>("settings");
}

export async function getOrCreateSettings(db: Db, userId: ObjectId): Promise<AutomationSettings> {
  const col = settingsCollection(db);
  const doc = await col.findOne({ userId });
  if (doc) {
    return {
      ...DEFAULT_SETTINGS,
      ...doc,
      userId,
      followUpMinInterestScore:
        typeof doc.followUpMinInterestScore === "number" ? doc.followUpMinInterestScore : DEFAULT_SETTINGS.followUpMinInterestScore,
    };
  }

  await col.insertOne({
    ...DEFAULT_SETTINGS,
    userId,
    updatedAt: new Date(),
  });

  return { ...DEFAULT_SETTINGS, userId, updatedAt: new Date() };
}

export async function findSettingsByPhoneNumberId(
  db: Db,
  phoneNumberId: string
): Promise<AutomationSettings | null> {
  const pid = phoneNumberId.trim();
  if (!pid) return null;
  return settingsCollection(db).findOne({ "whatsapp.phoneNumberId": pid });
}

export async function findSettingsByVerifyToken(db: Db, token: string): Promise<AutomationSettings | null> {
  if (!token) return null;
  return settingsCollection(db).findOne({ "whatsapp.verifyToken": token });
}
