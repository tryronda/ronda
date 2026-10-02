// @vitest-environment happy-dom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,test,vi} from "vitest";
import {ProjectOverview} from "./ProjectOverview";
import {backend} from "./api";
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
