import { ObjectId, type Collection, type Db } from "mongodb";
import { normalizeAutoReplyExcludedPhones } from "@/lib/auto-reply-exclusions";
import { pruneExpiredAutoReplyContactSuppressions } from "@/lib/auto-reply-suppression-map";

export type AiTone = "sales" | "friendly" | "professional" | "premium";

const AI_TONE_SET = new Set<string>(["sales", "friendly", "professional", "premium"]);

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
  /**
   * How long to pause AI auto-reply after you send a message from the inbox (0 = do not pause).
   * Each manual send extends the window for that contact only. End times: `autoReplySuppressedUntilByContact`.
   */
  autoReplyPauseAfterManualMinutes: number;
  /** @deprecated Legacy global pause; migrated away — use `autoReplySuppressedUntilByContact`. */
  autoReplySuppressedUntil?: Date;
  /**
   * Per-contact auto-reply pause after manual inbox send. Keys: `canonicalWaContactKey` digits.
   * Values: UTC instant until which auto-reply is suppressed for that contact.
   */
  autoReplySuppressedUntilByContact?: Record<string, Date>;
  /**
   * Canonical phone digits (`canonicalWaContactKey`); no AI auto-reply for these contacts.
   * Example: 919876543210
   */
  autoReplyExcludedPhones: string[];
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
  autoReplyPauseAfterManualMinutes: 30,
  autoReplyExcludedPhones: [],
  followUpDelayDays: 2,
  followUpMinInterestScore: 0,
  humanHandoverKeywords: ["price", "discount", "urgent", "complaint"],
  /** When true, match the lead's message language. When false, default to Hinglish (Hindi in Roman/English script). */
  languageMirrorMode: false,
  businessCardAutoSend: false,
  restrictToKnowledgeBase: false,
  autoShareCatalogue: true,
  companyInformation: "",
  productCatalogueInformation: "",
  catalogueLink: "",
  greetingTemplate:
    "Hi Sir! 👋 Thanks for connecting with us.\nBataiye kaun sa product / quantity dekh rahe ho — main help kar dunga.",
  followUpTemplate:
    "Hello Sir! 😊 Kaise hain aap? Bas touch base kar raha tha — agar product ya quantity par koi help chahiye ho to bata dijiyega.",
  aiTone: "sales",
  updatedAt: new Date(),
};

/** Safe to pass from Server Components → client (no `ObjectId` / BSON types). */
export type AutomationSettingsClient = Omit<
  AutomationSettings,
  "_id" | "userId" | "autoReplySuppressedUntil" | "autoReplySuppressedUntilByContact"
>;

export function stripSettingsForClient(doc: AutomationSettings): AutomationSettingsClient {
  const {
    _id,
    userId,
    autoReplySuppressedUntil,
    autoReplySuppressedUntilByContact,
    ...rest
  } = doc;
  void _id;
  void userId;
  void autoReplySuppressedUntil;
  void autoReplySuppressedUntilByContact;
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
      autoReplyPauseAfterManualMinutes:
        typeof doc.autoReplyPauseAfterManualMinutes === "number"
          ? doc.autoReplyPauseAfterManualMinutes
          : DEFAULT_SETTINGS.autoReplyPauseAfterManualMinutes,
      autoReplyExcludedPhones: normalizeAutoReplyExcludedPhones(doc.autoReplyExcludedPhones),
      followUpMinInterestScore:
        typeof doc.followUpMinInterestScore === "number" ? doc.followUpMinInterestScore : DEFAULT_SETTINGS.followUpMinInterestScore,
      aiTone:
        typeof doc.aiTone === "string" && AI_TONE_SET.has(doc.aiTone)
          ? (doc.aiTone as AiTone)
          : DEFAULT_SETTINGS.aiTone,
      languageMirrorMode:
        typeof doc.languageMirrorMode === "boolean"
          ? doc.languageMirrorMode
          : DEFAULT_SETTINGS.languageMirrorMode,
      autoReplySuppressedUntilByContact: pruneExpiredAutoReplyContactSuppressions(
        doc.autoReplySuppressedUntilByContact
      ),
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
