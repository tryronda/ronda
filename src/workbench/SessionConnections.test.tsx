// @vitest-environment happy-dom
import {act} from "react";
import {agentNames} from "@/lib/agents";
import {createRoot} from "react-dom/client";
import {MotionGlobalConfig} from "motion/react";
MotionGlobalConfig.skipAnimations=true;
Reflect.deleteProperty(Element.prototype,"animate");
import {expect,test,vi} from "vitest";
import {timeLabel} from "@/lib/utils";
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

test("connections say when only the top related sessions are shown",async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});installDemoBackend();
  const parent=(await backend.getSession("claude-code:demo-0"))!;
  const report=await backend.sessionRelationships(parent.key);
  expect(report.related).toHaveLength(5);expect(report.related_total).toBeGreaterThan(5);
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const show=async(value:typeof report)=>act(async()=>root.render(<SessionConnections key={String(value.related_total)} api={{...backend,sessionRelationships:async()=>structuredClone(value)}} session={parent} active onOpen={()=>{}} />));
  try{
    await show(report);
    expect(host.textContent).toContain(`Related sessions · ${report.related_total}`);
    expect(host.textContent).not.toContain(`Related sessions · 5`);
    const first=report.related[0].session;
    expect(host.textContent).toContain(`${agentNames[first.agent]} · ${timeLabel(first.updated_at)}`);
    await show({...report,related:[{...report.related[0],session:{...first,archived:true}}],related_total:1});
    expect(host.textContent).toContain("archived · ");
    await show(report);
    expect(host.textContent).toContain(`Showing top 5 of ${report.related_total} same-project sessions`);
    await show({...report,related_total:5});
    expect(host.textContent).not.toContain("Showing top");
    const {related_total:_omitted,...legacy}=report;await show(legacy);
    expect(host.textContent).not.toContain("Showing top");
  }finally{await act(async()=>root.unmount());host.remove();uninstallDemoBackend();}
});

test("changing the selected transcript replaces its connection evidence",async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});installDemoBackend();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    expect((await backend.sessionPage(queryDefaults,0,100)).items.length).toBe(100);
    await act(async()=>root.render(<Workbench api={backend} />));
    await act(async()=>{const first=Array.from(host.querySelectorAll<HTMLButtonElement>('.session-card')).find(button=>button.textContent!.includes("Make session search"));if(!first)throw new Error(host.textContent ?? "No rendered library");first.click();});
    await vi.waitFor(() => expect(host.querySelector('section[aria-label="Session connections"]')!.textContent).toContain("Subagents · 2"));
    await act(async()=>Array.from(host.querySelectorAll<HTMLButtonElement>('section[aria-label="Session connections"] button')).find(button=>button.textContent==="Project overview synthetic error 1")!.click());
    await vi.waitFor(() => {
      expect(host.querySelector('main[aria-label="Transcript"] h2')!.textContent).toBe("Project overview synthetic error 1");
      expect(host.querySelector('section[aria-label="Session connections"]')!.textContent).toContain("Subagents · 0");
      expect(host.querySelector('section[aria-label="Session connections"]')!.textContent).toContain("Shared error");
    });
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
    await vi.waitFor(() => expect(host.querySelector('button[aria-label="Reveal source file"]')).not.toBeNull());
    const reveal=host.querySelector<HTMLButtonElement>('button[aria-label="Reveal source file"]');
    await act(async()=>reveal!.click());
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
    const alert=host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Desktop required: sample sessions cannot reveal a source file.");
    expect(alert?.textContent).not.toMatch(/Retry (scan|refresh)/);
    expect(alert?.querySelector('button[aria-label="Dismiss"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Could not reveal source file");
    await act(async()=>alert!.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
  }finally{await act(async()=>root.unmount());host.remove();uninstallDemoBackend();}
});

test("connections use singular forms for a single shared error, file and hidden session",async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});installDemoBackend();
  const parent=(await backend.getSession("claude-code:demo-0"))!;
  const report=await backend.sessionRelationships(parent.key);
  const value={...report,related:[{...report.related[0],shared_errors:1,shared_files:1}],related_total:2};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    await act(async()=>root.render(<SessionConnections api={{...backend,sessionRelationships:async()=>structuredClone(value)}} session={parent} active onOpen={()=>{}} />));
    expect(host.textContent).toContain("1 shared error · 1 shared file");
    expect(host.textContent).not.toContain("1 shared errors");expect(host.textContent).not.toContain("1 shared files");
    await act(async()=>root.render(<SessionConnections key="b" api={{...backend,sessionRelationships:async()=>structuredClone({...value,related_total:2})}} session={parent} active onOpen={()=>{}} />));
    expect(host.textContent).toContain("Showing top 1 of 2 same-project sessions");
  }finally{await act(async()=>root.unmount());host.remove();uninstallDemoBackend();}
});
