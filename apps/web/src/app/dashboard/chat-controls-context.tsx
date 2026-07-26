"use client";

import * as React from "react";
import {
  createEmptyStore,
  DRAFT_CHAT_KEY,
  getBuiltInSystemPrompt,
  getOrCreateChatControls,
  loadChatControlsStore,
  resolveChatKey,
  saveChatControlsStore,
  type ChatControlsStore,
  type PerChatControls,
  type PromptTemplate,
} from "@/lib/chat/chat-controls-storage";
import type { ChatModelId } from "@/lib/chat/models";

export type SettingsTab = "system" | "templates";

type ChatControlsContextValue = {
  ready: boolean;
  chatKey: string;
  /** Effective org system prompt (built-in when org has none). */
  systemPrompt: string;
  /** True when the org has a custom prompt stored. */
  isCustomSystemPrompt: boolean;
  systemPromptSaving: boolean;
  model: ChatModelId;
  jsonMode: boolean;
  templates: PromptTemplate[];
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  setActiveConversation: (conversationId: string | null) => void;
  /** Reset draft-chat overrides so a new chat inherits defaults. */
  prepareNewChat: () => void;
  /** Persist org-wide system prompt (owner only; enforced by API). */
  saveSystemPrompt: (prompt: string) => Promise<void>;
  /** Clear org system prompt so chat uses the built-in RAG instructions. */
  resetSystemPrompt: () => Promise<void>;
  setModel: (model: ChatModelId) => void;
  setJsonMode: (on: boolean) => void;
  addTemplate: (input: { name: string; body: string }) => PromptTemplate;
  updateTemplate: (
    id: string,
    patch: Partial<Pick<PromptTemplate, "name" | "body">>,
  ) => void;
  deleteTemplate: (id: string) => void;
  openSettings: (tab?: SettingsTab) => void;
  setSettingsOpen: (open: boolean) => void;
  setSettingsTab: (tab: SettingsTab) => void;
};

const ChatControlsContext = React.createContext<
  ChatControlsContextValue | undefined
>(undefined);

function upsertChat(
  store: ChatControlsStore,
  chatKey: string,
  patch: Partial<PerChatControls>,
): ChatControlsStore {
  const current = getOrCreateChatControls(store, chatKey);
  return {
    ...store,
    chats: {
      ...store.chats,
      [chatKey]: { ...current, ...patch },
    },
  };
}

function normalizeOrgSystemPrompt(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function ChatControlsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [store, setStore] = React.useState<ChatControlsStore>(createEmptyStore);
  const [ready, setReady] = React.useState(false);
  const [orgSystemPrompt, setOrgSystemPrompt] = React.useState<string | null>(
    null,
  );
  const [systemPromptSaving, setSystemPromptSaving] = React.useState(false);
  const [conversationId, setConversationId] = React.useState<string | null>(
    null,
  );
  const conversationIdRef = React.useRef<string | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState<SettingsTab>("system");

  React.useEffect(() => {
    setStore(loadChatControlsStore());
    setReady(true);
  }, []);

  React.useEffect(() => {
    if (!ready) return;
    saveChatControlsStore(store);
  }, [ready, store]);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/organization", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const payload = (await res.json()) as {
          systemPrompt?: unknown;
        };
        if (cancelled) return;
        setOrgSystemPrompt(normalizeOrgSystemPrompt(payload.systemPrompt));
      } catch {
        // Keep built-in prompt in UI if org settings fail to load.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const chatKey = resolveChatKey(conversationId);
  const chat = getOrCreateChatControls(store, chatKey);
  const systemPrompt = orgSystemPrompt ?? getBuiltInSystemPrompt();
  const isCustomSystemPrompt = orgSystemPrompt != null;

  const setActiveConversation = React.useCallback((nextId: string | null) => {
    const prevKey = resolveChatKey(conversationIdRef.current);
    const nextKey = resolveChatKey(nextId);

    if (prevKey === DRAFT_CHAT_KEY && nextKey !== DRAFT_CHAT_KEY) {
      setStore((prev) => {
        const draft = prev.chats[DRAFT_CHAT_KEY];
        if (!draft) return prev;
        const rest = { ...prev.chats };
        delete rest[DRAFT_CHAT_KEY];
        return {
          ...prev,
          chats: {
            ...rest,
            // Prefer existing chat settings if already saved for this id.
            [nextKey]: prev.chats[nextKey] ?? draft,
          },
        };
      });
    }

    conversationIdRef.current = nextId;
    setConversationId(nextId);
  }, []);

  const prepareNewChat = React.useCallback(() => {
    setStore((prev) => ({
      ...prev,
      chats: {
        ...prev.chats,
        [DRAFT_CHAT_KEY]: {
          systemPrompt: null,
          model: prev.lastUsedModel,
          jsonMode: false,
        },
      },
    }));
  }, []);

  const saveSystemPrompt = React.useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      throw new Error("System prompt cannot be empty");
    }
    setSystemPromptSaving(true);
    try {
      const res = await fetch("/api/organization", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt: trimmed }),
      });
      const payload = (await res.json()) as
        | { systemPrompt: string | null }
        | { error: string };
      if (!res.ok) {
        throw new Error(
          "error" in payload ? payload.error : "Failed to save system prompt",
        );
      }
      if (!("systemPrompt" in payload)) {
        throw new Error("Invalid response from server");
      }
      setOrgSystemPrompt(normalizeOrgSystemPrompt(payload.systemPrompt));
    } finally {
      setSystemPromptSaving(false);
    }
  }, []);

  const resetSystemPrompt = React.useCallback(async () => {
    setSystemPromptSaving(true);
    try {
      const res = await fetch("/api/organization", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt: null }),
      });
      const payload = (await res.json()) as
        | { systemPrompt: string | null }
        | { error: string };
      if (!res.ok) {
        throw new Error(
          "error" in payload ? payload.error : "Failed to reset system prompt",
        );
      }
      if (!("systemPrompt" in payload)) {
        throw new Error("Invalid response from server");
      }
      setOrgSystemPrompt(normalizeOrgSystemPrompt(payload.systemPrompt));
    } finally {
      setSystemPromptSaving(false);
    }
  }, []);

  const setModel = React.useCallback(
    (model: ChatModelId) => {
      setStore((prev) => ({
        ...upsertChat(prev, chatKey, { model }),
        lastUsedModel: model,
      }));
    },
    [chatKey],
  );

  const setJsonMode = React.useCallback(
    (on: boolean) => {
      setStore((prev) => upsertChat(prev, chatKey, { jsonMode: on }));
    },
    [chatKey],
  );

  const addTemplate = React.useCallback(
    (input: { name: string; body: string }) => {
      const template: PromptTemplate = {
        id: crypto?.randomUUID?.() ?? `tpl-${Date.now()}`,
        name: input.name.trim() || "Untitled template",
        body: input.body,
        updatedAt: new Date().toISOString(),
      };
      setStore((prev) => ({
        ...prev,
        templates: [template, ...prev.templates],
      }));
      return template;
    },
    [],
  );

  const updateTemplate = React.useCallback(
    (
      id: string,
      patch: Partial<Pick<PromptTemplate, "name" | "body">>,
    ) => {
      setStore((prev) => ({
        ...prev,
        templates: prev.templates.map((t) =>
          t.id === id
            ? {
                ...t,
                ...patch,
                name:
                  patch.name != null
                    ? patch.name.trim() || t.name
                    : t.name,
                updatedAt: new Date().toISOString(),
              }
            : t,
        ),
      }));
    },
    [],
  );

  const deleteTemplate = React.useCallback((id: string) => {
    setStore((prev) => ({
      ...prev,
      templates: prev.templates.filter((t) => t.id !== id),
    }));
  }, []);

  const openSettings = React.useCallback((tab: SettingsTab = "system") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const value = React.useMemo<ChatControlsContextValue>(
    () => ({
      ready,
      chatKey,
      systemPrompt,
      isCustomSystemPrompt,
      systemPromptSaving,
      model: chat.model,
      jsonMode: chat.jsonMode,
      templates: store.templates,
      settingsOpen,
      settingsTab,
      setActiveConversation,
      prepareNewChat,
      saveSystemPrompt,
      resetSystemPrompt,
      setModel,
      setJsonMode,
      addTemplate,
      updateTemplate,
      deleteTemplate,
      openSettings,
      setSettingsOpen,
      setSettingsTab,
    }),
    [
      ready,
      chatKey,
      systemPrompt,
      isCustomSystemPrompt,
      systemPromptSaving,
      store.templates,
      chat.model,
      chat.jsonMode,
      settingsOpen,
      settingsTab,
      setActiveConversation,
      prepareNewChat,
      saveSystemPrompt,
      resetSystemPrompt,
      setModel,
      setJsonMode,
      addTemplate,
      updateTemplate,
      deleteTemplate,
      openSettings,
    ],
  );

  return (
    <ChatControlsContext.Provider value={value}>
      {children}
    </ChatControlsContext.Provider>
  );
}

export function useChatControls() {
  const ctx = React.useContext(ChatControlsContext);
  if (!ctx) {
    throw new Error("useChatControls must be used within ChatControlsProvider");
  }
  return ctx;
}
