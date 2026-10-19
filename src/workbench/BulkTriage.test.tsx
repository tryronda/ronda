// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";

MotionGlobalConfig.skipAnimations = true;
Reflect.deleteProperty(Element.prototype, "animate");
import { Workbench } from "./Workbench";
import { labelStatus, nextFlags, planLabelChange, rangeKeys } from "./BulkTriage";
import { backend, type SessionMeta, type WorkbenchBackend } from "./api";
vi.mock("./SessionTerminal", () => ({ SessionTerminal: () => null }));

const LABEL = "0000000000000000000000000000aa01";
const make = (index: number): SessionMeta => ({
  key: `codex:s${index}`, native_id: `s${index}`, agent: "codex", host: null, parent_key: null,
  title: `Session ${index}`, project_path: "/projects/demo", source_path: `/tmp/s${index}.jsonl`,
  created_at: 1_700_000_000_000, updated_at: 1_700_000_000_000 - index, model: "gpt-5",
  source: "cli", tokens: 12, archived: false, metadata_only: false, can_delete: true,
  starred: index === 1, pinned: index === 2, labels: index < 2 ? [LABEL] : [],
});
const options = { agents: ["codex" as const], models: ["gpt-5"], hosts: [],
  projects: [{ path: "/projects/demo", session_count: 5, updated_at: 1_700_000_000_000 }] };
const transcript = [{ seq: 0, role: "assistant" as const, kind: "text" as const, text: "Hello", timestamp: null,
  model: null, thinking: null, tool_calls: [], images: [] }];

const FULL = ["0000000000000000000000000000bb01", "0000000000000000000000000000bb02", "0000000000000000000000000000bb03", "0000000000000000000000000000bb04"];
function fakeApi(patch: (rows: SessionMeta[]) => SessionMeta[] = rows => rows) {
  let rows = patch([0, 1, 2, 3, 4].map(make));
  const setLabel = vi.fn(async (key: string, labelId: string, assigned: boolean) => {
    rows = rows.map(row => row.key !== key ? row : { ...row,
      labels: assigned ? [...(row.labels ?? []), labelId] : (row.labels ?? []).filter(id => id !== labelId) });
  });
  const bulk = vi.fn(async (updates: [string, boolean, boolean][]) => {
    let applied = 0;
    rows = rows.map(row => { const hit = updates.find(update => update[0] === row.key); if (!hit) return row; applied++; return { ...row, starred: hit[1], pinned: hit[2] }; });
    return applied;
  });
  const api: WorkbenchBackend = { ...backend, libraryOptions: async () => options, listProjects: async () => [],
    listBookmarks: async () => [], onLibraryChanged: async () => () => {}, getPref: async () => null, setPref: async () => {},
    listSessionLabels: async () => [{ id: LABEL, name: "Keep", created_at: 1, updated_at: 1 }],
    sessionPage: async (query, offset, limit) => {
      const items = rows.filter(row => !query.label_id || row.labels?.includes(query.label_id));
      return { items: items.slice(offset, offset + limit), total: items.length, offset, limit };
    },
    getSession: async key => rows.find(row => row.key === key) ?? null, getTranscript: async () => transcript,
    getTranscriptSnapshot: async () => ({ session_key_hash: "a".repeat(64), messages: transcript, fingerprints: ["c".repeat(64)] }),
    searchGrouped: async () => ({ groups: [], total_sessions: 0, total_message_matches: 0 }),
    setSessionFlagsBulk: bulk, setSessionLabel: setLabel };
  return { api, bulk, setLabel, rows: () => rows };
}

async function mount(api: WorkbenchBackend) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Workbench api={api} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const cards = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLButtonElement>(".session-card"));
const click = (element: Element, init: MouseEventInit = {}) => act(async () => {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
});
const key = (element: Element, init: KeyboardEventInit) => act(async () => {
  element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
});
const bar = (host: HTMLElement) => host.querySelector('[role="toolbar"][aria-label="Bulk session actions"]');
const action = (host: HTMLElement, text: string) => Array.from(bar(host)!.querySelectorAll("button")).find(item => item.textContent === text)!;
const pressed = (host: HTMLElement) => cards(host).map(card => card.getAttribute("aria-pressed") === "true");
const status = (host: HTMLElement) => host.querySelector('[role="status"][aria-live="polite"]')!.textContent;
const set = async (host: HTMLElement, selector: string, value: string, event = "change") => act(async () => {
  const input = host.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event(event, { bubbles: true }));
});

test("range and flag helpers", () => {
  const order = ["a", "b", "c", "d"];
  expect(rangeKeys(order, "b", "d")).toEqual(["b", "c", "d"]);
  expect(rangeKeys(order, "d", "b")).toEqual(["b", "c", "d"]);
  expect(rangeKeys(order, null, "c")).toEqual(["c"]);
  expect(rangeKeys(order, "gone", "c")).toEqual(["c"]);
  expect(rangeKeys(order, "a", "gone")).toEqual([]);
  expect(nextFlags("star", { starred: false, pinned: true })).toEqual({ starred: true, pinned: true });
  expect(nextFlags("unpin", { starred: true, pinned: true })).toEqual({ starred: true, pinned: false });
});

test("plain click opens a session and never selects; modifier clicks select without opening", async () => {
  const { api } = fakeApi();
  const { host, unmount } = await mount(api);
  try {
    expect(bar(host)).toBeNull();
    await click(cards(host)[0]);
    expect(cards(host)[0].getAttribute("aria-current")).toBe("true");
    expect(bar(host)).toBeNull();
    await click(cards(host)[2], { metaKey: true });
    expect(pressed(host)).toEqual([false, false, true, false, false]);
    expect(cards(host)[0].getAttribute("aria-current")).toBe("true");
    expect(cards(host)[2].getAttribute("aria-current")).toBeNull();
    expect(bar(host)!.textContent).toContain("1 selected");
    await click(cards(host)[4], { ctrlKey: true });
    await click(cards(host)[2], { ctrlKey: true });
    expect(pressed(host)).toEqual([false, false, false, false, true]);
    expect(bar(host)!.textContent).toContain("1 selected");
  } finally { await unmount(); }
});

test("shift-click and keyboard select ranges; Escape and Clear selection empty the set", async () => {
  const { api } = fakeApi();
  const { host, unmount } = await mount(api);
  try {
    await click(cards(host)[1], { metaKey: true });
    await click(cards(host)[3], { shiftKey: true });
    expect(pressed(host)).toEqual([false, true, true, true, false]);
    await click(action(host, "Clear selection"));
    expect(bar(host)).toBeNull();

    const first = cards(host)[0]; first.focus();
    await key(first, { key: " " });
    expect(pressed(host)).toEqual([true, false, false, false, false]);
    await key(first, { key: "ArrowDown", shiftKey: true });
    await key(cards(host)[1], { key: "ArrowDown", shiftKey: true });
    expect(pressed(host)).toEqual([true, true, true, false, false]);
    expect(document.activeElement).toBe(cards(host)[2]);
    await key(cards(host)[2], { key: " " });
    expect(pressed(host)).toEqual([true, true, false, false, false]);
    await key(cards(host)[2], { key: "Escape" });
    expect(bar(host)).toBeNull();
    expect(pressed(host)).toEqual([false, false, false, false, false]);
  } finally { await unmount(); }
});

test("bulk actions change one flag, announce the count, and undo restores exact previous pairs", async () => {
  const fake = fakeApi();
  const { host, unmount } = await mount(fake.api);
  try {
    await click(cards(host)[0], { metaKey: true });
    await click(cards(host)[2], { shiftKey: true });
    expect(bar(host)!.textContent).not.toMatch(/trash|delete|archive/i);
    await click(action(host, "Star"));
    expect(fake.bulk).toHaveBeenLastCalledWith([["codex:s0", true, false], ["codex:s1", true, false], ["codex:s2", true, true]]);
    expect(status(host)).toBe("Starred 3 sessions");
    await click(action(host, "Unpin"));
    expect(fake.bulk).toHaveBeenLastCalledWith([["codex:s0", true, false], ["codex:s1", true, false], ["codex:s2", true, false]]);
    expect(status(host)).toBe("Unpinned 3 sessions");
    await click(action(host, "Undo"));
    expect(fake.bulk).toHaveBeenLastCalledWith([["codex:s0", true, false], ["codex:s1", true, false], ["codex:s2", true, true]]);
    expect(status(host)).toBe("Undid unpinned for 3 sessions");
    expect((action(host, "Undo") as HTMLButtonElement).disabled).toBe(true);
    await click(action(host, "Unstar"));
    await click(action(host, "Undo"));
    expect(fake.rows().map(row => [row.starred, row.pinned])).toEqual([[true, false], [true, false], [true, true], [false, false], [false, false]]);
  } finally { await unmount(); }
});

test("selection and undo reset when the search or a filter changes", async () => {
  const { api } = fakeApi();
  const { host, unmount } = await mount(api);
  try {
    await click(cards(host)[0], { metaKey: true });
    await click(action(host, "Star"));
    expect(status(host)).toBe("Starred 1 session");
    await set(host, 'input[type="search"]', "zzz");
    expect(bar(host)).toBeNull();
    await set(host, 'input[type="search"]', "");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
    expect(pressed(host).some(Boolean)).toBe(false);
    expect(bar(host)).toBeNull();

    await click(cards(host)[3], { metaKey: true });
    expect(bar(host)).not.toBeNull();
    await set(host, '[aria-label="Filter by label"]', LABEL);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(cards(host)).toHaveLength(2);
    expect(bar(host)).toBeNull();
    expect(status(host)).toBe("");
  } finally { await unmount(); }
});

test("planLabelChange adds, removes, skips sessions at the cap, and leaves no-ops alone", () => {
  const rows = [{ key: "a", labels: [] }, { key: "b", labels: [LABEL] }, { key: "c", labels: FULL }, { key: "d" }];
  expect(planLabelChange(rows, LABEL, "add")).toEqual({
    changes: [{ key: "a", previous: [], next: [LABEL] }, { key: "d", previous: [], next: [LABEL] }], skipped: 1 });
  expect(planLabelChange(rows, LABEL, "remove")).toEqual({ changes: [{ key: "b", previous: [LABEL], next: [] }], skipped: 0 });
  // A session at the cap that already has the label is a no-op, not a skip.
  expect(planLabelChange([{ key: "e", labels: [...FULL.slice(0, 3), LABEL] }], LABEL, "add")).toEqual({ changes: [], skipped: 0 });
  expect(labelStatus("add", 5, 2)).toBe("Labeled 5 sessions, skipped 2 at the label limit");
  expect(labelStatus("add", 1, 0)).toBe("Labeled 1 session");
  expect(labelStatus("remove", 2, 0)).toBe("Removed label from 2 sessions");
});

test("bulk label add skips sessions at the cap, announces the result, and undo restores exact arrays", async () => {
  const fake = fakeApi(rows => rows.map((row, index) => index === 3 ? { ...row, labels: FULL } : index === 4 ? { ...row, labels: [FULL[0]] } : row));
  const { host, unmount } = await mount(fake.api);
  try {
    await click(cards(host)[2], { metaKey: true });
    await click(cards(host)[4], { shiftKey: true });
    await set(host, "#bulk-label", LABEL);
    await click(action(host, "Add label"));
    expect(fake.setLabel.mock.calls).toEqual([["codex:s2", LABEL, true], ["codex:s4", LABEL, true]]);
    expect(status(host)).toBe("Labeled 2 sessions, skipped 1 at the label limit");
    expect(fake.rows().map(row => row.labels)).toEqual([[LABEL], [LABEL], [LABEL], FULL, [FULL[0], LABEL]]);
    await click(action(host, "Undo"));
    expect(fake.rows().map(row => row.labels)).toEqual([[LABEL], [LABEL], [], FULL, [FULL[0]]]);
    expect(status(host)).toBe("Undid add label for 2 sessions");

    await click(cards(host)[0], { metaKey: true });
    await click(cards(host)[1], { shiftKey: true });
    await click(action(host, "Remove label"));
    expect(status(host)).toBe("Removed label from 2 sessions");
    expect(fake.rows().map(row => row.labels?.length)).toEqual([0, 0, 0, 4, 1]);
    await click(action(host, "Undo"));
    expect(fake.rows().slice(0, 2).map(row => row.labels)).toEqual([[LABEL], [LABEL]]);
  } finally { await unmount(); }
});

test("Cmd/Ctrl-A in the list selects every loaded row, is ignored in inputs, and Escape clears", async () => {
  const { api } = fakeApi();
  const { host, unmount } = await mount(api);
  try {
    const first = cards(host)[0]; first.focus();
    await key(first, { key: "a", metaKey: true });
    expect(pressed(host)).toEqual([true, true, true, true, true]);
    expect(bar(host)!.textContent).toContain("5 selected");
    await key(cards(host)[0], { key: "Escape" });
    expect(bar(host)).toBeNull();
    await key(first, { key: "a", ctrlKey: true });
    expect(bar(host)!.textContent).toContain("5 selected");
    await click(action(host, "Clear selection"));
    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await key(search, { key: "a", metaKey: true });
    expect(bar(host)).toBeNull();
    await key(first, { key: "a" });
    expect(bar(host)).toBeNull();
  } finally { await unmount(); }
});

test("the Filters summary counts active filters and Clear resets them without toggling the disclosure", async () => {
  const { api } = fakeApi();
  const { host, unmount } = await mount(api);
  try {
    const summary = () => host.querySelector("details > summary")!;
    const clear = () => Array.from(summary().querySelectorAll("button")).find(item => item.textContent === "Clear");
    expect(summary().textContent).toBe("Filters");
    expect(clear()).toBeUndefined();
    await set(host, 'input[aria-label="Updated from"]', "2024-01-01", "input");
    expect(summary().textContent).toContain("Filters (1)");
    await set(host, 'select[aria-label="Filter by model"]', "gpt-5");
    await click(Array.from(host.querySelectorAll("button")).find(item => item.getAttribute("aria-pressed") !== null && item.textContent === "Include archived")!);
    expect(summary().textContent).toContain("Filters (3)");
    expect(summary().querySelector("[aria-label]")!.getAttribute("aria-label")).toBe("Filters (3), 3 active");
    // happy-dom does not implement summary toggling, so assert the default action is cancelled.
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => { clear()!.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(summary().textContent).toBe("Filters");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Updated from"]')!.value).toBe("");
  } finally { await unmount(); }
});

test("archived sessions show an Archived chip in the list", async () => {
  const { api } = fakeApi(rows => rows.map((row, index) => index === 3 ? { ...row, archived: true } : row));
  const { host, unmount } = await mount(api);
  try {
    expect(cards(host).map(card => card.textContent!.includes("Archived"))).toEqual([false, false, false, true, false]);
  } finally { await unmount(); }
});
