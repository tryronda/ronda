// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { Workbench } from "./Workbench";
import { backend, type BookmarkView, type SessionMeta, type TranscriptMessage, type WorkbenchBackend } from "./api";
import { emptyLibraryApi, libraryOptions, session, withSyntheticTranscriptSnapshot } from "./workbench-test-utils";

vi.mock("./SessionTerminal", () => ({ SessionTerminal: () => null }));

afterEach(() => { document.body.innerHTML = ""; vi.useRealTimers(); });


test("saved searches snapshot literal query, filters and sort, then replay through grouped search", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let savedPref: string | null = null;
  const writes: string[] = [];
  const searchGrouped = vi.fn(async () => ({ groups: [], total_sessions: 0, total_message_matches: 0 }));
  const api: WorkbenchBackend = { ...backend, libraryOptions: async () => ({ ...await libraryOptions(), hosts: ["local"] }),
    getPref: async key => key === "saved_searches_v1" ? savedPref : null,
    setPref: async (key, value) => { if (key === "saved_searches_v1") { savedPref = value; writes.push(value); } },
    listSessions: async () => [session], sessionPage: async (_query, offset, limit) => ({ items: [session].slice(offset, offset + limit), total: 1, offset, limit }),
    listProjects: async () => [], listBookmarks: async () => [], searchGrouped,
    onLibraryChanged: async () => () => {} };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const setValue = async (selector: string, value: string, event = "change") => act(async () => {
    const input = host.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event(event, { bubbles: true }));
  });
  try {
    await act(async () => root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)} />));
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="/projects/hello world"]')!.click());
    await setValue('[aria-label="Search all conversations"]', "  ECONNRESET  ", "input");
    expect(host.querySelector<HTMLInputElement>('[aria-label="Search all conversations"]')?.value).toBe("  ECONNRESET  ");
    const agent = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.trim() === "Codex");
    await act(async () => agent!.click());
    const starred = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Starred"));
    await act(async () => starred!.click());
    const archived = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Include archived"));
    await act(async () => archived!.click());
    await setValue('[aria-label="Updated from"]', "2026-01-01", "input");
    await setValue('[aria-label="Updated through"]', "2026-01-31", "input");
    await setValue('[aria-label="Filter by model"]', "gpt-5");
    await setValue('[aria-label="Filter by host"]', "local");
    await setValue('[aria-label="Sort search results"]', "recent");
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Save current search")!.click());
    await setValue("#saved-search-name", "Connection failures", "input");
    await act(async () => host.querySelector<HTMLFormElement>("#saved-search-name")!.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(writes).toHaveLength(1);
    const definition = JSON.parse(savedPref!) as { version: number; items: { name: string; query: string; filters: Record<string, unknown>; sort: string }[] };
    expect(definition.version).toBe(1);
    expect(definition.items[0]).toMatchObject({ name: "Connection failures", query: "ECONNRESET", sort: "recent",
      filters: { project: session.project_path, agent: "codex", starredOnly: true, includeArchived: true,
        dateFrom: "2026-01-01", dateThrough: "2026-01-31", model: "gpt-5", host: "local" } });
    expect(savedPref).not.toContain("  ECONNRESET  ");
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Save current search")!.click());
    await setValue("#saved-search-name", "Connection failures", "input");
    await act(async () => host.querySelector<HTMLFormElement>("#saved-search-name")!.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(host.textContent).toContain("That saved search already exists");
    expect(writes).toHaveLength(1);
    await setValue('[aria-label="Search all conversations"]', "different query", "input");
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Connection failures")!.click());
    expect(host.querySelector<HTMLInputElement>('[aria-label="Search all conversations"]')?.value).toBe("ECONNRESET");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Filter by host"]')?.value).toBe("local");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Sort search results"]')?.value).toBe("recent");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
    expect(searchGrouped).toHaveBeenCalledWith("ECONNRESET", expect.objectContaining({ project_path: session.project_path,
      agent: "codex", local_only: true, starred_only: true, include_archived: true, model: "gpt-5" }), "recent", 0, 50);
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Rename")!.click());
    await setValue('input[id^="saved-search-rename-"]', "Connection issues", "input");
    await act(async () => host.querySelector<HTMLInputElement>('input[id^="saved-search-rename-"]')!.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(JSON.parse(savedPref!).items[0].name).toBe("Connection issues");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Remove Connection issues"]')!.click());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(JSON.parse(savedPref!).items).toEqual([]);
    expect(writes).toHaveLength(3);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("malformed saved-search preferences stay untouched until the user explicitly resets them", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const original = JSON.stringify({ version: 17, items: [] });
  let stored = original;
  const writes: [string, string][] = [];
  const api: WorkbenchBackend = { ...backend, libraryOptions, listSessions: async () => [session], listProjects: async () => [],
    getPref: async key => key === "saved_searches_v1" ? stored : null,
    setPref: async (key, value) => { writes.push([key, value]); if (key === "saved_searches_v1") stored = value; },
    onLibraryChanged: async () => () => {} };
  api.sessionPage = async (_query, offset, limit) => ({ items: [session].slice(offset, offset + limit), total: 1, offset, limit });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Workbench api={api} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain("Their stored data is unchanged");
    expect(writes.some(([key]) => key === "saved_searches_v1")).toBe(false);
    expect(stored).toBe(original);
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Clear and reset saved searches")!.click());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(stored).toBe(JSON.stringify({ version: 1, items: [] }));
    expect(host.textContent).toContain("Saved searches cleared");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("the saved-search cap rejects another save without replacing an existing definition", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const items = Array.from({ length: 20 }, (_, index) => ({ id: `123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, "0")}`,
    name: `Saved ${index}`, query: `query ${index}`, filters: { project: null, agent: null, starredOnly: false,
      includeArchived: false, dateFrom: "", dateThrough: "", model: "", host: "" }, sort: "relevance" }));
  const stored = JSON.stringify({ version: 1, items });
  let savedValue = stored;
  const api: WorkbenchBackend = { ...backend, libraryOptions, listSessions: async () => [session], listProjects: async () => [],
    getPref: async key => key === "saved_searches_v1" ? savedValue : null,
    setPref: async (key, value) => { if (key === "saved_searches_v1") savedValue = value; },
    onLibraryChanged: async () => () => {} };
  api.sessionPage = async (_query, offset, limit) => ({ items: [session].slice(offset, offset + limit), total: 1, offset, limit });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const type = async (selector: string, value: string, event = "input") => act(async () => {
    const input = host.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event(event, { bubbles: true }));
  });
  try {
    await act(async () => root.render(<Workbench api={api} />));
    await type('[aria-label="Search all conversations"]', "new query");
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Save current search")!.click());
    await type("#saved-search-name", "One more");
    await act(async () => host.querySelector<HTMLFormElement>("#saved-search-name")!.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(host.textContent).toContain("Saved searches are full");
    expect(savedValue).toBe(stored);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("a saved-search write failure is explicit and a later edit retries the current list", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let attempt = 0;
  let stored = "";
  let releaseFirst!: () => void;
  const api: WorkbenchBackend = { ...backend, libraryOptions, listSessions: async () => [session], listProjects: async () => [],
    getPref: async key => key === "saved_searches_v1" ? null : null,
    setPref: async (key, value) => { if (key !== "saved_searches_v1") return;
      attempt++;
      if (attempt === 1) await new Promise<void>(resolve => { releaseFirst = resolve; });
      else if (attempt === 2) throw new Error("private query path should not escape");
      stored = value;
    },
    onLibraryChanged: async () => () => {} };
  api.sessionPage = async (_query, offset, limit) => ({ items: [session].slice(offset, offset + limit), total: 1, offset, limit });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const inputValue = async (selector: string, value: string) => act(async () => {
    const input = host.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  try {
    await act(async () => root.render(<Workbench api={api} />));
    await inputValue('[aria-label="Search all conversations"]', "private query path");
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Save current search")!.click());
    await inputValue("#saved-search-name", "Local query");
    await act(async () => host.querySelector<HTMLFormElement>("#saved-search-name")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(attempt).toBe(1);
    expect(host.textContent).toContain("Local query");
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Rename")!.click());
    await inputValue('input[id^="saved-search-rename-"]', "Local query renamed");
    await act(async () => host.querySelector<HTMLInputElement>('input[id^="saved-search-rename-"]')!.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => releaseFirst());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(attempt).toBe(2);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("change is not saved");
    expect(host.querySelector('[role="alert"]')?.textContent).not.toContain("private query path");
    expect(JSON.parse(stored).items[0].name).toBe("Local query");
    expect(host.textContent).toContain("Local query renamed");
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Rename")!.click());
    await inputValue('input[id^="saved-search-rename-"]', "Local query final");
    await act(async () => host.querySelector<HTMLInputElement>('input[id^="saved-search-rename-"]')!.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(attempt).toBe(3);
    expect(JSON.parse(stored).items[0].name).toBe("Local query final");
    expect(host.textContent).toContain("Saved searches updated");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("saved replay keeps stale scopes exact and clearing only removes scopes still unavailable", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const definition = { version: 1, items: [{ id: "123e4567-e89b-42d3-a456-426614174010", name: "Old service", query: "timeout",
    filters: { project: "/projects/removed", agent: null, starredOnly: false, includeArchived: false,
      dateFrom: "", dateThrough: "", model: "legacy-model", host: "remote:legacy-host" }, sort: "recent" }] };
  let options = { agents: ["codex" as const], models: ["current-model"], hosts: ["current-host"], projects: [{ path: session.project_path!, session_count: 1, updated_at: session.updated_at }] };
  const searchGrouped = vi.fn(async () => ({ groups: [], total_sessions: 0, total_message_matches: 0 }));
  const api: WorkbenchBackend = { ...backend, libraryOptions: async () => options, getPref: async key => key === "saved_searches_v1" ? JSON.stringify(definition) : null,
    scan: async () => ({ discovered: 0, indexed: 0, unchanged: 0, errors: [] }), searchGrouped,
    listSessions: async () => [session], listProjects: async () => [], onLibraryChanged: async () => () => {} };
  api.sessionPage = async (_query, offset, limit) => ({ items: [session].slice(offset, offset + limit), total: 1, offset, limit });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Workbench api={api} />));
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Old service")!.click());
    expect(host.textContent).toContain("Project: removed");
    expect(host.textContent).toContain("Model: legacy-model");
    expect(host.textContent).toContain("Host: legacy-host");
    options = { ...options, models: ["current-model", "legacy-model"], hosts: ["current-host", "legacy-host"] };
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="Refresh library"]')!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const warning = Array.from(host.querySelectorAll('[role="status"]')).find(item => item.textContent?.includes("Project: removed"));
    expect(warning?.textContent).toContain("Project: removed");
    expect(warning?.textContent).not.toContain("Model: legacy-model");
    expect(warning?.textContent).not.toContain("Host: legacy-host");
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Clear unavailable filters")!.click());
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Filter by model"]')?.value).toBe("legacy-model");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Filter by host"]')?.value).toBe("remote:legacy-host");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
    expect(searchGrouped).toHaveBeenCalledWith("timeout", expect.objectContaining({ project_path: null, model: "legacy-model", host: "legacy-host" }), "recent", 0, 50);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("saved-search save and replay stay in the session pane when the library sidebar is collapsed", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let savedPref: string | null = null;
  const searchGrouped = vi.fn(async () => ({ groups: [], total_sessions: 0, total_message_matches: 0 }));
  const api: WorkbenchBackend = { ...backend, libraryOptions, listSessions: async () => [session], listProjects: async () => [],
    getPref: async key => key === "saved_searches_v1" ? savedPref : null,
    setPref: async (key, value) => { if (key === "saved_searches_v1") savedPref = value; },
    sessionPage: async (_query, offset, limit) => ({ items: [session].slice(offset, offset + limit), total: 1, offset, limit }),
    searchGrouped, onLibraryChanged: async () => () => {} };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const type = async (selector: string, value: string) => act(async () => {
    const input = host.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  try {
    await act(async () => root.render(<Workbench api={api} sidebarOpen={false} />));
    expect(host.querySelector('[aria-label="Library"]')?.getAttribute("aria-hidden")).toBe("true");
    await type('[aria-label="Search all conversations"]', "collapsed query");
    const save = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Save current search");
    expect(save).toBeDefined();
    expect(host.querySelector('[aria-label="Recent sessions"]')!.contains(save!)).toBe(true);
    await act(async () => save!.click());
    await type("#saved-search-name", "Collapsed");
    await act(async () => host.querySelector<HTMLFormElement>("#saved-search-name")!.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(JSON.parse(savedPref!).items[0]).toMatchObject({ name: "Collapsed", query: "collapsed query" });
    await type('[aria-label="Search all conversations"]', "other");
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Collapsed")!.click());
    expect(host.querySelector<HTMLInputElement>('[aria-label="Search all conversations"]')?.value).toBe("collapsed query");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("replaying a saved search returns to the library from an open session", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const definition = { version: 1, items: [{ id: "123e4567-e89b-42d3-a456-426614174011", name: "Open session replay",
    query: "Needles", filters: { project: null, agent: null, starredOnly: false, includeArchived: false,
      dateFrom: "", dateThrough: "", model: "", host: "" }, sort: "relevance" }] };
  const searchGrouped = vi.fn(async () => ({ groups: [], total_sessions: 0, total_message_matches: 0 }));
  const api: WorkbenchBackend = { ...backend, libraryOptions, listSessions: async () => [session], listProjects: async () => [],
    getPref: async key => key === "saved_searches_v1" ? JSON.stringify(definition) : null,
    getSession: async () => session, getTranscript: async () => [], searchGrouped,
    sessionPage: async (_query, offset, limit) => ({ items: [session].slice(offset, offset + limit), total: 1, offset, limit }),
    onLibraryChanged: async () => () => {} };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".session-card")!.click());
    expect(host.querySelector(".transcript-pane h2")?.textContent).toBe(session.title);
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Open session replay")!.click());
    expect(host.querySelector<HTMLInputElement>('[aria-label="Search all conversations"]')?.value).toBe("Needles");
    expect(host.textContent).toContain("All your agent sessions");
    expect(host.querySelector(".transcript-pane h2")?.textContent).toBe("Pick up where you left off");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("Escape closes saved-search forms and focus returns to the control that opened them", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let stored: string | null = null;
  const api: WorkbenchBackend = { ...backend, libraryOptions, listSessions: async () => [session], listProjects: async () => [], listBookmarks: async () => [],
    getPref: async key => key === "saved_searches_v1" ? stored : null,
    setPref: async (key, value) => { if (key === "saved_searches_v1") stored = value; },
    sessionPage: async (_query, offset, limit) => ({ items: [session].slice(offset, offset + limit), total: 1, offset, limit }),
    searchGrouped: async () => ({ groups: [], total_sessions: 0, total_message_matches: 0 }), onLibraryChanged: async () => () => {} };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const button = (text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === text)!;
  const inputValue = async (selector: string, value: string) => act(async () => {
    const input = host.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const escape = (selector: string) => act(async () => {
    host.querySelector(selector)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  try {
    await act(async () => root.render(<Workbench api={api} />));
    await inputValue('[aria-label="Search all conversations"]', "timeout");
    await act(async () => button("Save current search").click());
    await escape("#saved-search-name");
    expect(host.querySelector("#saved-search-name")).toBeNull();
    expect(document.activeElement).toBe(button("Save current search"));

    await act(async () => button("Save current search").click());
    await inputValue("#saved-search-name", "Timeouts");
    await act(async () => host.querySelector<HTMLFormElement>("#saved-search-name")!.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await settle();
    expect(host.querySelector("#saved-search-name")).toBeNull();
    expect(document.activeElement).toBe(button("Save current search"));

    await act(async () => button("Rename").click());
    await inputValue('input[id^="saved-search-rename-"]', "Changed");
    await escape('input[id^="saved-search-rename-"]');
    expect(host.querySelector('input[id^="saved-search-rename-"]')).toBeNull();
    expect(host.textContent).toContain("Timeouts");
    expect(document.activeElement).toBe(button("Rename"));

    await act(async () => button("Remove").click());
    await settle();
    expect(host.textContent).not.toContain("Timeouts");
    expect(document.activeElement).toBe(button("Save current search"));
  } finally { await act(async () => root.unmount()); host.remove(); }
});
