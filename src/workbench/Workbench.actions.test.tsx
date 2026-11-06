// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { Workbench } from "./Workbench";
import { backend, type BookmarkView, type SessionMeta, type TranscriptMessage, type WorkbenchBackend } from "./api";
import { emptyLibraryApi, libraryOptions, session, withSyntheticTranscriptSnapshot } from "./workbench-test-utils";

vi.mock("./SessionTerminal", () => ({ SessionTerminal: () => null }));

afterEach(() => { document.body.innerHTML = ""; vi.useRealTimers(); });


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
