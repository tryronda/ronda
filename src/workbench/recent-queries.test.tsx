// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { MotionGlobalConfig } from "motion/react";
import { expect, test, vi } from "vitest";
MotionGlobalConfig.skipAnimations = true;
Reflect.deleteProperty(Element.prototype, "animate");
import { RECENT_QUERIES_KEY, parseRecentQueries, recordRecentQuery, useRecentQueries } from "./recent-queries";
import { RecentQueries, RecentQueriesRecovery } from "./RecentQueries";
import { backend } from "./api";
import { Workbench } from "./Workbench";
import { installDemoBackend, uninstallDemoBackend } from "../../site/preview/demo";

test("records distinct trimmed queries newest first and caps at eight", () => {
  expect(recordRecentQuery([], "   ")).toEqual([]);
  let items: string[] = [];
  for (let i = 1; i <= 10; i++) items = recordRecentQuery(items, ` q${i} `);
  expect(items).toEqual(["q10", "q9", "q8", "q7", "q6", "q5", "q4", "q3"]);
  expect(recordRecentQuery(items, "q5")[0]).toBe("q5");
  expect(recordRecentQuery(items, "q5")).toHaveLength(8);
  expect(recordRecentQuery(items, "q10")).toBe(items);
  expect(recordRecentQuery(items, "Q10")[0]).toBe("Q10");
  expect(recordRecentQuery(items, "x".repeat(513))).toBe(items);
});

test("parses strictly", () => {
  expect(parseRecentQueries(null)).toEqual({ ok: true, document: { version: 1, items: [] } });
  expect(parseRecentQueries('{"version":1,"items":["a","b"]}').ok).toBe(true);
  for (const bad of ["{", "[]", '{"version":2,"items":[]}', '{"version":1,"items":["a","a"]}', '{"version":1,"items":[" a"]}',
    '{"version":1,"items":[""]}', '{"version":1,"items":[1]}', '{"version":1,"items":[],"x":1}',
    `{"version":1,"items":${JSON.stringify(Array.from({ length: 9 }, (_, i) => `q${i}`))}}`]) expect(parseRecentQueries(bad).ok, bad).toBe(false);
});

function mount(api: { getPref: (k: string) => Promise<string | null>; setPref: (k: string, v: string) => Promise<void> }) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const ref: { current?: ReturnType<typeof useRecentQueries> } = {};
  function Probe() { const value = useRecentQueries(api); useEffect(() => { ref.current = value; }); return null; }
  return { ref, render: () => act(async () => root.render(<Probe />)), done: async () => { await act(async () => root.unmount()); host.remove(); } };
}

test("hook persists, removes and clears; corrupt preference is never overwritten", async () => {
  const store = new Map<string, string>([[RECENT_QUERIES_KEY, '{"version":1,"items":["old"]}']]);
  const api = { getPref: async (k: string) => store.get(k) ?? null, setPref: vi.fn(async (k: string, v: string) => { store.set(k, v); }) };
  const view = mount(api); await view.render();
  expect(view.ref.current!.items).toEqual(["old"]);
  await act(async () => view.ref.current!.record("fresh"));
  expect(JSON.parse(store.get(RECENT_QUERIES_KEY)!).items).toEqual(["fresh", "old"]);
  await act(async () => view.ref.current!.remove("old"));
  expect(view.ref.current!.items).toEqual(["fresh"]);
  await act(async () => view.ref.current!.clear());
  expect(JSON.parse(store.get(RECENT_QUERIES_KEY)!).items).toEqual([]);
  await view.done();

  const bad = { getPref: async () => "not json", setPref: vi.fn(async () => {}) };
  const broken = mount(bad); await broken.render();
  expect(broken.ref.current!.status).toBe("invalid");
  await act(async () => { broken.ref.current!.record("x"); broken.ref.current!.clear(); });
  expect(bad.setPref).not.toHaveBeenCalled();
  await broken.done();
});

test("reset writes an empty valid document only on explicit action; retry re-reads", async () => {
  const store = new Map<string, string>([[RECENT_QUERIES_KEY, "garbage"]]);
  const api = { getPref: async (k: string) => store.get(k) ?? null, setPref: vi.fn(async (k: string, v: string) => { store.set(k, v); }) };
  const view = mount(api); await view.render();
  expect(view.ref.current!.status).toBe("invalid");
  expect(api.setPref).not.toHaveBeenCalled();
  await act(async () => { await view.ref.current!.reset(); });
  expect(store.get(RECENT_QUERIES_KEY)).toBe('{"version":1,"items":[]}');
  expect(view.ref.current!.status).toBe("ready");
  await act(async () => view.ref.current!.record("again"));
  expect(JSON.parse(store.get(RECENT_QUERIES_KEY)!).items).toEqual(["again"]);
  await view.done();

  let fail = true;
  const flaky = { getPref: async () => { if (fail) throw new Error("x"); return null; }, setPref: vi.fn(async () => {}) };
  const second = mount(flaky); await second.render();
  expect(second.ref.current!.status).toBe("unavailable");
  fail = false;
  await act(async () => { second.ref.current!.retry(); });
  expect(second.ref.current!.status).toBe("ready");
  expect(flaky.setPref).not.toHaveBeenCalled();
  await second.done();
});

test("recovery notice: reset only for invalid, retry for unavailable", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const h = { onReset: vi.fn(), onRetry: vi.fn() };
  const labels = () => Array.from(host.querySelectorAll("button")).map(b => b.textContent);
  await act(async () => root.render(<RecentQueriesRecovery status="invalid" {...h} />));
  expect(labels()).toEqual(["Reset recent searches"]);
  await act(async () => host.querySelector("button")!.click()); expect(h.onReset).toHaveBeenCalled();
  await act(async () => root.render(<RecentQueriesRecovery status="unavailable" {...h} />));
  expect(labels()).toEqual(["Retry"]);
  await act(async () => host.querySelector("button")!.click()); expect(h.onRetry).toHaveBeenCalled();
  await act(async () => root.unmount()); host.remove();
});

test("component applies, removes and clears with the keyboard-accessible controls", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const h = { onApply: vi.fn(), onRemove: vi.fn(), onClear: vi.fn() };
  await act(async () => root.render(<RecentQueries items={["alpha", "beta"]} {...h} />));
  const button = (name: string) => Array.from(host.querySelectorAll("button")).find(b => b.textContent === name || b.getAttribute("aria-label") === name)!;
  await act(async () => button("beta").click()); expect(h.onApply).toHaveBeenCalledWith("beta");
  await act(async () => button("Remove recent search alpha").click()); expect(h.onRemove).toHaveBeenCalledWith("alpha");
  await act(async () => button("Clear recent").click()); expect(h.onClear).toHaveBeenCalled();
  expect(host.querySelectorAll("li")).toHaveLength(2);
  await act(async () => root.render(<RecentQueries items={[]} {...h} />));
  expect(host.textContent).toBe("");
  await act(async () => root.unmount()); host.remove();
});

test("canary: diagnostics and bookmark export never read preferences", () => {
  const lib = readFileSync("src-tauri/src/lib.rs", "utf8");
  const diagnostics = lib.slice(lib.indexOf("fn diagnostics_report("), lib.indexOf("fn error(e: impl"));
  expect(diagnostics.length).toBeGreaterThan(100);
  expect(diagnostics).not.toMatch(/pref_get|get_pref|recent_queries/);
  const bookmarks = readFileSync("crates/ronda-core/src/bookmarks.rs", "utf8");
  const exporter = bookmarks.slice(bookmarks.indexOf("pub fn export_bookmarks("), bookmarks.indexOf("pub fn export_bookmarks(") + 1500);
  expect(exporter).not.toMatch(/pref_get|recent_queries/);
});

test("Workbench records a completed search once and offers it under the empty focused box", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); installDemoBackend();
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const prefs = new Map<string, string>();
  const api = { ...backend, getPref: async (k: string) => prefs.get(k) ?? (await backend.getPref(k)), setPref: async (k: string, v: string) => { prefs.set(k, v); } };
  try {
    await act(async () => root.render(<Workbench api={api} />));
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    for (const text of ["s", "session"]) {
      await act(async () => { set.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    }
    expect(JSON.parse(prefs.get(RECENT_QUERIES_KEY)!).items).toEqual(["session", "s"]);
    await act(async () => { set.call(input, ""); input.dispatchEvent(new Event("input", { bubbles: true })); input.focus(); });
    const panel = host.querySelector('section[aria-label="Recent searches"]');
    expect(panel?.textContent).toContain("session");
    await act(async () => Array.from(panel!.querySelectorAll("button")).find(b => b.textContent === "session")!.click());
    expect(input.value).toBe("session");
    expect(host.querySelector('section[aria-label="Recent searches"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); uninstallDemoBackend(); }
}, 20000);
