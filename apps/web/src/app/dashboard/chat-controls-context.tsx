"use client";

import * as React from "react";
import {
  createEmptyStore,
  DRAFT_CHAT_KEY,
  extractLegacyTemplates,
  getBuiltInSystemPrompt,
  getOrCreateChatControls,
  loadChatControlsStore,
  loadRawChatControlsJson,
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
  templatesLoading: boolean;
  templatesError: string | null;
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
  addTemplate: (input: {
    name: string;
    body: string;
  }) => Promise<PromptTemplate>;
  updateTemplate: (
    id: string,
    patch: Partial<Pick<PromptTemplate, "name" | "body">>,
  ) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
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

function parseTemplatePayload(raw: unknown): PromptTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<PromptTemplate>;
  if (
    typeof t.id !== "string" ||
    typeof t.name !== "string" ||
    typeof t.body !== "string" ||
    typeof t.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    id: t.id,
    name: t.name,
    body: t.body,
    updatedAt: t.updatedAt,
  };
}

async function postTemplate(input: {
  name: string;
  body: string;
}): Promise<PromptTemplate> {
  const res = await fetch("/api/prompt-templates", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await res.json()) as
    | { template: unknown }
    | { error: string };
  if (!res.ok) {
    throw new Error(
      "error" in payload ? payload.error : "Failed to create template",
    );
  }
  if (!("template" in payload)) {
    throw new Error("Invalid response from server");
  }
  const template = parseTemplatePayload(payload.template);
  if (!template) {
    throw new Error("Invalid template in response");
  }
  return template;
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
  const [templates, setTemplates] = React.useState<PromptTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = React.useState(true);
  const [templatesError, setTemplatesError] = React.useState<string | null>(
    null,
  );
  const [conversationId, setConversationId] = React.useState<string | null>(
    null,
  );
  const conversationIdRef = React.useRef<string | null>(null);
  /** Captured before first save strips legacy `templates[]` from localStorage. */
  const legacyTemplatesRef = React.useRef<PromptTemplate[] | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState<SettingsTab>("system");

  React.useEffect(() => {
    legacyTemplatesRef.current = extractLegacyTemplates(
      loadRawChatControlsJson(),
    );
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
    let cancelled = false;

    void (async () => {
      setTemplatesLoading(true);
      setTemplatesError(null);
      try {
        const res = await fetch("/api/prompt-templates", {
          credentials: "include",
          cache: "no-store",
        });
        const payload = (await res.json()) as
          | { templates: unknown }
          | { error: string };
        if (!res.ok) {
          throw new Error(
            "error" in payload
              ? payload.error
              : "Failed to load prompt templates",
          );
        }
        if (!("templates" in payload) || !Array.isArray(payload.templates)) {
          throw new Error("Invalid response from server");
        }

        let list = payload.templates
          .map(parseTemplatePayload)
          .filter((t): t is PromptTemplate => t != null);

        // One-time migrate: push legacy localStorage templates when server empty.
        const legacy = legacyTemplatesRef.current ?? [];
        legacyTemplatesRef.current = [];
        if (list.length === 0 && legacy.length > 0) {
          const migrated: PromptTemplate[] = [];
          for (const item of legacy) {
            try {
              migrated.push(
                await postTemplate({ name: item.name, body: item.body }),
              );
            } catch {
              // Skip individual failures; continue migrating the rest.
            }
          }
          list = migrated;
        }

        if (cancelled) return;
        setTemplates(list);
      } catch (error) {
        if (cancelled) return;
        setTemplatesError(
          error instanceof Error
            ? error.message
            : "Failed to load prompt templates",
        );
      } finally {
        if (!cancelled) {
          setTemplatesLoading(false);
        }
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
    async (input: { name: string; body: string }) => {
      const template = await postTemplate(input);
      setTemplates((prev) => [template, ...prev.filter((t) => t.id !== template.id)]);
      return template;
    },
    [],
  );

  const updateTemplate = React.useCallback(
    async (
      id: string,
      patch: Partial<Pick<PromptTemplate, "name" | "body">>,
    ) => {
      const res = await fetch(`/api/prompt-templates/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = (await res.json()) as
        | { template: unknown }
        | { error: string };
      if (!res.ok) {
        throw new Error(
          "error" in payload ? payload.error : "Failed to update template",
        );
      }
      if (!("template" in payload)) {
        throw new Error("Invalid response from server");
      }
      const template = parseTemplatePayload(payload.template);
      if (!template) {
        throw new Error("Invalid template in response");
      }
      setTemplates((prev) =>
        prev.map((t) => (t.id === id ? template : t)).sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        ),
      );
    },
    [],
  );

  const deleteTemplate = React.useCallback(async (id: string) => {
    const res = await fetch(`/api/prompt-templates/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    const payload = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      throw new Error(payload.error ?? "Failed to delete template");
    }
    setTemplates((prev) => prev.filter((t) => t.id !== id));
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
      templates,
      templatesLoading,
      templatesError,
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
      templates,
      templatesLoading,
      templatesError,
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
