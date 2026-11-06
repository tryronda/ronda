import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { backend, type SessionMeta, type WorkbenchBackend } from "./api";

// Shared setup for the Workbench test files. `vi.mock("./SessionTerminal", ...)` must stay in each test file so it is hoisted.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
MotionGlobalConfig.skipAnimations = true;
// happy-dom rejects cancelled native animations; use Motion’s JS renderer in this test environment.
Reflect.deleteProperty(Element.prototype, "animate");

export const session: SessionMeta = {
  key: "codex:one", native_id: "one", agent: "codex", host: null, parent_key: null,
  title: "Fix search", project_path: "/projects/hello world", source_path: "/tmp/one.jsonl",
  created_at: 1_700_000_000_000, updated_at: 1_700_000_000_000, model: "gpt-5",
  source: "cli", tokens: 12, archived: false, metadata_only: false, can_delete: true,
  starred: false, pinned: false,
};

export const libraryOptions = async () => ({agents:["codex" as const,"claude-code" as const],models:["gpt-5"],hosts:[],
  projects:[{path:session.project_path!,session_count:1,updated_at:session.updated_at}]});

export const withSyntheticTranscriptSnapshot = (api: WorkbenchBackend): WorkbenchBackend => {
  api.getTranscriptSnapshot = async key => {
    const messages = await api.getTranscript(key);
    return { session_key_hash: "a".repeat(64), messages, fingerprints: messages.map(message => {
      let value = 2166136261;
      for (const character of JSON.stringify(message)) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
      return (value >>> 0).toString(16).padStart(8, "0").repeat(8);
    }) };
  };
  return api;
};

/** A backend holding the given sessions with paging wired up. */
export const makeApi = (sessions: SessionMeta[] = [session], extra: Partial<WorkbenchBackend> = {}): WorkbenchBackend => {
  const api: WorkbenchBackend = { ...backend, libraryOptions, listSessions: async () => sessions, listProjects: async () => [],
    getSession: async key => sessions.find(item => item.key === key) ?? null, getTranscript: async () => [],
    onLibraryChanged: async () => () => {}, ...extra };
  api.sessionPage = async (_query, offset, limit) => ({ items: sessions.slice(offset, offset + limit), total: sessions.length, offset, limit });
  return withSyntheticTranscriptSnapshot(api);
};

/** Renders into a fresh host attached to the document. */
export async function mount(element: ReactElement) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  const unmount = async () => { await act(async () => root.unmount()); host.remove(); };
  return { host, root, unmount };
}

export const emptyLibraryApi = (extra: Partial<WorkbenchBackend>): WorkbenchBackend => {
  const api: WorkbenchBackend = { ...backend, libraryOptions: async () => ({agents:[],models:[],hosts:[],projects:[]}),
    listSessions: async () => [], listProjects: async () => [], getSession: async () => null, getTranscript: async () => [],
    onLibraryChanged: async () => () => {}, onScanError: async () => () => {}, ...extra };
  api.sessionPage = async (_query, offset, limit) => ({ items: [], total: 0, offset, limit });
  return withSyntheticTranscriptSnapshot(api);
};
