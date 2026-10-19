// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";

MotionGlobalConfig.skipAnimations = true;
Reflect.deleteProperty(Element.prototype, "animate");
import { Workbench } from "./Workbench";
import { restoredFilters } from "./library-filters";
import { backend, type LibrarySort, type SessionMeta, type SessionQuery, type WorkbenchBackend } from "./api";
vi.mock("./SessionTerminal", () => ({ SessionTerminal: () => null }));

// Index: updated desc = 0,1,2,3 (3 is pinned); created desc = 2,0,3,1; tokens desc = 1,0,2,3.
const make = (index: number): SessionMeta => ({
  key: `codex:s${index}`, native_id: `s${index}`, agent: "codex", host: null, parent_key: null,
  title: `Session ${index}`, project_path: "/projects/demo", source_path: `/tmp/s${index}.jsonl`,
  created_at: [200, 100, 300, 150][index], updated_at: 1000 - index, model: "gpt-5",
  source: "cli", tokens: [50, 90, 10, null][index], archived: false, metadata_only: false, can_delete: true,
  starred: false, pinned: index === 3, labels: [],
});
const options = { agents: ["codex" as const], models: ["gpt-5"], hosts: [],
  projects: [{ path: "/projects/demo", session_count: 4, updated_at: 1000 }] };
const transcript = [{ seq: 0, role: "assistant" as const, kind: "text" as const, text: "Hello", timestamp: null,
  model: null, thinking: null, tool_calls: [], images: [] }];
const order = (sort: LibrarySort | undefined, a: SessionMeta, b: SessionMeta) => {
  switch (sort) {
    case "updated_asc": return a.updated_at - b.updated_at;
    case "created_desc": return b.created_at - a.created_at;
    case "tokens_desc": return (b.tokens ?? -1) - (a.tokens ?? -1);
    default: return b.updated_at - a.updated_at;
  }
};

function fakeApi(pref: string | null = null) {
  const queries: SessionQuery[] = [];
  const writes: string[] = [];
  const rows = [0, 1, 2, 3].map(make);
  const api: WorkbenchBackend = { ...backend, libraryOptions: async () => options, listProjects: async () => [],
    listBookmarks: async () => [], onLibraryChanged: async () => () => {},
    getPref: async name => name === "library_filters" ? pref : null,
    setPref: async (name, value) => { if (name === "library_filters") writes.push(value); },
    listSessionLabels: async () => [],
    sessionPage: async (query, offset, limit) => {
      queries.push(query);
      const items = [...rows].sort((a, b) => Number(b.pinned) - Number(a.pinned) || order(query.sort, a, b) || a.key.localeCompare(b.key));
      return { items: items.slice(offset, offset + limit), total: items.length, offset, limit };
    },
    getSession: async key => rows.find(row => row.key === key) ?? null, getTranscript: async () => transcript,
    getTranscriptSnapshot: async () => ({ session_key_hash: "a".repeat(64), messages: transcript, fingerprints: ["c".repeat(64)] }),
    searchGrouped: async () => ({ groups: [], total_sessions: 0, total_message_matches: 0 }),
    setSessionFlagsBulk: async () => 0 };
  return { api, queries, writes };
}

async function mount(api: WorkbenchBackend) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Workbench api={api} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const titles = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLButtonElement>(".session-card")).map(card => card.textContent?.match(/Session \d/)?.[0]);
const picker = (host: HTMLElement) => host.querySelector<HTMLSelectElement>('select[aria-label="Sort sessions"]');
const choose = async (host: HTMLElement, selector: string, value: string) => {
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};

test("sort control reorders the browse list, keeps pins first, and sends sort to the backend", async () => {
  const { api, queries } = fakeApi();
  const { host, unmount } = await mount(api);
  try {
    expect(Array.from(picker(host)!.options).map(option => option.textContent)).toEqual(
      ["Recently updated", "Least recently updated", "Newest created", "Most tokens"]);
    expect(picker(host)!.value).toBe("updated_desc");
    expect(titles(host)).toEqual(["Session 3", "Session 0", "Session 1", "Session 2"]);
    await choose(host, 'select[aria-label="Sort sessions"]', "updated_asc");
    expect(titles(host)).toEqual(["Session 3", "Session 2", "Session 1", "Session 0"]);
    await choose(host, 'select[aria-label="Sort sessions"]', "created_desc");
    expect(titles(host)).toEqual(["Session 3", "Session 2", "Session 0", "Session 1"]);
    await choose(host, 'select[aria-label="Sort sessions"]', "tokens_desc");
    expect(titles(host)).toEqual(["Session 3", "Session 1", "Session 0", "Session 2"]);
    expect(queries.at(-1)!.sort).toBe("tokens_desc");
  } finally { await unmount(); }
});

test("sort persists in library_filters and restores; malformed or missing values mean the default", async () => {
  const first = fakeApi();
  const one = await mount(first.api);
  try {
    await choose(one.host, 'select[aria-label="Sort sessions"]', "tokens_desc");
    expect(JSON.parse(first.writes.at(-1)!).librarySort).toBe("tokens_desc");
  } finally { await one.unmount(); }

  const restored = fakeApi(JSON.stringify({ librarySort: "created_desc" }));
  const two = await mount(restored.api);
  try {
    expect(picker(two.host)!.value).toBe("created_desc");
    expect(titles(two.host)).toEqual(["Session 3", "Session 2", "Session 0", "Session 1"]);
  } finally { await two.unmount(); }

  for (const bad of ['{"librarySort":"bogus"}', '{"librarySort":7}', '{"agent":null}']) {
    expect(restoredFilters(bad)!.librarySort).toBe("updated_desc");
  }
  const legacy = fakeApi(JSON.stringify({ librarySort: ["tokens_desc"], searchSort: "recent" }));
  const three = await mount(legacy.api);
  try {
    expect(picker(three.host)!.value).toBe("updated_desc");
    expect(titles(three.host)).toEqual(["Session 3", "Session 0", "Session 1", "Session 2"]);
  } finally { await three.unmount(); }
});

test("changing sort clears bulk selection and the control is replaced by search sort while searching", async () => {
  const { api } = fakeApi();
  const { host, unmount } = await mount(api);
  try {
    const cards = () => Array.from(host.querySelectorAll<HTMLButtonElement>(".session-card"));
    await act(async () => { cards()[1].dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })); });
    expect(host.querySelector('[role="toolbar"][aria-label="Bulk session actions"]')).not.toBeNull();
    await choose(host, 'select[aria-label="Sort sessions"]', "updated_asc");
    expect(host.querySelector('[role="toolbar"][aria-label="Bulk session actions"]')).toBeNull();
    expect(cards().every(card => card.getAttribute("aria-pressed") !== "true")).toBe(true);
  } finally { await unmount(); }
});
