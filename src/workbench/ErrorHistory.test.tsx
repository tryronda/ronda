// @vitest-environment happy-dom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,test,vi} from "vitest";
import {backend,type SessionMeta} from "./api";
import {ErrorHistory} from "./ErrorHistory";

test("error lookup waits for submission, scopes pages, validates Unicode, and opens exact evidence",async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new Event("close"));};
  const errorHistory=vi.fn(async(_text:string,_project:string|null,_host:string|null,_local:boolean,offset:number)=>({
    canonical:"Error: sample",offset,limit:20,total:25,indexed_sessions:40,with_tools:30,
    hits:Array.from({length:offset ? 5 : 20},(_,index)=>({session:{key:`sample-${offset+index}`,title:`Original ${offset+index}`,agent:"codex",host:"local",project_path:"/repo"} as SessionMeta,seq:7,outcome:"committed"})),
  }));
  let changed=()=>{};
  const api={...backend,errorHistory,onLibraryChanged:async(callback:()=>void)=>{changed=callback;return ()=>{};}};
  const onOpen=vi.fn(),onClose=vi.fn(),onSearchTranscript=vi.fn();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const click=async(label:string)=>act(async()=>Array.from(host.querySelectorAll("button")).find(button=>button.textContent===label)!.click());
  const submit=async()=>act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
  const edit=async(text:string)=>act(async()=>{
    const field=host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,text);
    field.dispatchEvent(new Event("input",{bubbles:true}));
  });
  try{
    await act(async()=>root.render(<ErrorHistory api={api} request={{text:"Error: sample",project:"/repo",host:"local",local_only:false}}
      projects={["/repo","/other/repo"]} hosts={["local"]} onOpen={onOpen} onClose={onClose} onSearchTranscript={onSearchTranscript}/>));
    expect(errorHistory).not.toHaveBeenCalled();
    await edit("Error: sample edited");expect(errorHistory).not.toHaveBeenCalled();
    await submit();expect(errorHistory).toHaveBeenLastCalledWith("Error: sample edited","/repo","local",false,0);
    expect(host.textContent).toContain("Showing 20 of 25");expect(host.textContent).toContain("Commit command observed");
    await click("Load more error occurrences");expect(errorHistory).toHaveBeenLastCalledWith("Error: sample edited","/repo","local",false,20);
    expect(host.textContent).toContain("Showing 25 of 25");
    await click("Open Original 24 · message #7");expect(onOpen).toHaveBeenCalledWith("sample-24",7);expect(onClose).toHaveBeenCalled();
    await act(async()=>changed());expect(host.textContent).toContain("Library changed");expect(host.textContent).not.toContain("Showing 25");
    await edit("🙂".repeat(20_001));await submit();expect(errorHistory).toHaveBeenCalledTimes(2);expect(host.textContent).toContain("1 to 20,000");
    await edit("Unrecorded wording");errorHistory.mockRejectedValueOnce(new Error("Analytics unavailable"));await submit();
    expect(host.textContent).toContain("Analytics unavailable");expect(host.querySelector("textarea")!.value).toBe("Unrecorded wording");
    await click("Search wording in current transcript");expect(onSearchTranscript).toHaveBeenCalledWith("Unrecorded wording");
  }finally{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();}
});
