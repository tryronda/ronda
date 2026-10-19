// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";

MotionGlobalConfig.skipAnimations = true;
Reflect.deleteProperty(Element.prototype, "animate");
import { Workbench } from "./Workbench";
import { backend, type ExportOptions, type SessionMeta, type SessionQuery, type TranscriptMessage, type WorkbenchBackend } from "./api";
vi.mock("./SessionTerminal", () => ({ SessionTerminal: () => null }));

const session: SessionMeta = {
  key: "codex:one", native_id: "one", agent: "codex", host: null, parent_key: null,
  title: "Fix search", project_path: "/projects/hello world", source_path: "/tmp/one.jsonl",
  created_at: 1_700_000_000_000, updated_at: 1_700_000_000_000, model: "gpt-5",
  source: "cli", tokens: 12, archived: false, metadata_only: false, can_delete: true, starred: false, pinned: false,
};
const transcript: TranscriptMessage[] = [{ seq: 0, role: "assistant", kind: "text", text: "Hello", timestamp: null,
  model: null, thinking: null, tool_calls: [], images: [] }];
const options = { agents: ["codex" as const], models: ["gpt-5"], hosts: [],
  projects: [{ path: session.project_path!, session_count: 1, updated_at: session.updated_at }] };

function fakeApi(markdown: (key: string, options?: ExportOptions) => Promise<string>) {
  const exported: unknown[] = [];
  const api: WorkbenchBackend = { ...backend, libraryOptions: async () => options, listProjects: async () => [],
    listBookmarks: async () => [], onLibraryChanged: async () => () => {}, getPref: async () => null, setPref: async () => {},
    listSessionLabels: async () => [],
    sessionPage: async (_query, offset, limit) => ({ items: [session], total: 1, offset, limit }),
    getSession: async () => session, getTranscript: async () => transcript,
    getTranscriptSnapshot: async () => ({ session_key_hash: "a".repeat(64), messages: transcript, fingerprints: ["c".repeat(64)] }),
    searchGrouped: async () => ({ groups: [], total_sessions: 0, total_message_matches: 0 }),
    exportSession: async (...args) => { exported.push(args); }, sessionMarkdown: markdown };
  return { api, exported };
}

async function mount(api: WorkbenchBackend) {
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
const check = (host: HTMLElement, text: string) => act(async () => {
  Array.from(host.querySelectorAll("label")).find(item => item.textContent === text)!.querySelector("input")!.click();
});
const checkbox = (host: HTMLElement, text: string) => Array.from(host.querySelectorAll("label")).find(item => item.textContent === text)!.querySelector("input")!;

test("export popover starts with both options off, warns about secrets, and copies with the chosen options", async () => {
  const requests: (ExportOptions | undefined)[] = [];
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const { api } = fakeApi(async (_key, chosen) => { requests.push(chosen); return "# copied"; });
  const { host, unmount } = await mount(api);
  try {
    await click(host, "Export Markdown");
    expect(checkbox(host, "Include tool input and output").checked).toBe(false);
    expect(checkbox(host, "Include thinking").checked).toBe(false);
    expect(host.textContent).not.toContain("Tool output may contain secrets.");
    await click(host, "Copy as Markdown");
    expect(requests.at(-1)).toEqual({ includeTools: false, includeThinking: false });
    expect(writeText).toHaveBeenLastCalledWith("# copied");
    expect(host.textContent).toContain("Session copied as Markdown");

    await click(host, "Export Markdown");
    await check(host, "Include tool input and output");
    expect(host.textContent).toContain("Tool output may contain secrets.");
    await check(host, "Include thinking");
    await click(host, "Copy as Markdown");
    expect(requests.at(-1)).toEqual({ includeTools: true, includeThinking: true });
  } finally { await unmount(); vi.restoreAllMocks(); }
});

test("copy failures show the reason and leave the clipboard untouched; clipboard denial is reported", async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error("Clipboard denied")).mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const markdown = vi.fn()
    .mockRejectedValueOnce("Session Markdown is 100001 characters, over the 100,000 character copy limit. Nothing was copied or truncated; use Export Markdown to save it to a file.")
    .mockResolvedValue("# ok");
  const { api } = fakeApi(markdown);
  const { host, unmount } = await mount(api);
  try {
    await click(host, "Export Markdown"); await click(host, "Copy as Markdown");
    expect(host.textContent).toContain("over the 100,000 character copy limit");
    expect(host.textContent).toContain("use Export Markdown to save it to a file");
    expect(writeText).not.toHaveBeenCalled();
    await click(host, "Export Markdown"); await click(host, "Copy as Markdown");
    expect(host.textContent).toContain("Could not copy session: Clipboard denied");
    expect(host.textContent).not.toContain("Session copied as Markdown");
  } finally { await unmount(); vi.restoreAllMocks(); }
});
