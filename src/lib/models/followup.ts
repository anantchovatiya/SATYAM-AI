import { ObjectId, type Collection, type Db } from "mongodb";

export type FollowupStatus = "Pending" | "Done" | "Skipped";

export interface FollowupDoc {
  _id?: ObjectId;
  userId?: ObjectId;
  leadId: string;
  leadName: string;
  phone: string;
  task: string;
  dueDate: Date;
  owner: string;
  status: FollowupStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FollowupRow {
  id: string;
  dueDateStr: string;
  leadId: string;
  leadName: string;
  phone: string;
  task: string;
  dueDate: string;
  owner: string;
  status: FollowupStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export function followupCalendarDiffDays(due: Date, now: Date = new Date()): number {
  return Math.round((new Date(due).getTime() - now.getTime()) / 86_400_000);
}

/** “Send” is allowed when the due **instant** is not in the future (avoids calendar-rounding hiding the button). */
export function isQueueFollowupDue(due: Date, now: Date = new Date()): boolean {
  return new Date(due).getTime() <= now.getTime();
}

export function followupsCollection(db: Db): Collection<FollowupDoc> {
  return db.collection<FollowupDoc>("followups");
}

export function followupDocToRow(doc: FollowupDoc): FollowupRow {
  const { _id, userId: _u, createdAt, updatedAt, dueDate, ...fields } = doc;
  const now = new Date();
  const due = new Date(dueDate);
  const diffDays = followupCalendarDiffDays(due, now);
  let dueDateStr: string;
  if (diffDays === 0) dueDateStr = "Today";
  else if (diffDays === 1) dueDateStr = "Tomorrow";
  else if (diffDays === -1) dueDateStr = "Yesterday";
  else if (diffDays < 0) dueDateStr = `${Math.abs(diffDays)}d overdue`;
  else dueDateStr = due.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  return {
    id: _id!.toHexString(),
    dueDateStr,
    ...fields,
    dueDate: new Date(dueDate).toISOString(),
    createdAt: new Date(createdAt).toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
  };
}
