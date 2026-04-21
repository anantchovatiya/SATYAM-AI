import { ObjectId, type Collection, type Db } from "mongodb";

export type FollowupStatus = "Pending" | "Done" | "Skipped";

export interface FollowupDoc {
  _id?: ObjectId;
  userId?: ObjectId;
  leadId: string;      // references leads._id hex
  leadName: string;
  phone: string;
  task: string;        // short description
  dueDate: Date;
  owner: string;       // salesperson name
  status: FollowupStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FollowupRow extends Omit<FollowupDoc, "_id"> {
  id: string;
  dueDateStr: string;  // human-readable
}

export function followupsCollection(db: Db): Collection<FollowupDoc> {
  return db.collection<FollowupDoc>("followups");
}

export function followupDocToRow(doc: FollowupDoc): FollowupRow {
  const { _id, ...rest } = doc;
  const now = new Date();
  const due = new Date(doc.dueDate);
  const diffDays = Math.round((due.getTime() - now.getTime()) / 86_400_000);
  let dueDateStr: string;
  if (diffDays === 0) dueDateStr = "Today";
  else if (diffDays === 1) dueDateStr = "Tomorrow";
  else if (diffDays === -1) dueDateStr = "Yesterday";
  else if (diffDays < 0) dueDateStr = `${Math.abs(diffDays)}d overdue`;
  else dueDateStr = due.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  return { id: _id!.toHexString(), dueDateStr, ...rest };
}
