import {useState} from "react";
import {open} from "@tauri-apps/plugin-dialog";
import {useLibraryRefresh} from "@/lib/hooks/use-library-refresh";
import type {ResumeReason,ResumeReadiness as Readiness,SessionMeta,WorkbenchBackend} from "./api";

const reasons:Record<ResumeReason,string>={unsupported_agent:"Resume is unavailable for this agent.",unsupported_child:"Subagents cannot independently resume.",unknown_project:"Project directory is unknown.",missing_folder:"Project folder is missing or unavailable.",missing_executable:"Executable is missing from the launch environment.",inspection_unknown:"Launch environment could not be checked. Retry before resuming.",remote_environment_unchecked:"Remote folder and executable are unchecked. Launch can report SSH, authentication, or environment errors."};

export function ResumeReadiness({api,session,active,running,onResume}:{api:WorkbenchBackend;session:SessionMeta;active:boolean;running:boolean;onResume:()=>void}) {
  const [data,setData]=useState<Readiness|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  useLibraryRefresh(()=>{
    let live=true;setData(null);setError("");setNotice("");
    void api.inspectResume(session.key).then(next=>{if(live)setData(next);}).catch(cause=>{if(live)setError(String(cause));});
    return ()=>{live=false;};
  },[api,session.key,retry],active,400,api.onLibraryChanged);
  async function chooseFolder() {
    if(!data)return;setBusy(true);setError("");
    try {
      const folder=data.sample ? `${data.original_directory}/sample-recovered` : await open({directory:true,multiple:false,title:"Choose project folder"});
      if(typeof folder==="string") {await api.setResumeFolder(session.key,folder);setRetry(n=>n+1);}
    }catch(cause){setError(String(cause));}finally{setBusy(false);}
  }
  return <section aria-label="Resume readiness" className="flex-none border-b border-border px-7 py-2 text-[13px] max-[1100px]:px-5">
    {error && <p role="alert">{error}</p>}
    {!data ? <p role="status">{error ? "Resume inspection unavailable." : "Checking resume readiness…"}</p> : <>
      {data.sample && <p>Sample readiness. The browser cannot inspect your computer or open an agent.</p>}
      {data.reasons.map(reason=><p key={reason}>{reasons[reason]}</p>)}
      {data.directory && <p className="truncate" title={data.directory}>Effective folder: {data.directory}{data.directory!==data.original_directory ? " (mapped)" : ""}</p>}
      {data.ready && !running && <button type="button" className="mr-3 bg-foreground px-3 py-1.5 text-paper" onClick={()=>data.sample ? setError("Desktop required: open this session in Ronda to resume.") : onResume()}>Resume</button>}
      {data.supported && !data.host && data.original_directory && <button type="button" className="mr-3 underline" disabled={busy} onClick={()=>void chooseFolder()}>{data.sample ? "Choose sample folder" : "Choose project folder"}</button>}
      {data.command && <details><summary>Resume command</summary><pre className="max-h-24 overflow-auto whitespace-pre-wrap">{data.command}</pre>
        <button type="button" className="underline" onClick={()=>void navigator.clipboard.writeText(data.command!).then(()=>setNotice("Command copied")).catch(cause=>setError(String(cause)))}>Copy resume command</button></details>}
      <p className="text-muted-foreground">Readiness checks do not start an agent. Opening a terminal does not verify agent startup.</p>
    </>}
    <button type="button" className="underline" disabled={busy} onClick={()=>setRetry(n=>n+1)}>Check resume again</button>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
