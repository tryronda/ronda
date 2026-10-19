// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";

MotionGlobalConfig.skipAnimations = true;
Reflect.deleteProperty(Element.prototype, "animate");
import { Workbench } from "./Workbench";
import { backend, type SessionMeta, type TranscriptMessage, type WorkbenchBackend } from "./api";
vi.mock("./SessionTerminal", () => ({ SessionTerminal: () => null }));

const base: SessionMeta = {
  key: "codex:one", native_id: "one", agent: "codex", host: null, parent_key: null,
  title: "Fix search", project_path: "/projects/demo", source_path: "/tmp/one.jsonl",
  created_at: 1_700_000_000_000, updated_at: 1_700_100_000_000, model: "gpt-5",
  source: "cli", tokens: 12345, archived: false, metadata_only: false, can_delete: true, starred: false, pinned: false,
};
const message = (seq: number, role: "user" | "assistant", text: string, tool_calls: TranscriptMessage["tool_calls"] = []): TranscriptMessage =>
  ({ seq, role, kind: "text", text, timestamp: null, model: null, thinking: null, tool_calls, images: [] });

async function mount(session: SessionMeta, transcript: TranscriptMessage[]) {
  const options = { agents: ["codex" as const], models: ["gpt-5"], hosts: [],
    projects: [{ path: "/projects/demo", session_count: 1, updated_at: session.updated_at }] };
  const api: WorkbenchBackend = { ...backend, libraryOptions: async () => options, listProjects: async () => [],
    listBookmarks: async () => [], onLibraryChanged: async () => () => {}, getPref: async () => null, setPref: async () => {},
    listSessionLabels: async () => [],
    sessionPage: async (_q, offset, limit) => ({ items: [session], total: 1, offset, limit }),
    getSession: async () => session, getTranscript: async () => transcript,
    getTranscriptSnapshot: async () => ({ session_key_hash: "a".repeat(64), messages: transcript, fingerprints: transcript.map(() => "c".repeat(64)) }),
    searchGrouped: async () => ({ groups: [], total_sessions: 0, total_message_matches: 0 }) };
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Workbench api={api} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await act(async () => host.querySelector<HTMLButtonElement>(".session-card")!.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 170)); });
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const button = (host: HTMLElement, text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === text || item.getAttribute("aria-label") === text)!;
const click = (host: HTMLElement, text: string) => act(async () => { button(host, text).click(); });

test("Prompts only explains an empty result and offers all messages", async () => {
  const { host, unmount } = await mount(base, [message(0, "assistant", "Only assistant text")]);
  try {
    expect(host.textContent).toContain("Only assistant text");
    await act(async () => Array.from(host.querySelectorAll("label")).find(l => l.textContent === "Prompts only")!.querySelector("input")!.click());
    expect(host.textContent).toContain("No prompts in this session.");
    expect(host.textContent).not.toContain("Only assistant text");
    await click(host, "Show all messages");
    expect(host.textContent).toContain("Only assistant text");
    expect(host.textContent).not.toContain("No prompts in this session.");
  } finally { await unmount(); }
});

test("Copy reference writes the ronda link, including for tool-only messages", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const toolOnly: TranscriptMessage = { ...message(3, "assistant", ""), tool_calls: [{ id: "t", name: "Bash", input: "ls", output: null, is_error: false }] };
  const { host, unmount } = await mount(base, [message(0, "user", "Hi"), toolOnly]);
  try {
    await click(host, "Copy reference 0");
    expect(writeText).toHaveBeenLastCalledWith("ronda://session/codex:one#0");
    expect(host.textContent).toContain("Reference copied");
    await click(host, "Copy reference 3");
    expect(writeText).toHaveBeenLastCalledWith("ronda://session/codex:one#3");
  } finally { await unmount(); vi.restoreAllMocks(); }
});
