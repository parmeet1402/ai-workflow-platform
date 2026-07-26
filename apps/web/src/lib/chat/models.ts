export const CHAT_MODELS = [
  {
    id: "gpt-4o-mini",
    label: "4o Mini",
    hint: "Balanced · everyday",
    dropdownHint: "Balanced",
  },
  {
    id: "gpt-5-mini",
    label: "5 Mini",
    hint: "Stronger reasoning",
    dropdownHint: "Reasoning",
  },
  {
    id: "gpt-5-nano",
    label: "5 Nano",
    hint: "Fastest · lightest",
    dropdownHint: "Fastest",
  },
  {
    id: "gpt-4.1-nano",
    label: "4.1 Nano",
    hint: "Cheapest · long context",
    dropdownHint: "Cheap · long ctx",
  },
] as const;

export type ChatModelId = (typeof CHAT_MODELS)[number]["id"];

export const DEFAULT_CHAT_MODEL: ChatModelId = "gpt-4o-mini";

export function findChatModel(id: string) {
  return CHAT_MODELS.find((m) => m.id === id) ?? CHAT_MODELS[0];
}

export function isChatModelId(value: string): value is ChatModelId {
  return CHAT_MODELS.some((m) => m.id === value);
}
