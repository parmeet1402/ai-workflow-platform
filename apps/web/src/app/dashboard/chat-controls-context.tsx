"use client";

import * as React from "react";
import {
  createEmptyStore,
  DRAFT_CHAT_KEY,
  effectiveSystemPrompt,
  getBuiltInSystemPrompt,
  getOrCreateChatControls,
  isCustomSystemPrompt,
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
  defaultSystemPrompt: string;
  systemPrompt: string;
  isCustomSystemPrompt: boolean;
  model: ChatModelId;
  jsonMode: boolean;
  templates: PromptTemplate[];
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  setActiveConversation: (conversationId: string | null) => void;
  /** Reset draft-chat overrides so a new chat inherits defaults. */
  prepareNewChat: () => void;
  setSystemPromptForChat: (prompt: string) => void;
  resetSystemPromptForChat: () => void;
  setDefaultSystemPrompt: (prompt: string) => void;
  resetDefaultSystemPrompt: () => void;
  applySystemPromptAsDefault: (prompt?: string) => void;
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

export function ChatControlsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [store, setStore] = React.useState<ChatControlsStore>(createEmptyStore);
  const [ready, setReady] = React.useState(false);
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
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const chatKey = resolveChatKey(conversationId);
  const chat = getOrCreateChatControls(store, chatKey);

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

  const setSystemPromptForChat = React.useCallback(
    (prompt: string) => {
      setStore((prev) =>
        upsertChat(prev, chatKey, { systemPrompt: prompt }),
      );
    },
    [chatKey],
  );

  const resetSystemPromptForChat = React.useCallback(() => {
    setStore((prev) => upsertChat(prev, chatKey, { systemPrompt: null }));
  }, [chatKey]);

  const setDefaultSystemPrompt = React.useCallback((prompt: string) => {
    setStore((prev) => ({
      ...prev,
      defaultSystemPrompt: prompt,
    }));
  }, []);

  const resetDefaultSystemPrompt = React.useCallback(() => {
    setStore((prev) => ({
      ...prev,
      defaultSystemPrompt: getBuiltInSystemPrompt(),
    }));
  }, []);

  const applySystemPromptAsDefault = React.useCallback(
    (prompt?: string) => {
      setStore((prev) => {
        const currentChat = getOrCreateChatControls(prev, chatKey);
        const next = prompt ?? effectiveSystemPrompt(prev, currentChat);
        return upsertChat(
          { ...prev, defaultSystemPrompt: next },
          chatKey,
          { systemPrompt: null },
        );
      });
    },
    [chatKey],
  );

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
      defaultSystemPrompt: store.defaultSystemPrompt,
      systemPrompt: effectiveSystemPrompt(store, chat),
      isCustomSystemPrompt: isCustomSystemPrompt(store, chat),
      model: chat.model,
      jsonMode: chat.jsonMode,
      templates: store.templates,
      settingsOpen,
      settingsTab,
      setActiveConversation,
      prepareNewChat,
      setSystemPromptForChat,
      resetSystemPromptForChat,
      setDefaultSystemPrompt,
      resetDefaultSystemPrompt,
      applySystemPromptAsDefault,
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
      store,
      chat,
      settingsOpen,
      settingsTab,
      setActiveConversation,
      prepareNewChat,
      setSystemPromptForChat,
      resetSystemPromptForChat,
      setDefaultSystemPrompt,
      resetDefaultSystemPrompt,
      applySystemPromptAsDefault,
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
