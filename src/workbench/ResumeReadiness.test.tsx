// @vitest-environment happy-dom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,test,vi} from "vitest";
import {ResumeReadiness} from "./ResumeReadiness";
import {backend,type ResumeReadiness as Readiness} from "./api";
import {installDemoBackend,uninstallDemoBackend} from "../../site/preview/demo";

test("readiness explains unavailable resumes, recovers sample folders, and never launches preview agents",async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});installDemoBackend();
  const session=(await backend.getSession("codex:related-search"))!;
  const child=(await backend.sessionRelationships("claude-code:demo-0")).children[0];
  const resume=vi.fn(),inspectResume=vi.fn(backend.inspectResume);
  const api={...backend,inspectResume};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const render=async(selected=session,active=true)=>act(async()=>root.render(<ResumeReadiness api={api} session={selected} active={active} running={false} onResume={resume} />));
  const button=(text:string)=>Array.from(host.querySelectorAll("button")).find(item=>item.textContent===text);
  const click=async(text:string)=>act(async()=>button(text)!.click());
  try{
    await render(session,false);expect(inspectResume).not.toHaveBeenCalled();
    await render();expect(host.textContent).toContain("Project folder is missing");expect(button("Resume")).toBeUndefined();
    await click("Choose sample folder");expect(host.textContent).toContain("sample-recovered (mapped)");
    await click("Resume");expect(host.textContent).toContain("Desktop required");expect(resume).not.toHaveBeenCalled();
    await expect(api.resumeSession(session.key)).rejects.toThrow("Desktop required");
    const raw=await api.getPref("resume_project_mappings");expect(JSON.parse(raw!)[session.project_path!]).toContain("sample-recovered");
    await api.setPref("resume_project_mappings","{}");await click("Check resume again");expect(host.textContent).toContain("Project folder is missing");
    await render(child);expect(host.textContent).toContain("Subagents cannot independently resume");expect(button("Resume")).toBeUndefined();
    let finish!:(value:Readiness)=>void;
    inspectResume.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    await render(session);await render(child);
    await act(async()=>finish({...(await backend.inspectResume(session.key)),ready:true}));
    expect(host.textContent).toContain("Subagents cannot independently resume");expect(button("Resume")).toBeUndefined();
  }finally{await act(async()=>root.unmount());host.remove();uninstallDemoBackend();}
});
