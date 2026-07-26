import { RAG_SYSTEM_PROMPT } from "@/lib/chat/prompt";
import {
  DEFAULT_CHAT_MODEL,
  isChatModelId,
  type ChatModelId,
} from "@/lib/chat/models";

export const DRAFT_CHAT_KEY = "__draft__";
export const CHAT_CONTROLS_STORAGE_KEY = "ai-workflow-chat-controls";

export type PromptTemplate = {
  id: string;
  name: string;
  body: string;
  updatedAt: string;
};

export type PerChatControls = {
  /** `null` = inherit user default system prompt */
  systemPrompt: string | null;
  model: ChatModelId;
  jsonMode: boolean;
};

/** Client-only chat prefs. Templates live on the server (org-scoped). */
export type ChatControlsStore = {
  version: 1;
  defaultSystemPrompt: string;
  lastUsedModel: ChatModelId;
  chats: Record<string, PerChatControls>;
};

export function getBuiltInSystemPrompt() {
  return RAG_SYSTEM_PROMPT;
}

export function createDefaultChatControls(): PerChatControls {
  return {
    systemPrompt: null,
    model: DEFAULT_CHAT_MODEL,
    jsonMode: false,
  };
}

export function createEmptyStore(): ChatControlsStore {
  return {
    version: 1,
    defaultSystemPrompt: getBuiltInSystemPrompt(),
    lastUsedModel: DEFAULT_CHAT_MODEL,
    chats: {},
  };
}

function normalizeTemplate(raw: unknown): PromptTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<PromptTemplate>;
  if (
    typeof t.id !== "string" ||
    typeof t.name !== "string" ||
    typeof t.body !== "string"
  ) {
    return null;
  }
  return {
    id: t.id,
    name: t.name,
    body: t.body,
    updatedAt:
      typeof t.updatedAt === "string" ? t.updatedAt : new Date().toISOString(),
  };
}

function normalizePerChat(
  raw: unknown,
  fallbackModel: ChatModelId,
): PerChatControls {
  if (!raw || typeof raw !== "object") {
    return {
      systemPrompt: null,
      model: fallbackModel,
      jsonMode: false,
    };
  }
  const c = raw as Partial<PerChatControls>;
  return {
    systemPrompt:
      typeof c.systemPrompt === "string"
        ? c.systemPrompt
        : c.systemPrompt === null
          ? null
          : null,
    model:
      typeof c.model === "string" && isChatModelId(c.model)
        ? c.model
        : fallbackModel,
    jsonMode: c.jsonMode === true,
  };
}

export function parseChatControlsStore(raw: unknown): ChatControlsStore {
  const empty = createEmptyStore();
  if (!raw || typeof raw !== "object") return empty;

  const data = raw as Partial<ChatControlsStore> & {
    templates?: unknown;
  };
  const lastUsedModel =
    typeof data.lastUsedModel === "string" && isChatModelId(data.lastUsedModel)
      ? data.lastUsedModel
      : empty.lastUsedModel;

  const chats: Record<string, PerChatControls> = {};
  if (data.chats && typeof data.chats === "object") {
    for (const [key, value] of Object.entries(data.chats)) {
      chats[key] = normalizePerChat(value, lastUsedModel);
    }
  }

  return {
    version: 1,
    defaultSystemPrompt:
      typeof data.defaultSystemPrompt === "string" &&
      data.defaultSystemPrompt.trim().length > 0
        ? data.defaultSystemPrompt
        : empty.defaultSystemPrompt,
    lastUsedModel,
    chats,
  };
}

/** Read legacy localStorage templates (pre server sync) for one-time migrate. */
export function extractLegacyTemplates(raw: unknown): PromptTemplate[] {
  if (!raw || typeof raw !== "object") return [];
  const data = raw as { templates?: unknown };
  if (!Array.isArray(data.templates)) return [];
  return data.templates
    .map(normalizeTemplate)
    .filter((t): t is PromptTemplate => t != null);
}

export function loadChatControlsStore(): ChatControlsStore {
  if (typeof window === "undefined") return createEmptyStore();
  try {
    const raw = window.localStorage.getItem(CHAT_CONTROLS_STORAGE_KEY);
    if (!raw) return createEmptyStore();
    return parseChatControlsStore(JSON.parse(raw) as unknown);
  } catch {
    return createEmptyStore();
  }
}

/** Load raw JSON for legacy template migration (before strip on save). */
export function loadRawChatControlsJson(): unknown | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CHAT_CONTROLS_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function saveChatControlsStore(store: ChatControlsStore) {
  if (typeof window === "undefined") return;
  try {
    // Never persist templates — they are org-scoped on the server.
    window.localStorage.setItem(
      CHAT_CONTROLS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        defaultSystemPrompt: store.defaultSystemPrompt,
        lastUsedModel: store.lastUsedModel,
        chats: store.chats,
      } satisfies ChatControlsStore),
    );
  } catch {
    // Ignore quota / private-mode failures; UI still works in-memory.
  }
}

export function resolveChatKey(conversationId: string | null) {
  return conversationId ?? DRAFT_CHAT_KEY;
}

export function getOrCreateChatControls(
  store: ChatControlsStore,
  chatKey: string,
): PerChatControls {
  const existing = store.chats[chatKey];
  if (existing) return existing;
  return {
    systemPrompt: null,
    model: store.lastUsedModel,
    jsonMode: false,
  };
}

export function effectiveSystemPrompt(
  store: ChatControlsStore,
  chat: PerChatControls,
) {
  return chat.systemPrompt ?? store.defaultSystemPrompt;
}

export function isCustomSystemPrompt(
  store: ChatControlsStore,
  chat: PerChatControls,
) {
  return effectiveSystemPrompt(store, chat) !== store.defaultSystemPrompt;
}
