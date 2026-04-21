import { ObjectId, type Collection, type Db } from "mongodb";

export type LeadStatus = "New" | "Hot" | "Silent" | "Closed";

export interface LeadDoc {
  _id?: ObjectId;
  userId?: ObjectId;
  name: string;
  phone: string;
  source: string;
  status: LeadStatus;
  conversationStatus?: ConversationStatus;
  lastMessage: string;
  interestScore: number;
  assignedTo: string;
  lastFollowup: string;
  lastInboundAt?: Date;
  lastOutboundAt?: Date;
  preferredLanguage?: string;
  needsHuman?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadRow extends Omit<LeadDoc, "_id"> {
  id: string;
}

export type ConversationStatus =
  | "new_inquiry"
  | "awaiting_team_reply"
  | "awaiting_customer_reply"
  | "stalled"
  | "escalated";

export function leadsCollection(db: Db): Collection<LeadDoc> {
  return db.collection<LeadDoc>("leads");
}

export function docToRow(doc: LeadDoc): LeadRow {
  const { _id, userId, ...rest } = doc;
  void userId;
  return { id: _id!.toHexString(), ...rest };
}
