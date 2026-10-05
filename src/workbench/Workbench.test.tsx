// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";

MotionGlobalConfig.skipAnimations = true;
// happy-dom rejects cancelled native animations; use Motion’s JS renderer in this test environment.
Reflect.deleteProperty(Element.prototype, "animate");
import { Workbench } from "./Workbench";
import { backend, type BookmarkView, type SessionMeta, type TranscriptMessage, type WorkbenchBackend } from "./api";
vi.mock("./SessionTerminal", () => ({ SessionTerminal: () => null }));

const session: SessionMeta = {
  key: "codex:one", native_id: "one", agent: "codex", host: null, parent_key: null,
  title: "Fix search", project_path: "/projects/hello world", source_path: "/tmp/one.jsonl",
  created_at: 1_700_000_000_000, updated_at: 1_700_000_000_000, model: "gpt-5",
  source: "cli", tokens: 12, archived: false, metadata_only: false, can_delete: true,
  starred: false, pinned: false,
};

const libraryOptions = async () => ({agents:["codex" as const,"claude-code" as const],models:["gpt-5"],hosts:[],
  projects:[{path:session.project_path!,session_count:1,updated_at:session.updated_at}]});

const withSyntheticTranscriptSnapshot = (api: WorkbenchBackend): WorkbenchBackend => {
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
    setPref: async (key, value) => { prefWrites.push(`${key}:${value}`); },
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

afterEach(() => { document.body.innerHTML = ""; });

test("opens local project folders and keeps the path copyable on errors", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const openProjectFolder=vi.fn(async()=>{}),writeText=vi.fn(async()=>{});
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
  const api:WorkbenchBackend={...backend,libraryOptions,listSessions:async()=>[session],listProjects:async()=>[],
    getSession:async()=>session,getTranscript:async()=>[],openProjectFolder,onLibraryChanged:async()=>()=>{}};
  api.sessionPage=async(query,offset,limit)=>({items:[session],total:1,offset,limit});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const click=async(selector:string)=>{await act(async()=>host.querySelector<HTMLButtonElement>(selector)!.click());};
  const notices=()=>Array.from(host.querySelectorAll('[role="status"]')).map(node=>node.textContent);
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));
    await click('[aria-label="Recent sessions"] .session-card');
    await click('button[aria-label="Open project folder"]');
    expect(openProjectFolder).toHaveBeenCalledWith(session.key);
    expect(notices()).toContain("Opened project folder");
    await click('button[aria-label="Copy project path"]');
    expect(writeText).toHaveBeenCalledWith(session.project_path);
    expect(notices()).toContain("Project path copied");
    writeText.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    await click('button[aria-label="Copy project path"]');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not copy project path");
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("reveals eligible source files with generic native errors", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  Object.defineProperty(window,"__TAURI_INTERNALS__",{configurable:true,value:{invoke:async()=>[]}});
  const revealSourceFile=vi.fn(async()=>{}),scan=vi.fn(async()=>({discovered:0,indexed:0,unchanged:0,errors:[]}));
  let failReload=false;
  const api:WorkbenchBackend={...backend,libraryOptions,listSessions:async()=>[session],listProjects:async()=>[],
    getSession:async()=>session,getTranscript:async()=>[],getPref:async()=>null,listBookmarks:async()=>[],scan,
    inspectResume:async()=>({supported:false,ready:false,host:null,original_directory:null,directory:null,program:null,args:[],command:null,reasons:[]}),
    sessionRelationships:async()=>({parent:null,children:[],related:[],candidate_limit:20}),
    revealSourceFile,onLibraryChanged:async()=>()=>{}};
  api.sessionPage=async(_query,offset,limit)=>{if(failReload)throw new Error("synthetic library refresh failure");return {items:[session],total:1,offset,limit};};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const click=async(selector:string)=>{await act(async()=>host.querySelector<HTMLButtonElement>(selector)!.click());};
  const notices=()=>Array.from(host.querySelectorAll('[role="status"]')).map(node=>node.textContent);
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));
    await click('[aria-label="Recent sessions"] .session-card');
    expect(host.querySelector('button[aria-label="Reveal source file"]')).not.toBeNull();
    await click('button[aria-label="Reveal source file"]');
    expect(revealSourceFile).toHaveBeenCalledWith(session.key);
    expect(notices()).toContain("Revealed source file in Finder");
    revealSourceFile.mockRejectedValueOnce(new Error("/private/secret/path"));
    await click('button[aria-label="Reveal source file"]');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not reveal source file");
    expect(host.textContent).not.toContain("/private/secret/path");
    expect(host.querySelector('[role="alert"] button[aria-label="Dismiss"]')).not.toBeNull();
    expect(Array.from(host.querySelectorAll('[role="alert"] button')).map(button=>button.textContent)).toEqual(["×"]);
    expect(notices()).not.toContain("Revealed source file in Finder");
    await click('[role="alert"] button[aria-label="Dismiss"]');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await click('button[aria-label="Reveal source file"]');
    expect(notices()).toContain("Revealed source file in Finder");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    failReload=true;
    await click('button[aria-label="Refresh library"]');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("synthetic library refresh failure");
    expect(host.querySelector('[role="alert"] button')?.textContent).toBe("Retry refresh");
    failReload=false;
    await act(async()=>{host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();await new Promise(resolve=>setTimeout(resolve,0));});
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(scan).toHaveBeenCalledTimes(1);
  } finally {await act(async()=>root.unmount());host.remove();Reflect.deleteProperty(window,"__TAURI_INTERNALS__");}
});

test("shows the fixed Desktop-required preview response without exposing command errors", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  Reflect.deleteProperty(window,"__TAURI_INTERNALS__");
  const revealSourceFile=vi.fn(async()=>{throw new Error("Desktop required: sample sessions cannot reveal a source file.");});
  const api:WorkbenchBackend={...backend,libraryOptions,listSessions:async()=>[session],listProjects:async()=>[],
    getSession:async()=>session,getTranscript:async()=>[],revealSourceFile,onLibraryChanged:async()=>()=>{}};
  api.sessionPage=async(query,offset,limit)=>({items:[session],total:1,offset,limit});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Recent sessions"] .session-card')!.click());
    await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Reveal source file"]')!.click());
    expect(revealSourceFile).toHaveBeenCalledWith(session.key);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Desktop required: sample sessions cannot reveal a source file.");
    expect(host.querySelector('[role="alert"] button[aria-label="Dismiss"]')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).not.toMatch(/Retry (scan|refresh)/);
    await act(async()=>host.querySelector<HTMLButtonElement>('[role="alert"] button[aria-label="Dismiss"]')!.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("Refresh library announces partial and clean local reports, clears stale feedback on failure, and accepts retry", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  let report={discovered:2,indexed:1,unchanged:0,errors:["/Users/refresh-secret-canary/session.jsonl parser-secret-canary"]};
  let rejectScan=false;
  const scan=vi.fn(async()=>{if(rejectScan)throw new Error("synthetic scan failure");return report;});
  const api:WorkbenchBackend={...backend,libraryOptions,listSessions:async()=>[session],listProjects:async()=>[],
    getSession:async()=>session,getTranscript:async()=>[],scan,onLibraryChanged:async()=>()=>{}};
  api.sessionPage=async(query,offset,limit)=>({items:[session],total:1,offset,limit});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const refresh=()=>host.querySelector<HTMLButtonElement>('button[aria-label="Refresh library"]')!;
  const click=async()=>act(async()=>{refresh().click();await new Promise(resolve=>setTimeout(resolve,0));});
  const summary=()=>Array.from(host.querySelectorAll('[role="status"]')).map(node=>node.textContent??"").find(text=>/local scan/i.test(text));
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));
    await click();
    expect(summary()).toContain("Partial local scan");
    expect(summary()).toContain("scan errors: 1");
    expect(host.textContent).not.toMatch(/refresh-secret-canary|parser-secret-canary/);
    rejectScan=true;
    await click();
    expect(summary()).toBeUndefined();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Local scan failed: Error: synthetic scan failure");
    expect(host.querySelector('[role="alert"] button')?.textContent).toBe("Retry scan");
    rejectScan=false;report={discovered:8,indexed:3,unchanged:4,errors:[]};
    await act(async()=>{host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();await new Promise(resolve=>setTimeout(resolve,0));});
    expect(scan).toHaveBeenCalledTimes(3);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(summary()).toContain("Local scan complete");
    expect(summary()).toContain("session sources discovered: 8");
    expect(summary()).not.toContain("Partial");
    report={discovered:0,indexed:0,unchanged:0,errors:[]};
    await click();
    expect(summary()).toContain("No local sessions discovered");
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("Workbench disables the refresh action while a scan promise is pending", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  let finish:(value:{discovered:number;indexed:number;unchanged:number;errors:string[]})=>void=()=>{};
  const scan=vi.fn(()=>new Promise<{discovered:number;indexed:number;unchanged:number;errors:string[]}>(resolve=>{finish=resolve;}));
  const api:WorkbenchBackend={...backend,libraryOptions,listSessions:async()=>[session],listProjects:async()=>[],getSession:async()=>session,
    getTranscript:async()=>[],scan,onLibraryChanged:async()=>()=>{}};
  api.sessionPage=async(query,offset,limit)=>({items:[session],total:1,offset,limit});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));
    await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Refresh library"]')!.click());
    expect(scan).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Refresh library"]')!.disabled).toBe(true);
    await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Refresh library"]')!.click());
    expect(scan).toHaveBeenCalledTimes(1);
    await act(async()=>finish({discovered:1,indexed:1,unchanged:0,errors:[]}));
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Refresh library"]')!.disabled).toBe(false);
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("copies only each nonempty user or assistant text message as exact Markdown", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const writeText=vi.fn(async()=>{});
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
  const original="  ## Café 🙂\n\n```ts\nconst x = 1;\n```\n";
  const transcript:TranscriptMessage[]=[
    {seq:1,role:"assistant",kind:"text",text:original,timestamp:null,model:null,thinking:"private thought",tool_calls:[{id:"t",name:"tool",input:"private input",output:"private output",is_error:false}],images:[]},
    {seq:2,role:"user",kind:"text",text:"Find naïve ünicode",timestamp:null,model:null,thinking:null,tool_calls:[],images:[]},
    {seq:3,role:"assistant",kind:"text",text:" \n ",timestamp:null,model:null,thinking:null,tool_calls:[],images:[]},
    {seq:4,role:"system",kind:"text",text:"system text",timestamp:null,model:null,thinking:null,tool_calls:[],images:[]},
    {seq:5,role:"assistant",kind:"meta",text:"summary text",timestamp:null,model:null,thinking:null,tool_calls:[],images:[]},
  ];
  const api:WorkbenchBackend={...backend,libraryOptions,listSessions:async()=>[session],listProjects:async()=>[],getSession:async()=>session,
    getTranscript:async()=>transcript,onLibraryChanged:async()=>()=>{}};
  api.sessionPage=async(query,offset,limit)=>({items:[session],total:1,offset,limit});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const click=async(seq:number)=>{await act(async()=>{host.querySelector<HTMLButtonElement>(`#message-${seq} button[aria-label="Copy message ${seq}"]`)!.click();await Promise.resolve();});};
  const notice=()=>Array.from(host.querySelectorAll('[role="status"]')).find(node=>node.textContent?.includes("Message copied"));
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Recent sessions"] .session-card')!.click());
    expect(host.querySelectorAll('button[aria-label^="Copy message"]')).toHaveLength(2);
    await click(1);
    expect(writeText).toHaveBeenLastCalledWith(original);
    expect(notice()?.textContent).toContain("Message copied");
    await click(2);
    expect(writeText).toHaveBeenLastCalledWith("Find naïve ünicode");
    expect(writeText).toHaveBeenCalledTimes(2);
    writeText.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    await click(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not copy message: Error: Clipboard unavailable");
    expect(host.querySelector('#message-1')).not.toBeNull();
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("keeps bookmark drafts across browsing and shared editors, with explicit save and discard", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const other={...session,key:"codex:two",native_id:"two",title:"Other session"};
  let notes:BookmarkView[]=[session,other].map(row=>({session:row,status:"current",bookmark:{session_key:row.key,seq:1,
    note:`Saved ${row.native_id}`,excerpt:"Assistant decision",text_hash:"a".repeat(64),created_at:1,updated_at:2,
    title:row.title,agent:row.agent,project_path:row.project_path}}));
  let fail=false,failRefresh=false;
  const save=vi.fn(async(key:string,_seq:number,note:string,_refresh:boolean,expected:number|null)=>{
    const row=notes.find(row=>row.bookmark.session_key===key)!;
    if(fail || expected!==row.bookmark.updated_at)throw new Error("Synthetic note conflict");
    row.bookmark={...row.bookmark,note,updated_at:row.bookmark.updated_at+1};return row.bookmark;
  });
  const api:WorkbenchBackend={...backend,libraryOptions,listSessions:async()=>[session,other],listProjects:async()=>[],
    getSession:async key=>key===session.key?session:other,
    getTranscript:async()=>[{seq:1,role:"assistant",kind:"text",text:"Assistant decision",timestamp:null,model:null,thinking:null,tool_calls:[],images:[]}],
    listBookmarks:async()=>{if(failRefresh)throw new Error("Synthetic list failure");return structuredClone(notes);},saveBookmark:save,
    deleteBookmark:async(key,seq)=>{notes=notes.filter(row=>row.bookmark.session_key!==key || row.bookmark.seq!==seq);},
    onLibraryChanged:async()=>()=>{}};
  api.sessionPage=async(query,offset,limit)=>{const items=await api.listSessions(query);return {items,total:items.length,offset,limit};};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const button=(scope:ParentNode,text:string)=>Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(button=>button.textContent?.trim()===text)!;
  const click=async(scope:ParentNode,text:string)=>{await act(async()=>button(scope,text).click());};
  const row=(title:string)=>Array.from(host.querySelectorAll('[aria-label="Bookmarks"] .session-card')).find(card=>card.textContent?.includes(title))!.parentElement!;
  const transcript=()=>host.querySelector('#message-1')!;
  const input=async(field:HTMLInputElement|HTMLTextAreaElement,value:string)=>{await act(async()=>{
    Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value")!.set!.call(field,value);
    field.dispatchEvent(new Event("input",{bubbles:true}));
  });};
  const choose=async(title:string)=>{await act(async()=>Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="Recent sessions"] .session-card')).find(card=>card.textContent?.includes(title))!.click());};
  const reopen=async(scope:ParentNode)=>{await click(scope,"Edit bookmark note for message 1");return scope.querySelector<HTMLTextAreaElement>("textarea")!;};
  const draft="Retained café ü <plain> note";
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));await click(host,"Bookmarks2");
    await input(await reopen(row(session.title)),draft);
    await click(row(session.title),"Edit bookmark note for message 1");
    await click(host,"All sessions2");await click(host,"Bookmarks2");
    expect((await reopen(row(session.title))).value).toBe(draft);
    await input(host.querySelector<HTMLInputElement>('[aria-label="Search bookmarks"]')!,"Other session");
    expect(host.textContent).not.toContain(draft);
    await input(host.querySelector<HTMLInputElement>('[aria-label="Search bookmarks"]')!,"");
    expect((await reopen(row(session.title))).value).toBe(draft);
    await act(async()=>row(session.title).querySelector<HTMLButtonElement>('.session-card')!.click());
    expect((await reopen(transcript())).value).toBe(draft);
    await input(transcript().querySelector<HTMLTextAreaElement>("textarea")!,draft+" shared");
    expect(row(session.title).querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(draft+" shared");
    const prompts=Array.from(host.querySelectorAll("label")).find(label=>label.textContent?.includes("Prompts only"))!.querySelector<HTMLInputElement>("input")!;
    await act(async()=>prompts.click());expect(transcript()).toBeNull();
    await act(async()=>prompts.click());expect((await reopen(transcript())).value).toBe(draft+" shared");
    await click(host,"All sessions2");await choose(other.title);
    expect((await reopen(transcript())).value).toBe("Saved two");
    await input(transcript().querySelector<HTMLTextAreaElement>("textarea")!,"Independent B draft");
    await choose(session.title);expect((await reopen(transcript())).value).toBe(draft+" shared");
    fail=true;await click(transcript(),"Save note");
    expect(transcript().textContent).toContain("Synthetic note conflict");
    expect(transcript().querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(draft+" shared");
    expect(save.mock.calls.at(-1)).toEqual([session.key,1,draft+" shared",false,2]);
    await click(transcript(),"Cancel note");expect((await reopen(transcript())).value).toBe("Saved one");
    await input(transcript().querySelector<HTMLTextAreaElement>("textarea")!,"Discard with Escape");
    await act(async()=>transcript().querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));
    expect((await reopen(transcript())).value).toBe("Saved one");
    await choose(other.title);expect((await reopen(transcript())).value).toBe("Independent B draft");
    fail=false;failRefresh=true;await click(transcript(),"Save note");
    expect(transcript().textContent).toContain("Note saved, but refreshing bookmarks failed");
    expect(transcript().querySelector("textarea")).toBeNull();
    expect((await reopen(transcript())).value).toBe("Independent B draft");
    await input(transcript().querySelector<HTMLTextAreaElement>("textarea")!,"Saved after refresh failure");
    failRefresh=false;await click(transcript(),"Save note");
    expect(save.mock.calls.at(-1)).toEqual([other.key,1,"Saved after refresh failure",false,3]);
    expect(notes.find(row=>row.bookmark.session_key===other.key)!.bookmark.note).toBe("Saved after refresh failure");
    await click(transcript(),"Remove bookmark 1");expect(notes).toHaveLength(1);
    await choose(session.title);await input(await reopen(transcript()),"Keep through external changes");
    notes[0].bookmark={...notes[0].bookmark,note:"External note",updated_at:99};
    const refresh=async()=>{
      await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)} isActive={false}/>));
      await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));
      if(!transcript().querySelector("textarea"))await reopen(transcript());
    };
    await refresh();expect(transcript().querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Keep through external changes");
    expect(transcript().textContent).toContain("The saved note changed while you were editing");
    await click(transcript(),"Save note");expect(save.mock.calls.at(-1)?.[4]).toBe(2);
    expect(notes[0].bookmark.note).toBe("External note");
    notes=[];await refresh();expect(transcript().textContent).toContain("The saved bookmark was removed");
    expect(button(transcript(),"Save note").disabled).toBe(true);
    await click(transcript(),"Cancel note");expect(button(transcript(),"Bookmark message 1")).toBeDefined();
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("a pending bookmark save locks its shared editors without clearing another session's draft", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const other={...session,key:"codex:two",native_id:"two",title:"Other session"};
  const notes:BookmarkView[]=[session,other].map(row=>({session:row,status:"current",bookmark:{session_key:row.key,seq:1,note:"Saved",excerpt:"Decision",text_hash:"a".repeat(64),created_at:1,updated_at:2,title:row.title,agent:row.agent,project_path:row.project_path}}));
  let finish!:(saved:BookmarkView["bookmark"])=>void;
  const save=vi.fn(async()=>new Promise<BookmarkView["bookmark"]>(resolve=>{finish=resolve;}));
  const api:WorkbenchBackend={...backend,libraryOptions,listSessions:async()=>[session,other],listProjects:async()=>[],
    listBookmarks:async()=>structuredClone(notes),saveBookmark:save,getSession:async key=>key===session.key?session:other,
    getTranscript:async()=>[{seq:1,role:"assistant",kind:"text",text:"Decision",timestamp:null,model:null,thinking:null,tool_calls:[],images:[]}],onLibraryChanged:async()=>()=>{}};
  api.sessionPage=async(query,offset,limit)=>{const items=await api.listSessions(query);return {items,total:items.length,offset,limit};};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const row=(title:string)=>Array.from(host.querySelectorAll('[aria-label="Bookmarks"] .session-card')).find(card=>card.textContent?.includes(title))!.parentElement!;
  const click=async(scope:ParentNode,text:string)=>{await act(async()=>Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(button=>button.textContent?.trim()===text)!.click());};
  const type=async(scope:ParentNode,text:string)=>{await act(async()=>{
    const field=scope.querySelector<HTMLTextAreaElement>("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,text);field.dispatchEvent(new Event("input",{bubbles:true}));
  });};
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));await click(host,"Bookmarks2");
    await click(row(session.title),"Edit bookmark note for message 1");await type(row(session.title),"Submitted A");
    await click(row(session.title),"Save note");expect(row(session.title).querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
    await act(async()=>row(session.title).querySelector<HTMLButtonElement>('.session-card')!.click());
    const duplicate=host.querySelector('#message-1')!;
    expect(Array.from(duplicate.querySelectorAll<HTMLButtonElement>("button")).find(button=>button.textContent==="Edit bookmark note for message 1")!.disabled).toBe(true);
    await click(row(other.title),"Edit bookmark note for message 1");await type(row(other.title),"Independent B ü");
    await click(host,"All sessions2");await click(host,"Bookmarks2");
    await click(row(other.title),"Edit bookmark note for message 1");
    notes[0].bookmark={...notes[0].bookmark,note:"Submitted A",updated_at:3};
    await act(async()=>finish(notes[0].bookmark));
    expect(row(other.title).querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Independent B ü");
    expect(row(session.title).textContent).toContain("Submitted A");
    await click(row(session.title),"Edit bookmark note for message 1");
    expect(row(session.title).querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Submitted A");
    expect(save.mock.calls).toHaveLength(1);
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("bookmarks search saved notes, filter missing projects, and open messages outside prompts-only view", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const available: BookmarkView = {session,status:"current",bookmark:{session_key:session.key,seq:1,note:"Retain search decision",excerpt:"Assistant decision",text_hash:"a".repeat(64),created_at:1,updated_at:2,title:session.title,agent:session.agent,project_path:session.project_path}};
  const missing: BookmarkView = {session:null,status:"unavailable",bookmark:{...available.bookmark,session_key:"claude-code:gone",agent:"claude-code",project_path:"/projects/removed",title:"Removed session",note:"Retain missing source",updated_at:3}};
  const api: WorkbenchBackend = {...backend, libraryOptions,listBookmarks:async()=>[missing,available],listSessions:async()=>[session],listProjects:async()=>[],getSession:async()=>session,
    getTranscript:async()=>[{seq:1,role:"assistant",kind:"text",text:"Assistant decision",timestamp:null,model:null,thinking:null,tool_calls:[],images:[]}],
    onLibraryChanged:async()=>()=>{},searchGrouped:async()=>({groups:[],total_sessions:0,total_message_matches:0})};
  api.sessionPage = async (query,offset,limit) => { const items=await api.listSessions(query); return {items:items.slice(offset,offset+limit),total:items.length,offset,limit}; };
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const button=(text:string)=>Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button=>button.textContent?.trim()===text)!;
  const click=async(text:string)=>{await act(async()=>button(text).click());};
  const search=async(value:string)=>{await act(async()=>{
    const input=host.querySelector<HTMLInputElement>('input[aria-label="Search bookmarks"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);
    input.dispatchEvent(new Event("input",{bubbles:true}));
  });};
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));
    await click("Bookmarks2");
    const pane=host.querySelector('[aria-label="Bookmarks"]')!;
    expect(pane.textContent).toContain("2 saved messages");
    expect(host.querySelector<HTMLButtonElement>('.session-card')!.disabled).toBe(true);
    await click("removed0");expect(pane.textContent).toContain("1 saved messages");
    expect(pane.textContent).not.toContain("Retain search decision");
    await click("Bookmarks2");await search("search decision");
    expect(pane.textContent).toContain("1 saved messages");
    await act(async()=>pane.querySelector<HTMLButtonElement>('.session-card')!.click());
    const prompts=Array.from(host.querySelectorAll("label")).find(label=>label.textContent?.includes("Prompts only"))!.querySelector<HTMLInputElement>("input")!;
    await act(async()=>prompts.click());expect(host.querySelector('#message-1')).toBeNull();
    await act(async()=>pane.querySelector<HTMLButtonElement>('.session-card')!.click());
    expect(prompts.checked).toBe(false);expect(host.querySelector('#message-1')).not.toBeNull();
    await search("missing source");
    await click("Edit bookmark note for message 1");
    const editor=host.querySelector<HTMLTextAreaElement>('textarea[rows="4"]')!;
    await act(async()=>editor.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,cancelable:true})));
    expect(document.activeElement).toBe(editor);
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("opens on the library home, then loads a session, shows its transcript, and stars it through the backend", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const setFlags = vi.fn(async () => {});
  let finishTranscript!: (messages: TranscriptMessage[]) => void;
  const transcript = new Promise<TranscriptMessage[]>(resolve => { finishTranscript = resolve; });
  const api: WorkbenchBackend = { ...backend, libraryOptions, listBookmarks: async()=>[],
    listSessions: async () => [session],
    getSession: async () => session,
    getTranscript: async () => transcript,
    searchSessions: async () => [], searchGrouped: async () => ({groups:[],total_sessions:0,total_message_matches:0}),
    searchSessionMatches: async () => ({matches:[],total_matches:0}), listProjects: async () => [{ path: "/projects/hello world", session_count: 1, updated_at: session.updated_at }],
    scan: async () => ({ discovered: 1, indexed: 1, unchanged: 0, errors: [] }),
    setSessionFlags: setFlags, resumeSession: async () => "", exportSession: async () => {},
    trashSession: async () => {}, onLibraryChanged: async () => () => {},
  };
  api.sessionPage = async (query,offset,limit) => { const items=await api.listSessions(query); return {items:items.slice(offset,offset+limit),total:items.length,offset,limit}; };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)} />); });
  expect(host.textContent).toContain("All your agent sessions");
  await act(async () => { host.querySelector<HTMLButtonElement>('.session-card')!.click(); });
  expect(host.querySelector('.transcript-skeleton')).not.toBeNull();
  await act(async () => { root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)} searchFocusToken={1} />); });
  expect(document.activeElement).toBe(host.querySelector('input[type="search"]'));
  await act(async () => { finishTranscript([{ seq: 0, role: "user", kind: "text", text: "Search for naïve ünicode",
    timestamp: null, model: null, thinking: null, tool_calls: [], images: [] }]); });
  expect(host.textContent).toContain("Search for naïve ünicode");
  expect(host.querySelector('[data-transcript-field="text"]')?.textContent).toContain("Search for naïve ünicode");
  const star = host.querySelector<HTMLButtonElement>('button[aria-label="Star"]');
  expect(star).not.toBeNull();
  await act(async () => { star!.click(); });
  expect(setFlags).toHaveBeenCalledWith("codex:one", true, false);
  await act(async () => { root.unmount(); });
});

test("coalesces library changes, refreshes open content and searches, and defers hidden refreshes", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  const listeners=new Set<()=>void>();
  const changed=()=>listeners.forEach(callback=>callback());
  let missing = false;
  let fail = false;
  let content: TranscriptMessage[] = [{ seq: 0, role: "user", kind: "text", text: "Original message", timestamp: null,
    model: null, thinking: null, tool_calls: [], images: [] }];
  const listSessions = vi.fn(async () => [session]);
  const getTranscript = vi.fn(async () => { if (fail) throw new Error("Temporary read failure"); return structuredClone(content); });
  const searchGrouped = vi.fn(async () => ({groups:[],total_sessions:0,total_message_matches:0}));
  const api: WorkbenchBackend = { ...backend, libraryOptions, listBookmarks: async()=>[],
    listSessions, getSession: async () => missing ? null : session,
    getTranscript, searchSessions: async () => [], searchGrouped,
    searchSessionMatches: async () => ({matches:[],total_matches:0}), listProjects: async () => [],
    scan: async () => ({ discovered: 1, indexed: 1, unchanged: 0, errors: [] }),
    setSessionFlags: async () => {}, resumeSession: async () => "", exportSession: async () => {}, trashSession: async () => {},
    onLibraryChanged: async callback => { listeners.add(callback); return () => {listeners.delete(callback);}; },
  };
  api.sessionPage = async (query,offset,limit) => { const items=await api.listSessions(query); return {items:items.slice(offset,offset+limit),total:items.length,offset,limit}; };
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const render = async (active = true) => { await act(async () => root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)} isActive={active} />)); };
  const notify = async () => { await act(async () => { changed(); changed(); await vi.advanceTimersByTimeAsync(401); }); };
  try {
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>('.session-card')!.click());
    expect(host.textContent).toContain("Original message");
    const container = host.querySelector<HTMLElement>('.transcript-messages')!.parentElement!;
    Object.defineProperties(container, { scrollHeight: { configurable: true, value: 2000 }, clientHeight: { configurable: true, value: 400 } });
    container.scrollTop = 100;
    const calls = getTranscript.mock.calls.length;
    content.push({ ...content[0], seq: 1, text: "Appended message" });
    await notify();
    expect(getTranscript).toHaveBeenCalledTimes(calls + 1);
    expect(host.textContent).toContain("Appended message");
    expect(container.scrollTop).toBe(100);
    expect(host.textContent).toContain("New messages");
    await act(async () => host.querySelector<HTMLButtonElement>('button')?.focus());
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'New messages ↓')!.click());
    expect(container.scrollTop).toBe(2000);
    content[0] = { ...content[0], text: "Edited message" };
    await notify(); expect(host.textContent).toContain("Edited message");
    fail = true;
    await notify(); expect(host.textContent).toContain("Temporary read failure");
    expect(host.textContent).toContain("Edited message"); fail = false;
    await act(async () => changed());
    await render(false);
    const pendingListCalls = listSessions.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(401); });
    expect(listSessions).toHaveBeenCalledTimes(pendingListCalls);
    const hiddenCalls = getTranscript.mock.calls.length;
    content.push({ ...content[0], seq: 2, text: "While hidden" });
    await notify(); expect(getTranscript).toHaveBeenCalledTimes(hiddenCalls);
    await render(); expect(host.textContent).toContain("While hidden");
    // Filtering the list must preserve an already-open transcript.
    api.listSessions = async () => [];
    await notify(); expect(host.textContent).toContain("While hidden");
    missing = true;
    await notify(); expect(host.textContent).toContain("Session no longer available");
    expect(host.textContent).toContain("While hidden");
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'message');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(121);
    });
    const searches = searchGrouped.mock.calls.length;
    await notify();
    await act(async () => { await vi.advanceTimersByTimeAsync(121); });
    expect(searchGrouped.mock.calls.length).toBeGreaterThan(searches);
  } finally { await act(async () => root.unmount()); vi.useRealTimers(); }
});

test("groups search, pages sessions and excerpts, respects archives, and rejects stale responses", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  const scroll = vi.fn(function(this: Element) { return this.id; });
  Element.prototype.scrollIntoView = scroll;
  const { backend } = await import("./api");
  const first = { ...session, title: "Needle result" };
  const second = { ...session, key: "codex:two", title: "Second result" };
  const excerpt = (seq: number) => ({seq, snippet:`Needle <img src=x onerror=alert(1)> match ${seq}`});
  const listeners=new Set<()=>void>();
  const changed=()=>listeners.forEach(callback=>callback());
  let totalSessions = 51;
  let finishSlow!: (value: import("./api").GroupedSearch) => void;
  const searchGrouped = vi.fn(async (query: string, _filter: unknown, _sort: unknown, offset: number) => {
    if (query === "slow") return new Promise<import("./api").GroupedSearch>(resolve => { finishSlow = resolve; });
    return {groups:[{session:offset ? second : first,title_match:true,message_matches:150,excerpts:[excerpt(0),excerpt(1),excerpt(2)]}],total_sessions:totalSessions,total_message_matches:151};
  });
  const searchSessionMatches = vi.fn(async (_query: string, _filter: unknown, _key: string, offset: number) => ({
    matches:Array.from({length:20},(_,i)=>excerpt(offset+i)),total_matches:150,
  }));
  let finishTranscript!: (messages: TranscriptMessage[]) => void;
  const delayedTranscript = new Promise<TranscriptMessage[]>(resolve => { finishTranscript = resolve; });
  const api: WorkbenchBackend = { ...backend, libraryOptions, listBookmarks: async()=>[],
    listSessions:async()=>[first,second],listProjects:async()=>[],getSession:async()=>first,
    getTranscript:async()=>delayedTranscript,
    searchGrouped,searchSessionMatches,onLibraryChanged:async callback=>{listeners.add(callback);return ()=>{listeners.delete(callback);};},
  };
  api.sessionPage = async (query,offset,limit) => { const items=await api.listSessions(query); return {items:items.slice(offset,offset+limit),total:items.length,offset,limit}; };
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const click = async (label: string) => { await act(async()=>{
    Array.from(host.querySelectorAll("button")).find(button=>button.textContent===label || button.getAttribute("aria-label")===label)!.click();
  }); };
  const type = async (value: string) => {
    await act(async()=>{
      const input=host.querySelector<HTMLInputElement>('input[type="search"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);
      input.dispatchEvent(new Event("input",{bubbles:true}));
    });
    await act(async()=>{await vi.advanceTimersByTimeAsync(121);});
  };
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));
    await type("needle");
    expect(host.querySelectorAll(".session-card")).toHaveLength(1);
    expect(host.textContent).toContain("Showing 1 of 51 sessions · 151 matching messages");
    expect(host.querySelector("mark")?.textContent?.toLowerCase()).toBe("needle");
    expect(host.querySelector("img")).toBeNull();
    expect(searchGrouped.mock.calls.at(-1)?.[1]).toMatchObject({include_archived:false});
    await click("Open message 2");expect(scroll).not.toHaveBeenCalled();
    expect(host.querySelector(".transcript-skeleton")).not.toBeNull();
    await act(async()=>finishTranscript([0,1,2].map(seq=>({seq,role:"assistant",kind:"text",text:`body ${seq}`,timestamp:null,model:null,thinking:null,tool_calls:[],images:[]}))));
    expect(scroll.mock.results.at(-1)?.value).toBe("message-2");
    await click("Find in transcript");
    // Toggle by label so this check covers the actual shared UI.
    const prompts = Array.from(host.querySelectorAll("label")).find(label=>label.textContent?.includes("Prompts only"))!.querySelector<HTMLInputElement>("input")!;
    if (!prompts.checked) await act(async()=>prompts.click());
    expect(host.querySelectorAll("article")).toHaveLength(0);
    await click("Open message 2");
    expect(prompts.checked).toBe(false);
    expect(host.querySelectorAll("article")).toHaveLength(3);
    expect(host.querySelector('input[aria-label="Find in transcript"]')).toBeNull();
    await click("Show all 150 matches");
    expect(searchSessionMatches.mock.calls.at(-1)?.slice(2)).toEqual([first.key,0,20]);
    expect(host.querySelectorAll('button[aria-label^="Open message"]')).toHaveLength(20);
    await click("Load more matches");
    expect(host.querySelectorAll('button[aria-label^="Open message"]')).toHaveLength(40);
    await click("Load more search results");await act(async()=>{await vi.advanceTimersByTimeAsync(121);});
    expect(searchGrouped.mock.calls.at(-1)?.slice(3)).toEqual([50,50]);
    expect(host.textContent).toContain("Second result");
    totalSessions = 1;
    await act(async()=>{changed();await vi.advanceTimersByTimeAsync(401);});
    await act(async()=>{await vi.advanceTimersByTimeAsync(121);});
    await act(async()=>{await vi.advanceTimersByTimeAsync(121);});
    expect(searchGrouped.mock.calls.at(-1)?.slice(3)).toEqual([0,50]);
    expect(host.querySelectorAll(".session-card")).toHaveLength(1);
    totalSessions = 51;
    await act(async()=>{
      const select=host.querySelector<HTMLSelectElement>('select[aria-label="Sort search results"]')!;
      select.value="recent";select.dispatchEvent(new Event("change",{bubbles:true}));
    });
    await act(async()=>{await vi.advanceTimersByTimeAsync(121);});
    expect(searchGrouped.mock.calls.at(-1)?.slice(2)).toEqual(["recent",0,50]);
    await click("Include archived");await act(async()=>{await vi.advanceTimersByTimeAsync(121);});
    expect(searchGrouped.mock.calls.at(-1)?.[1]).toMatchObject({include_archived:true});
    await type("slow");await type("fast");
    await act(async()=>finishSlow({groups:[],total_sessions:0,total_message_matches:0}));
    expect(host.querySelectorAll(".session-card")).toHaveLength(1);
    expect(host.textContent).toContain("Needle result");
  } finally {await act(async()=>root.unmount());vi.useRealTimers();}
});

test("full-library choices combine filters, preserve hidden selection, and reject inverted local dates", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const {matchesSession} = await import("./library-filters");
  const list = vi.fn(async (query: import("./api").SessionQuery)=>matchesSession(session,query) ? [session] : []);
  const api: WorkbenchBackend = {...backend,listSessions:list,libraryOptions:async()=>({...await libraryOptions(),models:["gpt-5","off-page-model"],hosts:["local"]}),
    listBookmarks:async()=>[],getSession:async()=>session,getTranscript:async()=>[],onLibraryChanged:async()=>()=>{}};
  api.sessionPage = async (query,offset,limit) => { const items=await api.listSessions(query); return {items:items.slice(offset,offset+limit),total:items.length,offset,limit}; };
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const change=async(label:string,value:string)=>{await act(async()=>{
    const input=host.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype,"value")!.set!.call(input,value);
    input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input",{bubbles:true}));
  });};
  const clear=async()=>{await act(async()=>Array.from(host.querySelectorAll("button")).find(button=>button.textContent === "Clear filters")!.click());};
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));
    await act(async()=>host.querySelector<HTMLButtonElement>('.session-card')!.click());
    await change("Filter by model","off-page-model");
    expect(list.mock.calls.at(-1)?.[0].model).toBe("off-page-model");
    expect(host.textContent).toContain("Outside current filters");
    expect(host.querySelector<HTMLHeadingElement>('.transcript-pane h2')?.textContent).toBe(session.title);
    expect(host.querySelector('option[value="remote:local"]')).not.toBeNull();
    await change("Filter by host","remote:local");
    expect(list.mock.calls.at(-1)?.[0]).toMatchObject({host:"local",local_only:false,model:"off-page-model"});
    await change("Filter by host","local");
    expect(list.mock.calls.at(-1)?.[0]).toMatchObject({host:null,local_only:true});
    await clear();expect(host.textContent).not.toContain("Outside current filters");
    await change("Updated from","2030-01-01");
    const calls=list.mock.calls.length;
    await change("Updated through","2020-01-01");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("End date");
    expect(list).toHaveBeenCalledTimes(calls);
    await clear();expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(list.mock.calls.at(-1)?.[0]).toMatchObject({updated_from_ms:null,updated_before_ms:null,model:null,host:null,local_only:false});
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("complete browsing appends unique pages, resets on query changes, and discards pages invalidated by index updates", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.useFakeTimers();
  let changed=()=>{};
  const rows=Array.from({length:601},(_,i)=>({...session,key:`codex:${i.toString().padStart(3,"0")}`,title:`Browse example ${i}`}));
  let slow=false, finish!: (page: import("./api").SessionPage)=>void;
  const page=vi.fn(async (_query:import("./api").SessionQuery,offset:number,limit:number)=>{
    if (slow && offset) return new Promise<import("./api").SessionPage>(resolve=>{finish=resolve;});
    // Include an overlapping key to check deduplication without changing the next raw offset.
    return {items:rows.slice(offset,offset+limit),total:rows.length,offset,limit};
  });
  const api: WorkbenchBackend={...backend,libraryOptions,listBookmarks:async()=>[],sessionPage:page,
    searchGrouped:async()=>({groups:[],total_sessions:0,total_message_matches:0}),onLibraryChanged:async callback=>{changed=callback;return ()=>{};}};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const more=()=>Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button=>button.textContent === "Load more sessions")!;
  const type=async(value:string)=>{await act(async()=>{
    const input=host.querySelector<HTMLInputElement>('input[type="search"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);
    input.dispatchEvent(new Event("input",{bubbles:true}));
    await vi.advanceTimersByTimeAsync(121);
  });};
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));
    expect(host.textContent).toContain("Showing 100 of 601 sessions");
    expect(host.querySelector('dl')?.textContent).toContain("601");
    for (let i=0;i<6;i++) await act(async()=>more().click());
    expect(host.querySelectorAll('.session-card')).toHaveLength(601);
    expect(more()).toBeUndefined();
    expect(page.mock.calls.map(call=>call[1])).toEqual([0,100,200,300,400,500,600]);
    await type("different query");await type("");
    expect(host.querySelectorAll('.session-card')).toHaveLength(100);
    slow=true;await act(async()=>more().click());
    const late=finish;
    await act(async()=>changed());
    expect(more().disabled).toBe(true);
    await act(async()=>late({items:[rows[0],rows[100]],total:601,offset:100,limit:100}));
    expect(host.querySelectorAll('.session-card')).toHaveLength(100);
    await act(async()=>vi.advanceTimersByTimeAsync(401));
    slow=false;await act(async()=>more().click());
    expect(host.querySelectorAll('.session-card')).toHaveLength(200);
    slow=true;await act(async()=>more().click());
    await act(async()=>finish({items:[rows[0],rows[200]],total:601,offset:200,limit:100}));
    expect(host.querySelectorAll('.session-card')).toHaveLength(201);
    expect(new Set(Array.from(host.querySelectorAll('.session-card')).map(card=>card.textContent)).size).toBe(201);
    await act(async()=>more().click());
    const oldFilterPage=finish;
    await act(async()=>{
      const field=host.querySelector<HTMLSelectElement>('[aria-label="Filter by host"]')!;
      field.value="local";field.dispatchEvent(new Event("change",{bubbles:true}));
    });
    await act(async()=>oldFilterPage({items:[rows[600]],total:601,offset:202,limit:100}));
    expect(host.querySelectorAll('.session-card')).toHaveLength(100);

  } finally {await act(async()=>root.unmount());vi.useRealTimers();host.remove();}
},15_000);

test("restores validated filter preferences and serializes the last choice without saving search text", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const saved={project:null,agent:null,starredOnly:false,includeArchived:true,dateFrom:"2026-01-01",dateThrough:"2026-12-31",model:"gpt-5",host:"remote:local",searchSort:"recent"};
  const writes:string[]=[];let firstDone!:()=>void;
  const api:WorkbenchBackend={...backend,libraryOptions:async()=>({...await libraryOptions(),models:["gpt-5","new-model"],hosts:["local"]}),
    getPref:async()=>JSON.stringify(saved),setPref:async(_key,value)=>{writes.push(value);if(writes.length === 1) await new Promise<void>(resolve=>{firstDone=resolve;});},
    sessionPage:async(_query,offset,limit)=>({items:[],total:0,offset,limit}),listBookmarks:async()=>[],onLibraryChanged:async()=>()=>{}};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const select=async(label:string,value:string)=>{await act(async()=>{
    const field=host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
    field.value=value;field.dispatchEvent(new Event("change",{bubbles:true}));
  });};
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));
    expect(host.querySelector<HTMLInputElement>('[aria-label="Updated from"]')?.value).toBe(saved.dateFrom);
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Filter by host"]')?.value).toBe("remote:local");
    await select("Filter by model","new-model");await select("Filter by host","local");
    expect(writes).toHaveLength(1);
    await act(async()=>firstDone());
    expect(JSON.parse(writes.at(-1)!)).toMatchObject({...saved,model:"new-model",host:"local"});
    expect(JSON.parse(writes.at(-1)!)).not.toHaveProperty("search");
  } finally {await act(async()=>root.unmount());host.remove();}
});

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
