// Types only — all chat data is loaded from MongoDB at runtime.

export type MessageStatus    = "sent" | "delivered" | "read";
export type MessageDirection = "in" | "out";

export type MessageChannel = "api" | "qr";

export interface ChatMessage {
  id:         string;
  text:       string;
  direction:  MessageDirection;
  timestamp:  string;   // "HH:MM AM/PM"
  date:       string;   // "Today" | "Yesterday" | "Apr 14"
  status?:    MessageStatus;
  channel?:   MessageChannel;  // "api" = Cloud/Meta, "qr" = QR/Baileys
  /** Cloud API: session-authenticated proxy URL to load media binary */
  mediaKind?: "image" | "video" | "document" | "sticker" | "audio";
  mediaSrc?:  string;
}

export interface ChatNote {
  id:        string;
  text:      string;
  author:    string;
  timestamp: string;
}

export interface Contact {
  id:         string;
  name:       string;
  phone:      string;
  source:     string;
  status:     "New" | "Hot" | "Silent" | "Closed";
  conversationStatus?: "new_inquiry" | "awaiting_team_reply" | "awaiting_customer_reply" | "stalled" | "escalated";
  needsHuman?: boolean;
  pendingHumanReply?: boolean;
  assignedTo: string;
  online:     boolean;
  unread:     number;
  messages:   ChatMessage[];
  notes:      ChatNote[];
}
