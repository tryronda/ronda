import type { SessionMeta, TranscriptMessage, WorkbenchBackend } from "./api";

export const CONTEXT_LIMIT = 100_000;
export type ContextSelection = { key: string; seq: number };
export type ContextSource = { session: SessionMeta; messages: TranscriptMessage[] };
export const contextId = ({ key, seq }: ContextSelection) => JSON.stringify([key, seq]);
export const contextEligible = (message: TranscriptMessage) => message.kind === "text" && (message.role === "user" || message.role === "assistant");
export const contextLength = (text: string) => Array.from(text).length;

export function validateContext(text: string) {
  if (contextLength(text) > CONTEXT_LIMIT) throw new Error("Context exceeds 100,000 characters. Reduce the selection or draft; nothing was truncated.");
}

const label = (text: string) => text.replace(/\r?\n/g, " ").replace(/[\\`*_{}\[\]<>!#|]/g, "\\$&");
const literal = (text: string) => {
  const fence = "`".repeat((text.match(/`+/g) ?? []).reduce((length, run) => Math.max(length, run.length + 1), 3));
  return `${fence}\n${text}\n${fence}`;
};

/** One formatter for the editable preview, clipboard, and Markdown file. */
export function formatContext(sources: ContextSource[], options = { tools: false, thinking: false }) {
  let draft = "# Selected Ronda context\n\n";
  for (const { session, messages } of sources) {
    draft += `## ${label(session.title)}\n\nAgent: ${label(session.agent)}\nProject: ${label(session.project_path ?? "Unknown")}\nHost: ${label(session.host ?? "Local")}\n\n`;
    for (const message of [...messages].sort((a, b) => a.seq - b.seq)) {
      if (!contextEligible(message)) throw new Error(`Message #${message.seq} is internal context and cannot be included. Remove it from the selection.`);
      const date = message.timestamp === null ? null : new Date(message.timestamp);
      const timestamp = date && Number.isFinite(date.getTime()) ? date.toISOString() : "Not recorded";
      draft += `### ${message.role} · message #${message.seq}\n\nTimestamp: ${timestamp}\nReference: ronda://session/${session.key}#${message.seq}\n\n${message.text}\n\n`;
      if (options.tools) for (const tool of message.tool_calls) {
        draft += `Tool: ${label(tool.name)}${tool.is_error ? " (recorded error)" : ""}\n\n`;
        if (tool.input !== null) draft += `Input:\n\n${literal(tool.input)}\n\n`;
        if (tool.output !== null) draft += `Output:\n\n${literal(tool.output)}\n\n`;
      }
      if (options.thinking && message.thinking !== null) draft += `Thinking:\n\n${literal(message.thinking)}\n\n`;
      validateContext(draft);
    }
  }
  validateContext(draft);
  return draft;
}

export async function loadContext(api: Pick<WorkbenchBackend, "getSession" | "getTranscript">, selection: ContextSelection[]): Promise<ContextSource[]> {
  if (!selection.length) throw new Error("Select at least one message.");
  const keys = Array.from(new Set(selection.map(item => item.key)));
  return Promise.all(keys.map(async key => {
    const [session, transcript] = await Promise.all([api.getSession(key), api.getTranscript(key)]);
    if (!session) throw new Error("A selected session is unavailable. Remove its messages from the selection.");
    const sequences = new Set(selection.filter(item => item.key === key).map(item => item.seq));
    const messages = transcript.filter(message => sequences.has(message.seq));
    if (messages.length !== sequences.size) throw new Error(`A selected message in ${session.title} is unavailable. Remove it from the selection.`);
    return { session, messages };
  }));
}
