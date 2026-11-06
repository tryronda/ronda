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

const session: SessionMeta = {
  key: "codex:one", native_id: "one", agent: "codex", host: null, parent_key: null,
  title: "Fix search", project_path: "/projects/hello world", source_path: "/tmp/one.jsonl",
  created_at: 1_700_000_000_000, updated_at: 1_700_000_000_000, model: "gpt-5",
  source: "cli", tokens: 12, archived: false, metadata_only: false, can_delete: true,
  starred: false, pinned: false,
};
const transcript: TranscriptMessage[] = [
  { seq: 0, role: "assistant", kind: "text", text: "Unique transcript body", timestamp: null, model: null, thinking: null, tool_calls: [], images: [] },
];

test("trashing the open session clears the transcript and shows the notice", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let rows = [session];
  const trashSession = vi.fn(async () => { rows = []; });
  const api: WorkbenchBackend = { ...backend, libraryOptions: async () => ({ agents: ["codex" as const], models: ["gpt-5"], hosts: [],
    projects: [{ path: session.project_path!, session_count: 1, updated_at: session.updated_at }] }),
    listSessions: async () => rows, listProjects: async () => [],
    getSession: async key => rows.find(row => row.key === key) ?? null, getTranscript: async () => transcript,
    getTranscriptSnapshot: async () => ({ session_key_hash: "a".repeat(64), messages: transcript, fingerprints: ["c".repeat(64)] }),
    trashSession, onLibraryChanged: async () => () => {} };
  api.sessionPage = async (_query, offset, limit) => ({ items: rows.slice(offset, offset + limit), total: rows.length, offset, limit });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Workbench api={api} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".session-card")!.click());
    expect(host.textContent).toContain("Unique transcript body");
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="Move to Trash"], button[aria-label="Move to Trash"]')!.click());
    expect(trashSession).toHaveBeenCalledWith(session.key);
    expect(host.textContent).toContain("Session moved to Trash");
    expect(host.textContent).not.toContain("Unique transcript body");
  } finally { confirm.mockRestore(); await act(async () => root.unmount()); host.remove(); }
});
