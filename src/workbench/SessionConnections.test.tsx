// @vitest-environment happy-dom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {MotionGlobalConfig} from "motion/react";
MotionGlobalConfig.skipAnimations=true;
Reflect.deleteProperty(Element.prototype,"animate");
import {expect,test,vi} from "vitest";
import {backend,queryDefaults} from "./api";
import {Workbench} from "./Workbench";
import {SessionConnections} from "./SessionConnections";
import {installDemoBackend,uninstallDemoBackend} from "../../site/preview/demo";

test("connections open indexed children and originals, refresh only when active, and ignore departed responses",async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});installDemoBackend();
  const parent=(await backend.getSession("claude-code:demo-0"))!;
  const report=await backend.sessionRelationships(parent.key);
  expect(report.children).toHaveLength(2);
  expect(report.related[0].explanation).toBe("Shared files");
  const child=report.children.find(child=>!child.title)!;
  expect((await backend.sessionRelationships(child.key)).parent!.key).toBe(parent.key);
  let changed=()=>{};
  const sessionRelationships=vi.fn(async()=>structuredClone(report));
  const api={...backend,sessionRelationships,onLibraryChanged:async(callback:()=>void)=>{changed=callback;return ()=>{};}};
  const onOpen=vi.fn();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const render=async(active:boolean,session=parent)=>act(async()=>root.render(<SessionConnections key={session.key} api={api} session={session} active={active} onOpen={onOpen} />));
  const click=async(text:string)=>act(async()=>{Array.from(host.querySelectorAll("button")).find(button=>button.textContent===text)!.click();});
  try{
    await render(false);expect(sessionRelationships).not.toHaveBeenCalled();
    await render(true);expect(host.textContent).toContain("Subagents · 2");
    await click(`Subagent: ${child.native_id}`);expect(onOpen).toHaveBeenLastCalledWith(child);
    await click(report.related[0].session.title);expect(onOpen).toHaveBeenLastCalledWith(report.related[0].session);
    await render(false);await act(async()=>changed());expect(sessionRelationships).toHaveBeenCalledTimes(1);
    report.children=[];await render(true);expect(sessionRelationships).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("No indexed subagents");
    let finish!:(value:typeof report)=>void;
    sessionRelationships.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    await render(true,child);
    await render(true,parent);
    await act(async()=>finish({...report,parent:child}));
    expect(host.textContent).not.toContain(`Parent: ${child.native_id}`);
  }finally{await act(async()=>root.unmount());host.remove();uninstallDemoBackend();}
});

test("changing the selected transcript replaces its connection evidence",async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});installDemoBackend();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    expect((await backend.sessionPage(queryDefaults,0,100)).items.length).toBe(100);
    await act(async()=>root.render(<Workbench api={backend} />));
    await act(async()=>{const first=Array.from(host.querySelectorAll<HTMLButtonElement>('.session-card')).find(button=>button.textContent!.includes("Make session search"));if(!first)throw new Error(host.textContent ?? "No rendered library");first.click();});
    expect(host.querySelector('section[aria-label="Session connections"]')!.textContent).toContain("Subagents · 2");
    await act(async()=>Array.from(host.querySelectorAll<HTMLButtonElement>('section[aria-label="Session connections"] button')).find(button=>button.textContent==="Project overview synthetic error 1")!.click());
    expect(host.querySelector('main[aria-label="Transcript"] h2')!.textContent).toBe("Project overview synthetic error 1");
    expect(host.querySelector('section[aria-label="Session connections"]')!.textContent).toContain("Subagents · 0");
    expect(host.querySelector('section[aria-label="Session connections"]')!.textContent).toContain("Shared error");
  }finally{await act(async()=>root.unmount());host.remove();uninstallDemoBackend();}
});

test("the real preview Workbench labels source reveal Desktop required under mocked Tauri",async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});installDemoBackend();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    expect((await backend.sessionPage(queryDefaults,0,100)).items.length).toBe(100);
    await act(async()=>root.render(<Workbench api={backend}/>));
    await act(async()=>{
      const row=Array.from(host.querySelectorAll<HTMLButtonElement>(".session-card")).find(button=>button.textContent!.includes("Make session search"));
      if(!row)throw new Error(host.textContent ?? "No preview session row");
      row.click();
    });
    const reveal=host.querySelector<HTMLButtonElement>('button[aria-label="Reveal source file"]');
    expect(reveal).not.toBeNull();
    await act(async()=>reveal!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Desktop required: sample sessions cannot reveal a source file.");
    expect(host.textContent).not.toContain("Could not reveal source file");
  }finally{await act(async()=>root.unmount());host.remove();uninstallDemoBackend();}
});
