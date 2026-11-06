// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { Workbench } from "./Workbench";
import { backend, type BookmarkView, type SessionMeta, type TranscriptMessage, type WorkbenchBackend } from "./api";
import { emptyLibraryApi, libraryOptions, session, withSyntheticTranscriptSnapshot } from "./workbench-test-utils";

vi.mock("./SessionTerminal", () => ({ SessionTerminal: () => null }));

afterEach(() => { document.body.innerHTML = ""; vi.useRealTimers(); });


test("starred and pinned sessions are announced in the list", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const marked = { ...session, starred: true, pinned: true };
  const api: WorkbenchBackend = { ...backend, libraryOptions, listSessions: async () => [marked], listProjects: async () => [],
    getSession: async () => marked, getTranscript: async () => [], onLibraryChanged: async () => () => {} };
  api.sessionPage = async (_query, offset, limit) => ({ items: [marked].slice(offset, offset + limit), total: 1, offset, limit });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Workbench api={api} />));
    const card = host.querySelector(".session-card")!;
    expect(card.querySelector('[role="img"][aria-label="Starred"]')).not.toBeNull();
    expect(card.querySelector('[role="img"][aria-label="Pinned"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
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
    trashSession: async () => null, onLibraryChanged: async () => () => {},
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
  expect(star!.getAttribute("aria-pressed")).toBe("false");
  await act(async () => { star!.click(); });
  expect(setFlags).toHaveBeenCalledWith("codex:one", true, false);
  const after = host.querySelector<HTMLButtonElement>('button[aria-label="Star"]');
  expect(after?.getAttribute("aria-pressed")).toBe("true");
  expect(after?.title).toBe("Unstar");
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
    setSessionFlags: async () => {}, resumeSession: async () => "", exportSession: async () => {}, trashSession: async () => null,
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

test("an empty search explains active filters and Clear filters restores results", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const searchGrouped = vi.fn(async (_query: string, filter: { starred_only?: boolean }) => filter.starred_only
    ? { groups: [], total_sessions: 0, total_message_matches: 0 }
    : { groups: [{ session, title_match: true, message_matches: 0, excerpts: [] }], total_sessions: 1, total_message_matches: 0 });
  const api: WorkbenchBackend = { ...backend, libraryOptions, listSessions: async () => [session], listProjects: async () => [], listBookmarks: async () => [],
    sessionPage: async (_query, offset, limit) => ({ items: [session].slice(offset, offset + limit), total: 1, offset, limit }),
    searchGrouped, onLibraryChanged: async () => () => {} };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const button = (text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === text);
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
  try {
    await act(async () => root.render(<Workbench api={api} />));
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.includes("Starred"))!.click());
    const input = host.querySelector<HTMLInputElement>('[aria-label="Search all conversations"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "nothing here");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(host.textContent).toContain("No matching messages");
    expect(host.textContent).toContain("1 filter is active");
    expect(button("Include archived")).toBeDefined();
    await act(async () => button("Clear filters")!.click());
    await settle();
    expect(host.textContent).not.toContain("No matching messages");
    expect(host.querySelector(".session-card")).not.toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("the sidebar announces which library filter is active", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const api: WorkbenchBackend = { ...backend, libraryOptions, listSessions: async () => [session], listProjects: async () => [],
    getSession: async () => session, getTranscript: async () => [], onLibraryChanged: async () => () => {} };
  api.sessionPage = async (_query, offset, limit) => ({ items: [session].slice(offset, offset + limit), total: 1, offset, limit });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const find = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("aside button")].find(b => b.textContent?.includes(label))!;
  try {
    await act(async () => root.render(<Workbench api={api} />));
    expect(find("All sessions").getAttribute("aria-current")).toBe("true");
    expect(find("Bookmarks").hasAttribute("aria-current")).toBe(false);
    expect(find("Starred").getAttribute("aria-pressed")).toBe("false");
    expect(find("hello world").hasAttribute("aria-current")).toBe(false);
    await act(async () => find("Starred").click());
    expect(find("Starred").getAttribute("aria-pressed")).toBe("true");
    expect(find("All sessions").hasAttribute("aria-current")).toBe(false);
    await act(async () => find("Starred").click());
    await act(async () => find("hello world").click());
    expect(find("hello world").getAttribute("aria-current")).toBe("true");
    expect(find("All sessions").hasAttribute("aria-current")).toBe(false);
    await act(async () => find("Bookmarks").click());
    expect(find("Bookmarks").getAttribute("aria-current")).toBe("true");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("ArrowDown in the library search moves focus to the first session card", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const api: WorkbenchBackend = { ...backend, libraryOptions, listSessions: async () => [session], listProjects: async () => [],
    getSession: async () => session, getTranscript: async () => [], onLibraryChanged: async () => () => {} };
  api.sessionPage = async (_query, offset, limit) => ({ items: [session].slice(offset, offset + limit), total: 1, offset, limit });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Workbench api={api} />));
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.focus();
    const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    await act(async () => { input.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(host.querySelector(".session-card"));
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("Find history truncates a long tool output to the error history limit", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  const transcript:TranscriptMessage[]=[{seq:1,role:"assistant",kind:"text",text:"ok",timestamp:null,model:null,thinking:null,tool_calls:[{id:"t",name:"tool",input:"in",output:"x".repeat(25_000),is_error:true}],images:[]}];
  const api:WorkbenchBackend={...backend,libraryOptions,listSessions:async()=>[session],listProjects:async()=>[],getSession:async()=>session,
    getTranscript:async()=>transcript,onLibraryChanged:async()=>()=>{}};
  api.sessionPage=async(query,offset,limit)=>({items:[session],total:1,offset,limit});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Recent sessions"] .session-card')!.click());
    await act(async()=>Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent?.startsWith("Find history for"))!.click());
    const field=host.querySelector<HTMLTextAreaElement>('dialog[aria-labelledby="error-history-heading"] textarea')!;
    expect(field.value).toHaveLength(20_000);
    expect(host.textContent).not.toContain("1 to 20,000 characters");
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("Long thinking is clamped with a show-all button", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  const transcript:TranscriptMessage[]=[{seq:1,role:"assistant",kind:"text",text:"ok",timestamp:null,model:null,thinking:Array.from({length:100},(_,i)=>`think ${i}`).join("\n"),tool_calls:[],images:[]}];
  const api:WorkbenchBackend={...backend,libraryOptions,listSessions:async()=>[session],listProjects:async()=>[],getSession:async()=>session,
    getTranscript:async()=>transcript,onLibraryChanged:async()=>()=>{}};
  api.sessionPage=async(query,offset,limit)=>({items:[session],total:1,offset,limit});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Recent sessions"] .session-card')!.click());
    const pre=host.querySelector<HTMLElement>('pre[data-transcript-field="thinking"]')!;
    expect(pre.dataset.clamped).toBe("true");
    expect(Array.from(host.querySelectorAll("button")).some(b=>b.textContent==="Show all 100 lines")).toBe(true);
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("a library refresh keeps loaded pages and the scroll position", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const all = Array.from({length:250},(_,i)=>({...session,key:`codex:s${i}`,native_id:`s${i}`,title:`Session ${i}`,updated_at:session.updated_at-i}));
  let changed=()=>{};
  const limits:number[]=[];
  const api:WorkbenchBackend={...backend,libraryOptions,listSessions:async()=>all,listProjects:async()=>[],getSession:async()=>session,
    getTranscript:async()=>[],onLibraryChanged:async cb=>{changed=cb;return ()=>{};}};
  api.sessionPage=async(_query,offset,limit)=>{limits.push(limit);return {items:all.slice(offset,offset+limit),total:all.length,offset,limit};};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));
    const list=host.querySelector<HTMLElement>('[aria-label="Recent sessions"]')!;
    await act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Load more sessions")!.click());
    const rows=list.querySelectorAll(".session-card").length;
    expect(rows).toBe(200);
    list.scrollTop=300;
    await act(async()=>{changed();await new Promise(resolve=>setTimeout(resolve,500));});
    expect(limits.at(-1)).toBe(200);
    expect(list.querySelectorAll(".session-card").length).toBe(rows);
    expect(list.scrollTop).toBe(300);
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("an empty library shows the loading skeleton until the first scan reports", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  Object.assign(window,{__TAURI_INTERNALS__:{}});
  let changed=()=>{};
  const api=emptyLibraryApi({onLibraryChanged:async cb=>{changed=cb;return ()=>{};}});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(<Workbench api={api}/>));
    expect(host.querySelector(".session-skeletons")).not.toBeNull();
    expect(host.textContent).not.toContain("No sessions found");
    await act(async()=>{changed();await new Promise(resolve=>setTimeout(resolve,500));});
    expect(host.querySelector(".session-skeletons")).toBeNull();
    expect(host.textContent).toContain("No sessions found");
  } finally {await act(async()=>root.unmount());host.remove();Reflect.deleteProperty(window,"__TAURI_INTERNALS__");}
});

test("a failed startup scan shows the error with a scan retry", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  Object.assign(window,{__TAURI_INTERNALS__:{}});
  let failed:(message:string)=>void=()=>{};
  const scan=vi.fn(async()=>({}) as never);
  const api=emptyLibraryApi({onScanError:async cb=>{failed=cb;return ()=>{};},scan});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(<Workbench api={api}/>));
    await act(async()=>failed("disk unreadable"));
    const alert=host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Local scan failed: disk unreadable");
    expect(host.querySelector(".session-skeletons")).toBeNull();
    await act(async()=>Array.from(alert!.querySelectorAll("button")).find(b=>b.textContent==="Retry scan")!.click());
    expect(scan).toHaveBeenCalledTimes(1);
  } finally {await act(async()=>root.unmount());host.remove();Reflect.deleteProperty(window,"__TAURI_INTERNALS__");}
});

test("sidebar project rows show the full path only when basenames collide", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const projects = [
    { path: "/a/app", session_count: 2, updated_at: 3 },
    { path: "/b/app", session_count: 1, updated_at: 2 },
    { path: "/c/unique", session_count: 1, updated_at: 1 },
  ];
  const api: WorkbenchBackend = { ...backend, libraryOptions: async () => ({ agents: ["codex" as const], models: ["gpt-5"], hosts: [], projects }), listSessions: async () => [session],
    listProjects: async () => projects, getSession: async () => session, getTranscript: async () => [], onLibraryChanged: async () => () => {} };
  api.sessionPage = async (_query, offset, limit) => ({ items: [session].slice(offset, offset + limit), total: 1, offset, limit });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Workbench api={api} />));
    const rows = [...host.querySelectorAll<HTMLButtonElement>("aside button[title^='/']")];
    const label = (path: string) => rows.find(row => row.title === path)?.querySelector("span.truncate")?.textContent;
    expect(label("/a/app")).toBe("/a/app");
    expect(label("/b/app")).toBe("/b/app");
    expect(label("/c/unique")).toBe("unique");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
