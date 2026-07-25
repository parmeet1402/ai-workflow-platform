"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ChatSessionContextValue = {
  /**
   * Durable org-wide sum of assistant `total_tokens` (loaded from the API,
   * then adjusted as the current session streams).
   */
  sessionTokensUsed: number;
  setSessionTokensUsed: (tokens: number) => void;
  /** Add (or subtract) tokens after a stream completes / regenerate. */
  adjustSessionTokensUsed: (delta: number) => void;
  initialTokenBudget: number;
  costPerThousandTokens: number;
};

const ChatSessionContext = createContext<ChatSessionContextValue | undefined>(
  undefined,
);

const DEFAULT_TOKEN_BUDGET = 1000;
const DEFAULT_COST_PER_THOUSAND = 0.01;

export function ChatSessionProvider({
  children,
  initialTokenBudget = DEFAULT_TOKEN_BUDGET,
  costPerThousandTokens = DEFAULT_COST_PER_THOUSAND,
}: {
  children: ReactNode;
  initialTokenBudget?: number;
  costPerThousandTokens?: number;
}) {
  const [sessionTokensUsed, setSessionTokensUsedState] = useState(0);

  const setSessionTokensUsed = useCallback((tokens: number) => {
    setSessionTokensUsedState(Math.max(0, Math.floor(tokens)));
  }, []);

  const adjustSessionTokensUsed = useCallback((delta: number) => {
    setSessionTokensUsedState((prev) =>
      Math.max(0, Math.floor(prev + delta)),
    );
  }, []);

  const value = useMemo<ChatSessionContextValue>(
    () => ({
      sessionTokensUsed,
      setSessionTokensUsed,
      adjustSessionTokensUsed,
      initialTokenBudget,
      costPerThousandTokens,
    }),
    [
      sessionTokensUsed,
      setSessionTokensUsed,
      adjustSessionTokensUsed,
      initialTokenBudget,
      costPerThousandTokens,
    ],
  );

  return (
    <ChatSessionContext.Provider value={value}>
      {children}
    </ChatSessionContext.Provider>
  );
}

export function useChatSession() {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) {
    throw new Error("useChatSession must be used within ChatSessionProvider");
  }
  return ctx;
}
