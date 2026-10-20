// @vitest-environment happy-dom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,test,vi} from "vitest";
import {ProjectOverview} from "./ProjectOverview";
import {backend} from "./api";
import {timeLabel} from "@/lib/utils";
import {installDemoBackend,uninstallDemoBackend} from "../../site/preview/demo";

test("project sections stay usable without analytics, open originals, and defer hidden refreshes",async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});installDemoBackend();
  const context={path:"/Users/you/dev/payments-api",host:null,local_only:false};
  const report=await backend.projectOverview(context.path,null,false);
  report.intelligence=null;report.intelligence_error="Synthetic missing analytics";
  let changed=()=>{};
  const projectOverview=vi.fn(async()=>structuredClone(report));
  const api={...backend,projectOverview,onLibraryChanged:async(callback:()=>void)=>{changed=callback;return ()=>{};}};
  const onOpen=vi.fn(),onViewAll=vi.fn(),onIntelligence=vi.fn();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const render=async(active:boolean)=>act(async()=>root.render(<ProjectOverview api={api} context={context} active={active} onOpen={onOpen} onViewAll={onViewAll} onIntelligence={onIntelligence} />));
  const click=async(text:string)=>act(async()=>{Array.from(host.querySelectorAll("button")).find(button=>button.textContent===text)!.click();});
  try{
    await render(false);expect(projectOverview).not.toHaveBeenCalled();
    await render(true);expect(projectOverview).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Synthetic missing analytics");
    expect(host.textContent).toContain(`Recent sessions · ${report.total_sessions}`);
    expect(host.querySelector<HTMLButtonElement>('button[disabled]')!.textContent).toContain("message #2");
    await click(report.sessions[0].title);expect(onOpen).toHaveBeenLastCalledWith(report.sessions[0].key,0);
    await click("View all project bookmarks");expect(onViewAll).toHaveBeenLastCalledWith(true);
    await click("View all project Intelligence");expect(onIntelligence).toHaveBeenCalledTimes(1);
    await render(false);await act(async()=>{changed();});expect(projectOverview).toHaveBeenCalledTimes(1);
    report.total_sessions++;await render(true);expect(projectOverview).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain(`Recent sessions · ${report.total_sessions}`);
  }finally{await act(async()=>root.unmount());host.remove();uninstallDemoBackend();}
});

test("heading shows the folder name for backslash paths with trailing separators",async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});installDemoBackend();
  const context={path:"C:\\Users\\me\\app\\",host:null,local_only:false};
  const report=await backend.projectOverview("/Users/you/dev/payments-api",null,false);
  const api={...backend,projectOverview:async()=>structuredClone(report),onLibraryChanged:async()=>()=>{}};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    await act(async()=>root.render(<ProjectOverview api={api} context={context} active={true} onOpen={vi.fn()} onViewAll={vi.fn()} onIntelligence={vi.fn()} />));
    expect(host.querySelector("h2")!.textContent).toBe("app");
  }finally{await act(async()=>root.unmount());host.remove();uninstallDemoBackend();}
});

test("dates use the library label and counts pluralize",async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});installDemoBackend();
  const context={path:"/Users/you/dev/payments-api",host:null,local_only:false};
  const report=await backend.projectOverview(context.path,null,false);
  const stamp=new Date(2020,2,4,9,5).getTime();
  report.sessions[0].updated_at=stamp;
  report.bookmarks[0].bookmark.updated_at=stamp;
  report.intelligence!.totals.sessions=1;report.intelligence!.totals.tool_calls=1;report.intelligence!.totals.tool_errors=1;
  report.errors=[{signature:"x",message:"Error: locked",sessions:1,agents:["codex"],projects:[],first_seen:0,last_seen:0,came_back:false,evidence:[]}];
  const api={...backend,projectOverview:async()=>structuredClone(report),onLibraryChanged:async()=>()=>{}};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    await act(async()=>root.render(<ProjectOverview api={api} context={context} active={true} onOpen={vi.fn()} onViewAll={vi.fn()} onIntelligence={vi.fn()} />));
    const label=timeLabel(stamp);
    expect(label).toContain("2020");
    expect(host.textContent).toContain(`· ${label}`);
    expect(host.textContent).toContain(`Updated ${label}`);
    expect(host.textContent).toContain("1 session · ");
    expect(host.textContent).toContain("1 tool call · 1 tool error");
    expect(host.textContent).toContain("1 session · previous occurrences");
    expect(host.textContent).not.toContain("1 sessions");
  }finally{await act(async()=>root.unmount());host.remove();uninstallDemoBackend();}
});
