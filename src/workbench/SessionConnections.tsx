import {useState} from "react";
import {sameJson,useLibraryRefresh} from "@/lib/hooks/use-library-refresh";
import type {SessionMeta,SessionRelationships,WorkbenchBackend} from "./api";

export function SessionConnections({api,session,active,onOpen}:{api:WorkbenchBackend;session:SessionMeta;active:boolean;onOpen:(session:SessionMeta)=>void}) {
  const [data,setData]=useState<SessionRelationships|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  useLibraryRefresh(()=>{
    let live=true;
    void api.sessionRelationships(session.key).then(next=>{if(live){setData(current=>sameJson(current,next)?current:next);setError("");}})
      .catch(cause=>{if(live)setError(String(cause));});
    return ()=>{live=false;};
  },[api,session.key,retry],active,400,api.onLibraryChanged);
  const title=(item:SessionMeta)=>item.title.trim() || item.native_id;
  return <section aria-label="Session connections" className="flex-none border-b border-border px-7 py-2 text-[13px] max-[1100px]:px-5">
    {error ? <p role="alert">{error} <button className="underline" type="button" onClick={()=>setRetry(n=>n+1)}>Retry session connections</button></p>
      : !data ? <p role="status">Loading session connections…</p> : <>
        {data.parent ? <button className="mb-1 underline" type="button" onClick={()=>onOpen(data.parent!)}>Parent: {title(data.parent)}</button>
          : session.parent_key && <p>Parent session is not indexed on this host.</p>}
        <details><summary>Subagents · {data.children.length} / Related sessions · {data.related.length}</summary>
          <div className="max-h-[180px] overflow-y-auto pt-2">
            <p className="mb-2 text-muted-foreground">Indexed relationships only. Shared activity suggests context, not proof of the same task.</p>
            <h3>Subagents · {data.children.length}</h3>
            {data.children.length ? <ul>{data.children.map(child=><li key={child.key}><button className="underline" type="button" onClick={()=>onOpen(child)}>Subagent: {title(child)}</button></li>)}</ul>
              : <p>No indexed subagents. Agent ancestry may be unavailable.</p>}
            <h3 className="mt-2">Related sessions · {data.related.length}</h3>
            {data.related.length ? <ul>{data.related.map(row=><li className="py-1" key={row.session.key}>
              <button className="underline" type="button" onClick={()=>onOpen(row.session)}>{title(row.session)}</button>
              <p className="text-muted-foreground">{row.explanation} · {row.shared_errors} shared errors · {row.shared_files} shared files</p>
            </li>)}</ul> : <p>No other indexed root sessions in this project and host.</p>}
          </div>
        </details>
      </>}
  </section>;
}
