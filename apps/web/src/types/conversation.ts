import type { ChatCitation, ChatUsage } from "@/lib/chat/types";

export type ConversationListItem = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Preview of the latest message content (may be empty). */
  lastMessage: string | null;
};

export type PersistedChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: ChatCitation[];
  usage: ChatUsage | null;
  createdAt: string;
};

export type ConversationDetail = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: PersistedChatMessage[];
};
