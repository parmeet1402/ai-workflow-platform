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
  /** Sum of assistant `usage.totalTokens` for the current browser session. */
  sessionTokensUsed: number;
  setSessionTokensUsed: (tokens: number) => void;
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

  const value = useMemo<ChatSessionContextValue>(
    () => ({
      sessionTokensUsed,
      setSessionTokensUsed,
      initialTokenBudget,
      costPerThousandTokens,
    }),
    [
      sessionTokensUsed,
      setSessionTokensUsed,
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
