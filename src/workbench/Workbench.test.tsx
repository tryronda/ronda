// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";

MotionGlobalConfig.skipAnimations = true;
import { Workbench } from "./Workbench";
import type { SessionMeta, TranscriptMessage, WorkbenchBackend } from "./api";

const session: SessionMeta = {
  key: "codex:one", native_id: "one", agent: "codex", host: null, parent_key: null,
  title: "Fix search", project_path: "/projects/hello world", source_path: "/tmp/one.jsonl",
  created_at: 1_700_000_000_000, updated_at: 1_700_000_000_000, model: "gpt-5",
  source: "cli", tokens: 12, archived: false, metadata_only: false, can_delete: true,
  starred: false, pinned: false,
};

afterEach(() => { document.body.innerHTML = ""; });

test("opens on the library home, then loads a session, shows its transcript, and stars it through the backend", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const setFlags = vi.fn(async () => {});
  let finishTranscript!: (messages: TranscriptMessage[]) => void;
  const transcript = new Promise<TranscriptMessage[]>(resolve => { finishTranscript = resolve; });
  const api: WorkbenchBackend = {
    listSessions: async () => [session],
    getSession: async () => session,
    getTranscript: async () => transcript,
    searchSessions: async () => [], listProjects: async () => [{ path: "/projects/hello world", session_count: 1, updated_at: session.updated_at }],
    scan: async () => ({ discovered: 1, indexed: 1, unchanged: 0, errors: [] }),
    setSessionFlags: setFlags, resumeSession: async () => "", exportSession: async () => {},
    trashSession: async () => {}, onLibraryChanged: async () => () => {},
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<Workbench api={api} />); });
  expect(host.textContent).toContain("All your agent sessions");
  await act(async () => { host.querySelector<HTMLButtonElement>('.session-card')!.click(); });
  expect(host.querySelector('.transcript-skeleton')).not.toBeNull();
  await act(async () => { root.render(<Workbench api={api} searchFocusToken={1} />); });
  expect(document.activeElement).toBe(host.querySelector('input[type="search"]'));
  await act(async () => { finishTranscript([{ seq: 0, role: "user", kind: "text", text: "Search for 搜索",
    timestamp: null, model: null, thinking: null, tool_calls: [], images: [] }]); });
  expect(host.textContent).toContain("Search for 搜索");
  const star = host.querySelector<HTMLButtonElement>('button[aria-label="Star"]');
  expect(star).not.toBeNull();
  await act(async () => { star!.click(); });
  expect(setFlags).toHaveBeenCalledWith("codex:one", true, false);
  await act(async () => { root.unmount(); });
});
