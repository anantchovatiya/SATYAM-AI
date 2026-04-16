import { ObjectId, type Collection, type Db } from "mongodb";

export type TemplateChannel = "WhatsApp" | "Email" | "SMS";

export interface TemplateDoc {
  _id?: ObjectId;
  name: string;
  channel: TemplateChannel;
  body: string;       // message body / content
  tags: string[];     // e.g. ["greeting", "followup"]
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateRow extends Omit<TemplateDoc, "_id"> {
  id: string;
}

export function templatesCollection(db: Db): Collection<TemplateDoc> {
  return db.collection<TemplateDoc>("templates");
}

export function templateDocToRow(doc: TemplateDoc): TemplateRow {
  const { _id, ...rest } = doc;
  return { id: _id!.toHexString(), ...rest };
}
