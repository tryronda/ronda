import {useEffect,useRef,useState} from "react";
import type {ErrorHistory as Result,ErrorHistoryRequest,WorkbenchBackend} from "./api";

export function ErrorHistory({api,request,projects,hosts,onClose,onOpen,onSearchTranscript}: {
  api:WorkbenchBackend; request:ErrorHistoryRequest; projects:string[]; hosts:string[];
  onClose:()=>void; onOpen:(key:string,seq:number)=>void; onSearchTranscript?: (text:string)=>void;
}) {
  const dialog=useRef<HTMLDialogElement>(null),generation=useRef(0);
  const [text,setText]=useState(request.text),[project,setProject]=useState(request.project ?? "");
  const [host,setHost]=useState(request.local_only ? "local" : request.host ? `remote:${request.host}` : "");
  const [data,setData]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{dialog.current?.showModal();dialog.current?.querySelector("textarea")?.focus();return ()=>{generation.current++;};},[]);
  useEffect(()=>{
    let live=true,unlisten:(()=>void)|undefined;
    void api.onLibraryChanged(()=>{if(!live)return;generation.current++;setBusy(false);setData(null);setError("Library changed. Submit again to refresh error evidence.");})
      .then(stop=>{if(live)unlisten=stop;else stop();}).catch(cause=>{if(live)setError(String(cause));});
    return ()=>{live=false;unlisten?.();};
  },[api]);
  const reset=()=>{generation.current++;setData(null);setError("");};
  const lookup=async(offset=0)=>{
    if(!text.trim() || Array.from(text).length>20_000){setError("Enter error text of 1 to 20,000 characters.");return;}
    const run=++generation.current;setBusy(true);setError("");
    try {
      const next=await api.errorHistory(text,project || null,host.startsWith("remote:") ? host.slice(7) : null,host==="local",offset);
      if(run!==generation.current)return;
      if(offset && data && (next.total!==data.total || next.canonical!==data.canonical)){await lookup();return;}
      setData(current=>offset && current ? {...next,hits:[...new Map([...current.hits,...next.hits].map(hit=>[hit.session.key,hit])).values()]} : next);
    }catch(cause){if(run===generation.current)setError(String(cause));}
    finally{if(run===generation.current)setBusy(false);}
  };
  const outcomes:Record<string,string>={committed:"Commit command observed",uncommitted:"Edits recorded without a commit command",failed:"Ended failing",no_changes:"No file changes recorded"};
  return <dialog ref={dialog} aria-labelledby="error-history-heading" onClose={onClose}
    className="m-auto max-h-[90vh] w-[min(900px,94vw)] overflow-y-auto border border-border bg-paper p-5 text-foreground shadow-lg backdrop:bg-black/40">
    <h2 id="error-history-heading" className="font-serif text-2xl">Find error history</h2>
    <p className="my-3">Previous occurrences are evidence from recorded tool output. A commit command does not verify a fix.</p>
    <form onSubmit={event=>{event.preventDefault();void lookup();}}>
      <label className="block">Error text<textarea rows={5} value={text} disabled={busy}
        onChange={event=>{setText(event.target.value);reset();}} className="mt-2 block w-full bg-chip p-3 font-mono text-[13px]" /></label>
      <div className="my-3 flex flex-wrap gap-4">
        <label>Project<select aria-label="Error history project" disabled={busy} value={project} onChange={event=>{setProject(event.target.value);reset();}}>
          <option value="">All projects</option>{[...new Set([...projects,...(project ? [project] : [])])].map(path=><option key={path}>{path}</option>)}
        </select></label>
        <label>Host<select aria-label="Error history host" disabled={busy} value={host} onChange={event=>{setHost(event.target.value);reset();}}>
          <option value="">All hosts</option><option value="local">Local sessions</option>
          {[...new Set([...hosts,...(host.startsWith("remote:") ? [host.slice(7)] : [])])].map(value=><option value={`remote:${value}`} key={value}>{value}</option>)}
        </select></label>
        <button type="submit" disabled={busy}>Look up previous occurrences</button>
      </div>
    </form>
    {busy && <p role="status">Looking up recorded errors…</p>}
    {error && <p role="alert">{error}</p>}
    {data && <section aria-label="Error history results">
      {data.canonical && <pre className="whitespace-pre-wrap break-words bg-chip p-3">{data.canonical}</pre>}
      <p className="my-3">{data.with_tools} / {data.indexed_sessions} indexed sessions in this scope have tool data. Sessions without it cannot contribute error evidence.</p>
      <p role="status">Showing {data.hits.length} of {data.total} previous occurrences</p>
      {!data.total && <p>No recorded match. Try the exact error line, or search the raw wording in a transcript.</p>}
      <ul>{data.hits.map(hit=><li key={hit.session.key} className="border-b border-border py-3">
        <button type="button" className="underline" onClick={()=>{dialog.current?.close();onOpen(hit.session.key,hit.seq);}}>Open {hit.session.title} · message #{hit.seq}</button>
        <p>{hit.session.agent} · {hit.session.host ? `@${hit.session.host}` : "Local"} · {hit.session.project_path ?? "Unknown project"}</p>
        <p>{outcomes[hit.outcome] ?? "Outcome unavailable"}</p>
      </li>)}</ul>
      {data.hits.length<data.total && <button type="button" disabled={busy} onClick={()=>void lookup(data.offset+data.limit)}>Load more error occurrences</button>}
    </section>}
    <div className="mt-4 flex flex-wrap gap-4">
      {onSearchTranscript ? <button type="button" onClick={()=>{dialog.current?.close();onSearchTranscript(text);}}>Search wording in current transcript</button>
        : <p>Open a session and use Find in transcript to search its raw wording, including tool output.</p>}
      <button type="button" onClick={()=>dialog.current?.close()}>Close error history</button>
    </div>
  </dialog>;
}
