// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { BookmarkControl, emptyBookmarkEditor, type BookmarkEditorState } from "./BookmarkControl";
import { backend, type BookmarkView } from "./api";

test("note saves stay explicit, keep failed drafts, preserve old snapshots, and restore focus", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  let view: BookmarkView={bookmark:{session_key:"one",seq:7,note:"Saved note",excerpt:"Original message",text_hash:"a".repeat(64),created_at:1,updated_at:2,title:"Title",agent:"codex",project_path:null},session:null,status:"changed"};
  let fail=true;
  const save=vi.fn(async (_key:string,_seq:number,note:string,refresh:boolean)=>{
    if(fail)throw new Error("Synthetic write failure");
    view={...view,status:refresh?"current":view.status,bookmark:{...view.bookmark,note,updated_at:view.bookmark.updated_at+1}};
    return view.bookmark;
  });
  const api={...backend,saveBookmark:save};
  let editorState=emptyBookmarkEditor;
  const updateEditor=(update:(current:BookmarkEditorState)=>BookmarkEditorState)=>{editorState=update(editorState);render();};
  const render=()=>{root.render(<BookmarkControl api={api} sessionKey="one" seq={7} view={view} editorState={editorState} updateEditor={updateEditor} changed={async()=>render()}/>);};
  const click=async(label:string)=>{await act(async()=>Array.from(host.querySelectorAll("button")).find(button=>button.textContent===label)!.click());};
  try {
    await act(async()=>render());
    expect(host.textContent).toContain("Changed since bookmarking");
    expect(host.textContent).toContain("Original message");
    await click("Edit bookmark note for message 7");
    const editor=host.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(document.activeElement).toBe(editor);
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(editor,"Unsaved <b>plain text</b> note");editor.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(host.textContent).toContain("Unsaved changes");expect(save).not.toHaveBeenCalled();
    expect(host.querySelector("b")).toBeNull();
    await click("Save note");expect(host.textContent).toContain("Synthetic write failure");
    expect(editor.value).toBe("Unsaved <b>plain text</b> note");
    expect(save.mock.calls[0]).toEqual(["one",7,"Unsaved <b>plain text</b> note",false,2]);
    fail=false;await click("Save note");
    expect(host.querySelector("textarea")).toBeNull();
    expect(document.activeElement?.textContent).toBe("Edit bookmark note for message 7");
    expect(host.textContent).toContain("Changed since bookmarking");
    await click("Update saved excerpt to this message");expect(save.mock.calls.at(-1)).toEqual(["one",7,"Unsaved <b>plain text</b> note",true,3]);
    expect(host.textContent).not.toContain("Changed since bookmarking");
    await click("Edit bookmark note for message 7");
    await act(async()=>host.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));
    expect(host.querySelector("textarea")).toBeNull();
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("Cmd/Ctrl+Enter saves a note with the current base, and an over-limit note does not save", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const view: BookmarkView={bookmark:{session_key:"one",seq:7,note:"Saved note",excerpt:"Original message",text_hash:"a".repeat(64),created_at:1,updated_at:2,title:"Title",agent:"codex",project_path:null},session:null,status:"current"};
  const save=vi.fn(async (_key:string,_seq:number,note:string)=>({...view.bookmark!,note,updated_at:3}));
  const api={...backend,saveBookmark:save};
  let editorState=emptyBookmarkEditor;
  const updateEditor=(update:(current:BookmarkEditorState)=>BookmarkEditorState)=>{editorState=update(editorState);render();};
  const render=()=>{root.render(<BookmarkControl api={api} sessionKey="one" seq={7} view={view} editorState={editorState} updateEditor={updateEditor} changed={async()=>render()}/>);};
  const setNote=async(value:string)=>{const editor=host.querySelector<HTMLTextAreaElement>("textarea")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(editor,value);editor.dispatchEvent(new Event("input",{bubbles:true}));});};
  const press=async(init:KeyboardEventInit)=>{const event=new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true,...init});await act(async()=>{host.querySelector("textarea")!.dispatchEvent(event);});return event;};
  try {
    await act(async()=>render());
    await act(async()=>Array.from(host.querySelectorAll("button")).find(button=>button.textContent==="Edit bookmark note for message 7")!.click());
    await setNote("x".repeat(4001));
    expect((await press({metaKey:true})).defaultPrevented).toBe(true);
    expect(save).not.toHaveBeenCalled();
    await setNote("Line one");
    expect((await press({})).defaultPrevented).toBe(false);
    expect(save).not.toHaveBeenCalled();
    await press({ctrlKey:true});
    expect(save.mock.calls).toEqual([["one",7,"Line one",false,2]]);
    expect(host.querySelector("textarea")).toBeNull();
  } finally {await act(async()=>root.unmount());host.remove();}
});
