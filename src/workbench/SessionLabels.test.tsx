// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";

MotionGlobalConfig.skipAnimations = true;
Reflect.deleteProperty(Element.prototype, "animate");
import { Workbench } from "./Workbench";
import { backend, type SessionLabel, type SessionMeta, type SessionQuery, type TranscriptMessage, type WorkbenchBackend } from "./api";
vi.mock("./SessionTerminal", () => ({ SessionTerminal: () => null }));

const CANARY = "CANARY-LABEL-NAME-4418";
const LABEL_A = "0000000000000000000000000000aa01";
const LABEL_B = "0000000000000000000000000000aa02";
const session: SessionMeta = {
  key: "codex:one", native_id: "one", agent: "codex", host: null, parent_key: null,
  title: "Fix search", project_path: "/projects/hello world", source_path: "/tmp/one.jsonl",
  created_at: 1_700_000_000_000, updated_at: 1_700_000_000_000, model: "gpt-5",
  source: "cli", tokens: 12, archived: false, metadata_only: false, can_delete: true, starred: false, pinned: false,
};
const transcript: TranscriptMessage[] = [{ seq: 0, role: "assistant", kind: "text", text: "Hello", timestamp: null,
  model: null, thinking: null, tool_calls: [], images: [] }];
const label = (id: string, name: string): SessionLabel => ({ id, name, created_at: 1, updated_at: 1 });
const options = { agents: ["codex" as const], models: ["gpt-5"], hosts: [],
  projects: [{ path: session.project_path!, session_count: 1, updated_at: session.updated_at }] };

function fakeApi(initial: { labels?: SessionLabel[]; prefs?: Record<string, string> } = {}) {
  let catalog = initial.labels ?? [label(LABEL_A, CANARY), label(LABEL_B, "Reference")];
  let current: SessionMeta = { ...session, labels: [] };
  const prefs = new Map(Object.entries(initial.prefs ?? {}));
  const writes: string[] = [];
  const queries: SessionQuery[] = [];
  const grouped = vi.fn(async (_q: string, filter: SessionQuery) => { queries.push(filter);
    return { groups: [], total_sessions: 0, total_message_matches: 0 }; });
  const api: WorkbenchBackend = { ...backend, libraryOptions: async () => options, listProjects: async () => [],
    listBookmarks: async () => [], onLibraryChanged: async () => () => {},
    getPref: async key => prefs.get(key) ?? null,
    setPref: async (key, value) => { writes.push(`${key}=${value}`); prefs.set(key, value); },
    sessionPage: async (query, offset, limit) => { queries.push(query);
      const items = [current].filter(item => !query.label_id || item.labels?.includes(query.label_id));
      return { items: items.slice(offset, offset + limit), total: items.length, offset, limit }; },
    getSession: async () => current, getTranscript: async () => transcript,
    getTranscriptSnapshot: async () => ({ session_key_hash: "a".repeat(64), messages: transcript, fingerprints: ["c".repeat(64)] }),
    searchGrouped: grouped,
    listSessionLabels: async () => catalog,
    createSessionLabel: async name => { const created = label(`${catalog.length + 1}`.padStart(32, "0"), name); catalog = [...catalog, created]; return created; },
    renameSessionLabel: async (id, name) => { catalog = catalog.map(item => item.id === id ? { ...item, name } : item); return catalog.find(item => item.id === id)!; },
    deleteSessionLabel: async id => { catalog = catalog.filter(item => item.id !== id); current = { ...current, labels: current.labels?.filter(value => value !== id) }; },
    setSessionLabel: async (_key, id, assigned) => { current = { ...current, labels: assigned ? [...(current.labels ?? []), id] : current.labels?.filter(value => value !== id) }; } };
  return { api, writes, queries, grouped, prefs, assigned: () => current.labels ?? [] };
}

async function mount(api: WorkbenchBackend, props: { sidebarOpen?: boolean } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Workbench api={api} {...props} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const unmount = async () => { await act(async () => root.unmount()); host.remove(); };
  return { host, unmount };
}
const set = async (host: HTMLElement, selector: string, value: string, event = "change") => act(async () => {
  const input = host.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event(event, { bubbles: true }));
});
const button = (host: HTMLElement, text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === text)!;
const submit = (host: HTMLElement, selector: string) => act(async () => {
  host.querySelector<HTMLInputElement>(selector)!.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
});
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 170)); });

test("creates, renames, deletes, assigns, and filters labels from the session pane while the sidebar is collapsed", async () => {
  const fake = fakeApi();
  const { host, unmount } = await mount(fake.api, { sidebarOpen: false });
  try {
    const pane = host.querySelector('[aria-label="Recent sessions"]')!;
    expect(pane.contains(host.querySelector('[aria-label="Filter by label"]'))).toBe(true);
    host.querySelector("summary")!.click();
    const manage = Array.from(host.querySelectorAll("summary")).find(item => item.textContent?.startsWith("Manage labels"))!;
    expect(manage.textContent).toContain("(2/12)");
    await set(host, "#new-label-name", "  Ideas ", "input");
    await submit(host, "#new-label-name");
    expect(host.textContent).toContain("Ideas");
    expect(host.querySelectorAll('[aria-label="Filter by label"] option')).toHaveLength(4);
    await set(host, "#new-label-name", "ideas", "input");
    await submit(host, "#new-label-name");
    expect(host.textContent).toContain("A label with that name already exists");
    await set(host, "#new-label-name", "x".repeat(41), "input");
    await submit(host, "#new-label-name");
    expect(host.textContent).toContain("limited to 40 characters");

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Rename label Reference"]')!.click());
    await set(host, `#label-rename-${LABEL_B}`, "Reading list", "input");
    await submit(host, `#label-rename-${LABEL_B}`);
    expect(host.textContent).toContain("Reading list");

    await act(async () => host.querySelector<HTMLButtonElement>(".session-card")!.click());
    await settle();
    const add = host.querySelector<HTMLSelectElement>('select[aria-label="Add label"]')!;
    await act(async () => { add.value = LABEL_A; add.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(fake.assigned()).toEqual([LABEL_A]);
    expect(host.querySelector('button[aria-label="Remove label ' + CANARY + '"]')).not.toBeNull();

    await set(host, '[aria-label="Filter by label"]', LABEL_B);
    await settle();
    expect(fake.queries.at(-1)).toMatchObject({ label_id: LABEL_B });
    await set(host, '[aria-label="Filter by label"]', LABEL_A);
    await settle();
    expect(fake.queries.at(-1)).toMatchObject({ label_id: LABEL_A, starred_only: false, include_archived: false });
    const writes = fake.writes.filter(item => item.startsWith("library_filters="));
    expect(JSON.parse(writes.at(-1)!.slice("library_filters=".length))).toMatchObject({ labelId: LABEL_A });

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Remove label ' + CANARY + '"]')!.click());
    await settle();
    expect(fake.assigned()).toEqual([]);

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Delete label ' + CANARY + '"]')!.click());
    await settle();
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Filter by label"]')!.value).toBe("");
    expect(fake.queries.at(-1)?.label_id).toBeNull();
    expect(host.textContent).not.toContain(CANARY);
  } finally { await unmount(); }
});

test("a session accepts at most four labels in the picker", async () => {
  const labels = Array.from({ length: 5 }, (_, index) => label(`${index + 1}`.padStart(32, "0"), `L${index}`));
  const fake = fakeApi({ labels });
  const { host, unmount } = await mount(fake.api);
  try {
    await act(async () => host.querySelector<HTMLButtonElement>(".session-card")!.click());
    await settle();
    for (const item of labels.slice(0, 4)) {
      const add = host.querySelector<HTMLSelectElement>('select[aria-label="Add label"]')!;
      await act(async () => { add.value = item.id; add.dispatchEvent(new Event("change", { bubbles: true })); });
    }
    expect(fake.assigned()).toHaveLength(4);
    const add = host.querySelector<HTMLSelectElement>('select[aria-label="Add label"]')!;
    expect(add.disabled).toBe(true);
    expect(add.textContent).toContain("Label limit reached");
  } finally { await unmount(); }
});

test("saved searches store only the label id, and replay legacy and labelled definitions exactly", async () => {
  const legacy = { id: "123e4567-e89b-42d3-a456-426614174031", name: "Legacy", query: "timeout",
    filters: { project: null, agent: null, starredOnly: false, includeArchived: false, dateFrom: "", dateThrough: "", model: "", host: "" }, sort: "recent" };
  const fake = fakeApi({ prefs: { saved_searches_v1: JSON.stringify({ version: 1, items: [legacy] }) } });
  const { host, unmount } = await mount(fake.api);
  try {
    await set(host, '[aria-label="Filter by label"]', LABEL_A);
    await set(host, '[aria-label="Search all conversations"]', "needle", "input");
    await act(async () => button(host, "Save current search").click());
    await set(host, "#saved-search-name", "Labelled", "input");
    await submit(host, "#saved-search-name");
    await settle();
    const stored = fake.prefs.get("saved_searches_v1")!;
    const items = JSON.parse(stored).items;
    expect(items.find((item: { name: string }) => item.name === "Labelled").filters.labels).toEqual([LABEL_A]);
    // Rewriting the document keeps the legacy item valid and replayable with an empty label scope.
    expect(items.find((item: { name: string }) => item.name === "Legacy").filters.labels).toEqual([]);
    expect(stored).not.toContain(CANARY);
    for (const [key, value] of fake.prefs) expect(`${key}${value}`, key).not.toContain(CANARY);

    await act(async () => button(host, "Legacy").click());
    await settle();
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Filter by label"]')!.value).toBe("");
    expect(fake.grouped).toHaveBeenLastCalledWith("timeout", expect.objectContaining({ label_id: null }), "recent", 0, 50);
    await act(async () => button(host, "Labelled").click());
    await settle();
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Filter by label"]')!.value).toBe(LABEL_A);
    expect(fake.grouped).toHaveBeenLastCalledWith("needle", expect.objectContaining({ label_id: LABEL_A }), "relevance", 0, 50);
  } finally { await unmount(); }
});

test("a deleted label stays an exact filter on replay until explicitly cleared", async () => {
  const gone = "0000000000000000000000000000dead";
  const definition = { version: 1, items: [{ id: "123e4567-e89b-42d3-a456-426614174032", name: "Gone label", query: "timeout",
    filters: { project: null, agent: null, starredOnly: false, includeArchived: false, dateFrom: "", dateThrough: "", model: "", host: "", labels: [gone] }, sort: "relevance" }] };
  const fake = fakeApi({ prefs: { saved_searches_v1: JSON.stringify(definition) } });
  const { host, unmount } = await mount(fake.api);
  try {
    await act(async () => button(host, "Gone label").click());
    await settle();
    expect(host.textContent).toContain("Label: unavailable");
    expect(fake.grouped).toHaveBeenLastCalledWith("timeout", expect.objectContaining({ label_id: gone }), "relevance", 0, 50);
    await act(async () => button(host, "Clear unavailable filters").click());
    await settle();
    expect(host.textContent).not.toContain("Label: unavailable");
    expect(fake.grouped).toHaveBeenLastCalledWith("timeout", expect.objectContaining({ label_id: null }), "relevance", 0, 50);
  } finally { await unmount(); }
});

test("a stale restored label preference keeps matching nothing and offers an explicit clear", async () => {
  const gone = "0000000000000000000000000000beef";
  const fake = fakeApi({ prefs: { library_filters: JSON.stringify({ labelId: gone }) } });
  const { host, unmount } = await mount(fake.api);
  try {
    expect(fake.queries.some(query => query.label_id === gone)).toBe(true);
    expect(host.textContent).toContain("The selected label no longer exists");
    await act(async () => button(host, "Clear label filter").click());
    await settle();
    expect(fake.queries.at(-1)?.label_id).toBeNull();
    expect(host.textContent).not.toContain("The selected label no longer exists");
  } finally { await unmount(); }
});

test("malformed restored label preferences are ignored rather than trusted", async () => {
  const fake = fakeApi({ prefs: { library_filters: JSON.stringify({ labelId: { $ne: 1 } }) } });
  const { host, unmount } = await mount(fake.api);
  try {
    expect(fake.queries.every(query => !query.label_id)).toBe(true);
  } finally { await unmount(); }
});
