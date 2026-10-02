// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { WorkbenchBackend, TranscriptMessage, SessionMeta } from "./api";
import { ContextBundle } from "./ContextBundle";

const mocks=vi.hoisted(()=>({native:false,save:vi.fn(),invoke:vi.fn()}));
vi.mock("@tauri-apps/plugin-dialog",()=>({save:mocks.save}));
vi.mock("@/lib/tauri",()=>({inTauri:()=>mocks.native,invoke:mocks.invoke}));

test("edited drafts survive clipboard/export failures and closing; native cancellation writes nothing", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new Event("close"));};
  const clipboard=vi.fn().mockRejectedValueOnce(new Error("Clipboard denied")).mockResolvedValue(undefined);
  Object.defineProperty(navigator,"clipboard",{value:{writeText:clipboard},configurable:true});
  const msg={seq:7,role:"assistant",kind:"text",text:"Actual body",timestamp:null,model:null,thinking:null,tool_calls:[],images:[]} as TranscriptMessage;
  const api={getSession:async()=>({key:"sample",title:"Sample",agent:"codex",project_path:null,host:null} as SessionMeta),getTranscript:async()=>[msg]} as Pick<WorkbenchBackend,"getSession" | "getTranscript">;
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const click=async(label:string)=>act(async()=>Array.from(host.querySelectorAll("button")).find(button=>button.textContent===label)!.click());
  try {
    await act(async()=>root.render(<ContextBundle api={api} selection={[{key:"sample",seq:7}]} clear={()=>{}} embedded={false}/>));
    await click("Preview context (1)");
    const editor=host.querySelector("textarea")!;
    expect(editor.value).toContain("Actual body");
    const edited="Reviewed <script>plain text</script> 😀";
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(editor,edited);
      editor.dispatchEvent(new Event("input",{bubbles:true}));
    });
    await click("Copy context");
    expect(host.textContent).toContain("Clipboard denied");expect(editor.value).toBe(edited);
    await click("Copy context");expect(clipboard).toHaveBeenLastCalledWith(edited);
    expect(host.querySelector("script")).toBeNull();
    mocks.native=true;mocks.save.mockResolvedValueOnce(null);
    await click("Export context Markdown");expect(mocks.invoke).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Context exported");
    mocks.save.mockResolvedValue("/synthetic/context.md");mocks.invoke.mockRejectedValueOnce(new Error("Disk full"));
    await click("Export context Markdown");expect(host.textContent).toContain("Disk full");expect(editor.value).toBe(edited);
    mocks.invoke.mockResolvedValue(undefined);
    await click("Export context Markdown");expect(mocks.invoke).toHaveBeenLastCalledWith("export_context",{destination:"/synthetic/context.md",text:edited});
    await click("Close context preview");expect(document.activeElement?.textContent).toBe("Preview context (1)");
    await click("Preview context (1)");expect(editor.value).toBe(edited);
  } finally {await act(async()=>root.unmount());host.remove();mocks.native=false;vi.restoreAllMocks();}
});
