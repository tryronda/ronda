// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";

MotionGlobalConfig.skipAnimations = true;
Reflect.deleteProperty(Element.prototype, "animate");
import { Workbench } from "./Workbench";
import { backend, type SessionMeta, type WorkbenchBackend } from "./api";
import { SESSION_ALIASES_KEY } from "./session-alias";
vi.mock("./SessionTerminal", () => ({ SessionTerminal: () => null }));

const SOURCE = "Fix search";
const session: SessionMeta = {
  key: "codex:one", native_id: "one", agent: "codex", host: null, parent_key: null,
  title: SOURCE, project_path: "/projects/demo", source_path: "/tmp/one.jsonl",
  created_at: 1_700_000_000_000, updated_at: 1_700_000_000_000, model: "gpt-5",
  source: "cli", tokens: 12, archived: false, metadata_only: false, can_delete: true, starred: false, pinned: false,
};
const transcript = [{ seq: 0, role: "assistant" as const, kind: "text" as const, text: "Hello", timestamp: null,
  model: null, thinking: null, tool_calls: [], images: [] }];
const options = { agents: ["codex" as const], models: ["gpt-5"], hosts: [],
  projects: [{ path: "/projects/demo", session_count: 1, updated_at: session.updated_at }] };

function fakeApi(initial: string | null = null) {
  const prefs = new Map<string, string>(initial === null ? [] : [[SESSION_ALIASES_KEY, initial]]);
  const writes: string[] = [];
  const other: string[] = [];
  const api: WorkbenchBackend = { ...backend, libraryOptions: async () => options, listProjects: async () => [],
    listBookmarks: async () => [], onLibraryChanged: async () => () => {}, listSessionLabels: async () => [],
    getPref: async key => prefs.get(key) ?? null,
    setPref: async (key, value) => { if (key === SESSION_ALIASES_KEY) writes.push(key); else other.push(value); prefs.set(key, value); },
    sessionPage: async (_q, offset, limit) => ({ items: [session], total: 1, offset, limit }),
    getSession: async () => session, getTranscript: async () => transcript,
    getTranscriptSnapshot: async () => ({ session_key_hash: "a".repeat(64), messages: transcript, fingerprints: ["c".repeat(64)] }),
    searchGrouped: async () => ({ groups: [], total_sessions: 0, total_message_matches: 0 }) };
  return { api, prefs, writes, other };
}
async function mount(api: WorkbenchBackend, onActive = vi.fn()) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Workbench api={api} onActiveSessionChange={onActive} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await act(async () => host.querySelector<HTMLButtonElement>(".session-card")!.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 170)); });
  return { host, onActive, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const rename = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-label="Rename session"]')!;
const button = (host: HTMLElement, text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === text)!;
const type = (host: HTMLElement, value: string) => act(async () => {
  const input = host.querySelector<HTMLInputElement>("#session-title-input")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const submit = () => act(async () => {
  document.querySelector<HTMLFormElement>('form[aria-label="Rename session"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
});
const headline = (host: HTMLElement) => host.querySelector("header h2")!.textContent;

test("rename shows the alias everywhere, keeps the source visible, and Reset title restores it", async () => {
  const fake = fakeApi();
  const { host, onActive, unmount } = await mount(fake.api);
  try {
    expect(headline(host)).toBe(SOURCE);
    await act(async () => rename(host).click());
    await type(host, "  My title  ");
    await submit();
    expect(headline(host)).toBe("My title");
    expect(host.querySelector("#session-title-input")).toBeNull();
    expect(host.querySelector(".session-card")!.textContent).toContain("My title");
    expect(host.textContent).toContain(`Original title: ${SOURCE}`);
    expect(onActive).toHaveBeenLastCalledWith(expect.objectContaining({ title: "My title" }));
    expect(JSON.parse(fake.prefs.get(SESSION_ALIASES_KEY)!)).toEqual({ version: 1, titles: { "codex:one": "My title" } });

    await act(async () => rename(host).click());
    await act(async () => button(host, "Reset title").click());
    expect(headline(host)).toBe(SOURCE);
    expect(JSON.parse(fake.prefs.get(SESSION_ALIASES_KEY)!).titles).toEqual({});
    expect(onActive).toHaveBeenLastCalledWith(expect.objectContaining({ title: SOURCE }));
  } finally { await unmount(); }
});

test("Cancel and Escape close without writing; invalid input is refused", async () => {
  const fake = fakeApi();
  const { host, unmount } = await mount(fake.api);
  try {
    await act(async () => rename(host).click());
    await type(host, "   ");
    await submit();
    expect(host.textContent).toContain("Enter a title");
    await act(async () => host.querySelector<HTMLFormElement>('form[aria-label="Rename session"]')!.querySelectorAll("button")[1].click());
    expect(host.querySelector("#session-title-input")).toBeNull();
    await act(async () => rename(host).click());
    await act(async () => { host.querySelector("#session-title-input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(host.querySelector("#session-title-input")).toBeNull();
    expect(fake.writes).toEqual([]);
    expect(headline(host)).toBe(SOURCE);
  } finally { await unmount(); }
});

test("a corrupt pref shows source titles, disables rename, and is never overwritten", async () => {
  const corrupt = "{not json";
  const fake = fakeApi(corrupt);
  const { host, unmount } = await mount(fake.api);
  try {
    expect(headline(host)).toBe(SOURCE);
    expect(rename(host).disabled).toBe(true);
    expect(host.textContent).toContain("Local titles are unavailable");
    expect(fake.writes).toEqual([]);
    expect(fake.prefs.get(SESSION_ALIASES_KEY)).toBe(corrupt);
  } finally { await unmount(); }
});

test("stored aliases render on load", async () => {
  const fake = fakeApi(JSON.stringify({ version: 1, titles: { "codex:one": "Saved alias" } }));
  const { host, unmount } = await mount(fake.api);
  try { expect(headline(host)).toBe("Saved alias"); } finally { await unmount(); }
});

test("an alias is written only to its own preference and never to other stored settings", async () => {
  const fake = fakeApi();
  const { host, unmount } = await mount(fake.api);
  try {
    await act(async () => rename(host).click());
    await type(host, "CANARY-ALIAS-7731");
    await submit();
    expect(fake.writes).toEqual([SESSION_ALIASES_KEY]);
    expect(fake.other.join("\n")).not.toContain("CANARY-ALIAS-7731");
  } finally { await unmount(); }
});
