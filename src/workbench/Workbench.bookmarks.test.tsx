// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { Workbench } from "./Workbench";
import { backend, type BookmarkView, type SessionMeta, type TranscriptMessage, type WorkbenchBackend } from "./api";
import { emptyLibraryApi, libraryOptions, session, withSyntheticTranscriptSnapshot } from "./workbench-test-utils";

vi.mock("./SessionTerminal", () => ({ SessionTerminal: () => null }));

afterEach(() => { document.body.innerHTML = ""; vi.useRealTimers(); });


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
    await vi.waitFor(()=>{
      expect(transcript().textContent).toContain("Note saved, but refreshing bookmarks failed");
      expect(transcript().querySelector("textarea")).toBeNull();
    });
    expect((await reopen(transcript())).value).toBe("Independent B draft");
    await input(transcript().querySelector<HTMLTextAreaElement>("textarea")!,"Saved after refresh failure");
    failRefresh=false;await click(transcript(),"Save note");
    await vi.waitFor(()=>{
      expect(save.mock.calls.at(-1)).toEqual([other.key,1,"Saved after refresh failure",false,3]);
      expect(notes.find(row=>row.bookmark.session_key===other.key)!.bookmark.note).toBe("Saved after refresh failure");
    });
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
    await click(transcript(),"Save note");
    await vi.waitFor(()=>{
      expect(save.mock.calls.at(-1)?.[4]).toBe(2);
      expect(notes[0].bookmark.note).toBe("External note");
    });
    notes=[];await refresh();expect(transcript().textContent).toContain("The saved bookmark was removed");
    expect(button(transcript(),"Save note").disabled).toBe(true);
    await click(transcript(),"Cancel note");expect(button(transcript(),"Bookmark message 1")).toBeDefined();
  } finally {await act(async()=>root.unmount());host.remove();}
},20000);

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
    await click("removed0");expect(pane.textContent).toContain("1 saved message");
    expect(pane.textContent).not.toContain("Retain search decision");
    await click("Bookmarks2");await search("search decision");
    expect(pane.textContent).toContain("1 saved message");
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

test("bookmark rows copy their ronda:// reference, including unavailable originals", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const available: BookmarkView = {session,status:"current",bookmark:{session_key:session.key,seq:3,note:"Kept",excerpt:"Decision",text_hash:"a".repeat(64),created_at:1,updated_at:2,title:session.title,agent:session.agent,project_path:session.project_path}};
  const missing: BookmarkView = {session:null,status:"unavailable",bookmark:{...available.bookmark,session_key:"claude-code:gone",seq:7,agent:"claude-code",title:"Removed session",updated_at:3}};
  const api: WorkbenchBackend = {...backend, libraryOptions,listBookmarks:async()=>[missing,available],listSessions:async()=>[session],listProjects:async()=>[],getSession:async()=>session,
    getTranscript:async()=>[],onLibraryChanged:async()=>()=>{},searchGrouped:async()=>({groups:[],total_sessions:0,total_message_matches:0})};
  api.sessionPage = async (query,offset,limit) => { const items=await api.listSessions(query); return {items:items.slice(offset,offset+limit),total:items.length,offset,limit}; };
  const writeText=vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const click=async(label:string)=>{await act(async()=>host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());};
  try {
    await act(async()=>root.render(<Workbench api={withSyntheticTranscriptSnapshot(api)}/>));
    await act(async()=>Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent?.trim()==="Bookmarks2")!.click());
    await click("Copy reference 3");
    expect(writeText).toHaveBeenLastCalledWith("ronda://session/codex:one#3");
    expect(host.textContent).toContain("Reference copied");
    await click("Copy reference 7");
    expect(writeText).toHaveBeenLastCalledWith("ronda://session/claude-code:gone#7");
  } finally {await act(async()=>root.unmount());host.remove();}
});
