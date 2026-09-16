/** Wire formats the Supercharge CLI /format picker uses. */
export type ApiWireFormat = "chat_completions" | "responses" | "messages";

export const API_WIRE_FORMATS: Array<{
  id: ApiWireFormat;
  label: string;
  hint: string;
}> = [
  {
    id: "chat_completions",
    label: "Chat Completions",
    hint: "/chat/completions",
  },
  { id: "messages", label: "Messages", hint: "/messages" },
  { id: "responses", label: "Responses", hint: "/responses" },
];

export function parseApiWireFormat(
  raw?: string | null,
): ApiWireFormat | undefined {
  const v = (raw || "").trim().toLowerCase().replace(/-/g, "_");
  if (!v) return undefined;
  if (
    v === "messages" ||
    v === "anthropic" ||
    v === "anthropic_messages"
  ) {
    return "messages";
  }
  if (v === "responses" || v === "response") return "responses";
  if (
    v === "chat_completions" ||
    v === "chat_completion" ||
    v === "chatcompletions" ||
    v === "openai" ||
    v === "openai_compatible"
  ) {
    return "chat_completions";
  }
  return undefined;
}

export function defaultApiWireFormat(provider: string): ApiWireFormat {
  const id = provider.trim().toLowerCase();
  if (id === "anthropic") return "messages";
  return "chat_completions";
}

export function normalizeApiWireFormat(
  raw?: string | null,
  provider?: string,
): ApiWireFormat {
  return (
    parseApiWireFormat(raw) ||
    defaultApiWireFormat(provider || "")
  );
}

export function apiWireFormatLabel(format: ApiWireFormat): string {
  return API_WIRE_FORMATS.find((row) => row.id === format)?.label || format;
}
