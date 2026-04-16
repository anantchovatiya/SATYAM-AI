import { type Collection, type Db } from "mongodb";

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
  _id?: unknown;
  workspaceId: string;       // single workspace for now → "default"
  whatsappEnvDisabled?: boolean;
  autoReply: boolean;
  followUpDelayDays: number;
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

export const DEFAULT_SETTINGS: Omit<AutomationSettings, "_id"> = {
  workspaceId: "default",
  autoReply: true,
  followUpDelayDays: 2,
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

export function settingsCollection(db: Db): Collection<AutomationSettings> {
  return db.collection<AutomationSettings>("settings");
}

export async function getOrCreateSettings(db: Db): Promise<AutomationSettings> {
  const col = settingsCollection(db);
  const doc = await col.findOne({ workspaceId: "default" });
  if (doc) {
    return {
      ...DEFAULT_SETTINGS,
      ...doc,
      workspaceId: "default",
    };
  }

  await col.insertOne({ ...DEFAULT_SETTINGS, updatedAt: new Date() });
  return { ...DEFAULT_SETTINGS };
}
