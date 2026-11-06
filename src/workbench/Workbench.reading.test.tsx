// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { Workbench } from "./Workbench";
import { backend, type BookmarkView, type SessionMeta, type TranscriptMessage, type WorkbenchBackend } from "./api";
import { emptyLibraryApi, libraryOptions, session, withSyntheticTranscriptSnapshot } from "./workbench-test-utils";

vi.mock("./SessionTerminal", () => ({ SessionTerminal: () => null }));

afterEach(() => { document.body.innerHTML = ""; vi.useRealTimers(); });


test("Continue reading is an explicit jump to the current exact anchor", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const transcript: TranscriptMessage[] = [
    { seq: 7, role: "assistant", kind: "text", text: "Saved content", timestamp: null, model: null, thinking: null, tool_calls: [], images: [] },
    { seq: 9, role: "assistant", kind: "text", text: "Requested evidence", timestamp: null, model: null, thinking: null, tool_calls: [], images: [] },
  ];
  const fingerprint = "b".repeat(64);
  const record = { session_key_hash: "a".repeat(64), seq: 0, anchor: fingerprint, before: [], after: [],
    at_start: true, at_end: true, saved_at: 10, generation: 1 };
  const api: WorkbenchBackend = { ...backend, libraryOptions, listSessions: async () => [session], listProjects: async () => [],
    getSession: async () => session, getTranscript: async () => transcript,
    getTranscriptSnapshot: async () => ({ session_key_hash: record.session_key_hash, messages: transcript, fingerprints: [fingerprint, "d".repeat(64)] }),
    getPref: async key => key === "reading_positions_v1" ? JSON.stringify({ version: 1, records: [record] }) : null,
    onLibraryChanged: async () => () => {} };
  api.sessionPage = async (_query, offset, limit) => ({ items: [session].slice(offset, offset + limit), total: 1, offset, limit });
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Workbench api={api} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".session-card")!.click());
    expect(host.querySelector("#message-7")).not.toBeNull();
    expect(scroll).not.toHaveBeenCalled();
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Continue reading"]')
      ?? Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === "Continue reading");
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: expect.any(String) });
    expect(scroll.mock.instances.at(-1)).toBe(host.querySelector("#message-7"));
    expect(host.textContent).toContain("Continued from saved position");
    scroll.mockClear();
    await act(async () => root.render(<Workbench api={api} openRequest={{ key: session.key, seq: 9, token: 1 }} />));
    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: expect.any(String) });
    expect(scroll.mock.instances.at(-1)).toBe(host.querySelector("#message-9"));
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("a stale saved anchor reports its state and never moves the transcript", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const transcript: TranscriptMessage[] = [{ seq: 8, role: "assistant", kind: "text", text: "Changed message",
    timestamp: null, model: null, thinking: null, tool_calls: [], images: [] }];
  const record = { session_key_hash: "a".repeat(64), seq: 0, anchor: "c".repeat(64), before: [], after: [],
    at_start: true, at_end: true, saved_at: 10, generation: 1 };
  const api: WorkbenchBackend = { ...backend, libraryOptions, listSessions: async () => [session], listProjects: async () => [],
    getSession: async () => session, getTranscript: async () => transcript,
    getTranscriptSnapshot: async () => ({ session_key_hash: record.session_key_hash, messages: transcript, fingerprints: ["b".repeat(64)] }),
    getPref: async key => key === "reading_positions_v1" ? JSON.stringify({ version: 1, records: [record] }) : null,
    onLibraryChanged: async () => () => {} };
  api.sessionPage = async (_query, offset, limit) => ({ items: [session].slice(offset, offset + limit), total: 1, offset, limit });
  const scroll = vi.fn(); Element.prototype.scrollIntoView = scroll;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Workbench api={api} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".session-card")!.click());
    expect(host.textContent).toContain("Saved place no longer matches this transcript");
    expect(Array.from(host.querySelectorAll("button")).some(button => button.textContent === "Continue reading")).toBe(false);
    expect(scroll).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("Continue is unavailable while the selected session is showing its terminal", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  const transcript: TranscriptMessage[] = [{ seq: 0, role: "assistant", kind: "text", text: "Saved content",
    timestamp: null, model: null, thinking: null, tool_calls: [], images: [] }];
  const record = { session_key_hash: "a".repeat(64), seq: 0, anchor: "b".repeat(64), before: [], after: [],
    at_start: true, at_end: true, saved_at: 10, generation: 1 };
  const prefWrites: string[] = [];
  const api: WorkbenchBackend = { ...backend, libraryOptions, listSessions: async () => [session], listProjects: async () => [],
    getSession: async () => session, getTranscript: async () => transcript,
    getTranscriptSnapshot: async () => ({ session_key_hash: record.session_key_hash, messages: transcript, fingerprints: [record.anchor] }),
    getPref: async key => key === "reading_positions_v1" ? JSON.stringify({ version: 1, records: [record] }) : null,
    inspectResume: async () => ({ supported: true, ready: true, host: null, original_directory: session.project_path,
      directory: session.project_path, program: "codex", args: [], command: "codex resume one", reasons: [] }),
    setPref: async (key, value) => { prefWrites.push(`${key}:${value}`); }, listSessionLabels: async () => [],
    onLibraryChanged: async () => () => {} };
  api.sessionPage = async (_query, offset, limit) => ({ items: [session].slice(offset, offset + limit), total: 1, offset, limit });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Workbench api={api} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".session-card")!.click());
    expect(Array.from(host.querySelectorAll("button")).some(button => button.textContent === "Continue reading")).toBe(true);
    const resume = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Resume")!;
    await act(async () => resume.click());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector('[role="tablist"][aria-label="Terminal"]')).not.toBeNull();
    expect(Array.from(host.querySelectorAll("button")).some(button => button.textContent === "Continue reading")).toBe(false);
    const transcriptPane = host.querySelector<HTMLElement>('[aria-label="Session transcript"]')!;
    await act(async () => { transcriptPane.dispatchEvent(new Event("wheel", { bubbles: true })); transcriptPane.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(prefWrites.some(value => value.startsWith("reading_positions_v1:"))).toBe(false);
  } finally {
    await act(async () => root.unmount()); host.remove();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  }
});

test("only a settled deliberate transcript gesture saves; boundary input and filter layout do not", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  const transcript: TranscriptMessage[] = [{ seq: 0, role: "user", kind: "text", text: "Prompt",
    timestamp: null, model: null, thinking: null, tool_calls: [], images: [] }];
  const writes = vi.fn(async (_key: string, _value: string) => {});
  const api: WorkbenchBackend = { ...backend, libraryOptions, listSessions: async () => [session], listProjects: async () => [],
    getSession: async () => session, getTranscript: async () => transcript,
    getTranscriptSnapshot: async () => ({ session_key_hash: "a".repeat(64), messages: transcript, fingerprints: ["b".repeat(64)] }),
    getPref: async () => null, setPref: writes, onLibraryChanged: async () => () => {} };
  api.sessionPage = async (_query, offset, limit) => ({ items: [session].slice(offset, offset + limit), total: 1, offset, limit });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Workbench api={api} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".session-card")!.click());
    const container = host.querySelector<HTMLElement>('[aria-label="Session transcript"]')!;
    const article = host.querySelector<HTMLElement>("#message-0")!;
    container.getBoundingClientRect = () => ({ top: 0, bottom: 400, left: 0, right: 800, width: 800, height: 400, x: 0, y: 0, toJSON: () => ({}) });
    article.getBoundingClientRect = () => ({ top: 20, bottom: 120, left: 0, right: 800, width: 800, height: 100, x: 0, y: 20, toJSON: () => ({}) });
    await act(async () => { container.dispatchEvent(new Event("wheel", { bubbles: true })); container.dispatchEvent(new Event("scroll", { bubbles: true })); await vi.advanceTimersByTimeAsync(241); });
    expect(writes.mock.calls.filter(([key]) => key === "reading_positions_v1")).toHaveLength(1);

    await act(async () => { container.dispatchEvent(new Event("touchmove", { bubbles: true })); container.dispatchEvent(new Event("scroll", { bubbles: true })); await vi.advanceTimersByTimeAsync(241); });
    expect(writes.mock.calls.filter(([key]) => key === "reading_positions_v1")).toHaveLength(2);
    await act(async () => { container.focus(); container.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }));
      container.dispatchEvent(new Event("scroll")); await vi.advanceTimersByTimeAsync(241); });
    expect(writes.mock.calls.filter(([key]) => key === "reading_positions_v1")).toHaveLength(3);
    const copyButton = host.querySelector<HTMLButtonElement>('button[aria-label="Copy message 0"]')!;
    await act(async () => { copyButton.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }));
      container.dispatchEvent(new Event("scroll")); await vi.advanceTimersByTimeAsync(241); });
    expect(writes.mock.calls.filter(([key]) => key === "reading_positions_v1")).toHaveLength(3);

    await act(async () => { container.dispatchEvent(new Event("wheel", { bubbles: true })); await vi.advanceTimersByTimeAsync(701); });
    await act(async () => { container.dispatchEvent(new Event("scroll", { bubbles: true })); await vi.advanceTimersByTimeAsync(300); });
    expect(writes.mock.calls.filter(([key]) => key === "reading_positions_v1")).toHaveLength(3);

    const promptsOnly = Array.from(host.querySelectorAll("label")).find(label => label.textContent?.includes("Prompts only"))!.querySelector("input")!;
    await act(async () => { container.dispatchEvent(new Event("wheel", { bubbles: true })); promptsOnly.click(); });
    await act(async () => { container.dispatchEvent(new Event("scroll", { bubbles: true })); await vi.advanceTimersByTimeAsync(300); });
    expect(writes.mock.calls.filter(([key]) => key === "reading_positions_v1")).toHaveLength(3);

    await act(async () => { container.dispatchEvent(new Event("wheel", { bubbles: true })); });
    await act(async () => { root.render(<Workbench api={api} isActive={false} />); await vi.advanceTimersByTimeAsync(300); });
    await act(async () => { container.dispatchEvent(new Event("scroll", { bubbles: true })); await vi.advanceTimersByTimeAsync(300); });
    expect(writes.mock.calls.filter(([key]) => key === "reading_positions_v1")).toHaveLength(3);
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); }
});

test("captured A survives A→B, queued writes merge latest records, and a newer A replaces only A", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  const remote = { ...session, key: "codex:buildbox:one", host: "buildbox", title: "Remote session" };
  const transcript: TranscriptMessage[] = [{ seq: 4, role: "assistant", kind: "text", text: "Same visible content",
    timestamp: null, model: null, thinking: null, tool_calls: [], images: [] }];
  const readingWrites: string[] = [];
  let releaseFirst!: () => void;
  const api: WorkbenchBackend = { ...backend, libraryOptions, listSessions: async () => [session, remote], listProjects: async () => [],
    getSession: async key => key === remote.key ? remote : session, getTranscript: async () => transcript,
    getTranscriptSnapshot: async key => ({ session_key_hash: key === remote.key ? "c".repeat(64) : "a".repeat(64),
      messages: transcript, fingerprints: ["b".repeat(64)] }), getPref: async () => null,
    setPref: async (key, value) => {
      if (key !== "reading_positions_v1") return;
      readingWrites.push(value);
      if (readingWrites.length === 1) await new Promise<void>(resolve => { releaseFirst = resolve; });
    }, onLibraryChanged: async () => () => {} };
  api.sessionPage = async (_query, offset, limit) => {
    const rows = [session, remote].slice(offset, offset + limit);
    return { items: rows, total: 2, offset, limit };
  };
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const choose = async (title: string) => act(async () => {
    Array.from(host.querySelectorAll<HTMLButtonElement>(".session-card")).find(card => card.textContent?.includes(title))!.click();
  });
  const scrollDeliberately = async () => act(async () => {
    const container = host.querySelector<HTMLElement>('[aria-label="Session transcript"]')!;
    const article = host.querySelector<HTMLElement>("article[id^='message-']")!;
    container.getBoundingClientRect = () => ({ top: 0, bottom: 400, left: 0, right: 800, width: 800, height: 400, x: 0, y: 0, toJSON: () => ({}) });
    article.getBoundingClientRect = () => ({ top: 20, bottom: 120, left: 0, right: 800, width: 800, height: 100, x: 0, y: 20, toJSON: () => ({}) });
    container.dispatchEvent(new Event("wheel", { bubbles: true })); container.dispatchEvent(new Event("scroll", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(241);
  });
  try {
    await act(async () => { root.render(<Workbench api={api} />); await Promise.resolve(); await Promise.resolve(); });
    await choose(session.title);
    await act(async () => {
      const container = host.querySelector<HTMLElement>('[aria-label="Session transcript"]')!;
      container.dispatchEvent(new Event("wheel", { bubbles: true })); container.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await choose(remote.title);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(readingWrites).toHaveLength(0); // Selection cancels an uncaptured A gesture.
    await choose(session.title); await scrollDeliberately();
    expect(readingWrites).toHaveLength(1);
    await choose(remote.title); await scrollDeliberately();
    expect(readingWrites).toHaveLength(1); // B is queued behind A's deferred write.
    await act(async () => { releaseFirst(); await Promise.resolve(); await Promise.resolve(); });
    expect(readingWrites).toHaveLength(2);
    let saved = JSON.parse(readingWrites.at(-1)!) as { version: number; records: { session_key_hash: string; generation: number }[] };
    expect(saved.records.map(record => record.session_key_hash).sort()).toEqual(["a".repeat(64), "c".repeat(64)]);
    await choose(session.title); await scrollDeliberately();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    saved = JSON.parse(readingWrites.at(-1)!) as typeof saved;
    expect(saved.records).toHaveLength(2);
    expect(saved.records.find(record => record.session_key_hash === "a".repeat(64))?.generation).toBe(2);
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); }
});
