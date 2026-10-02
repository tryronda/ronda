import {useState} from "react";
import {sameJson,useLibraryRefresh} from "@/lib/hooks/use-library-refresh";
import {hours} from "@/panels/IntelligenceView";
import type {ProjectContext,ProjectOverview as Overview,WorkbenchBackend} from "./api";

export function ProjectOverview({api,context,active,onOpen,onViewAll,onIntelligence,onFindError}: {
  api:WorkbenchBackend; context:ProjectContext; active:boolean;
  onOpen:(key:string,seq:number)=>void; onViewAll:(bookmarks:boolean)=>void; onIntelligence:()=>void; onFindError?:(text:string)=>void;
}) {
  const [data,setData]=useState<Overview|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  useLibraryRefresh(()=>{
    let live=true;
    void api.projectOverview(context.path,context.host,context.local_only).then(next=>{
      if(live){setData(current=>sameJson(current,next)?current:next);setError("");}
    }).catch(cause=>{if(live)setError(String(cause));});
    return ()=>{live=false;};
  },[api,context.path,context.host,context.local_only,retry],active,400,api.onLibraryChanged);
  const scopeMatches=data?.path===context.path && data.host===context.host && data.local_only===context.local_only;
  const report=scopeMatches ? data : null;
  const intelligence=report?.intelligence;
  const title=context.path.split(/[\/]/).filter(Boolean).at(-1) ?? context.path;
  return <section aria-label="Project overview" className="min-h-0 flex-1 overflow-y-auto px-7 py-6 text-[14px]">
    <header className="mb-6 border-b border-border pb-5"><p className="label-mono text-muted-foreground">Project overview</p>
      <h2 className="mt-2 font-serif text-[34px]">{title}</h2><p className="break-all">{context.path}</p>
      <button type="button" className="my-2 underline" onClick={()=>onFindError?.("")}>Find error history in project</button>
      <p className="mt-2 text-muted-foreground">{context.local_only ? "Local sessions" : context.host ? `Remote host: ${context.host}` : "All hosts"}</p>
    </header>
    {error && <p role="alert">{error} <button type="button" onClick={()=>setRetry(value=>value+1)}>Retry project overview</button></p>}
    {!report ? !error && <p role="status">Loading project overview…</p> : <>
      <section aria-label="Project Intelligence"><h3 className="text-lg">Intelligence · last 30 days</h3>
        <p className="my-2 text-muted-foreground">Outcomes are inferred from recorded tool events. A commit command does not verify a fix.</p>
        {report.intelligence_error ? <p role="status">Analytics unavailable: {report.intelligence_error}. Sessions and bookmarks remain usable.</p>
          : intelligence ? <><p>{intelligence.totals.sessions} sessions · {hours(intelligence.totals.active_ms)} active · {intelligence.totals.tool_calls} tool calls · {intelligence.totals.tool_errors} tool errors</p>
            <details className="mt-3"><summary>Tool and timestamp coverage</summary><ul>{intelligence.coverage.map(row=><li key={row.agent}>{row.agent}: {row.with_tools}/{row.sessions} sessions with tools; {row.with_time}/{row.sessions} with usable timestamps</li>)}</ul></details>
            {!intelligence.coverage.length && <p>No derived coverage in this range.</p>}</> : <p>No analytics recorded.</p>}
      </section>
      <div className="grid gap-6 min-[1100px]:grid-cols-2">
      <section aria-label="Recent project sessions" className="min-w-0"><h3 className="text-lg">Recent sessions · {report.total_sessions}</h3>
        <button type="button" className="my-2 underline" onClick={()=>onViewAll(false)}>View all project sessions</button>
        {report.sessions.length ? <ul className="max-h-[250px] overflow-y-auto">{report.sessions.map(session=><li key={session.key} className="border-b border-border py-2">
          <button type="button" className="text-left" onClick={()=>onOpen(session.key,0)}>{session.title}</button>
          <p className="text-muted-foreground">{session.agent} · {session.host ? `@${session.host}` : "Local"} · {new Date(session.updated_at).toLocaleString()}</p>
        </li>)}</ul> : <p>No sessions in this project.</p>}
      </section>
      <section aria-label="Recent project bookmarks" className="min-w-0"><h3 className="text-lg">Recent bookmarks · {report.total_bookmarks}</h3>
        <button type="button" className="my-2 underline" onClick={()=>onViewAll(true)}>View all project bookmarks</button>
        {report.bookmarks.length ? <ul className="max-h-[250px] overflow-y-auto">{report.bookmarks.map(view=><li key={JSON.stringify([view.bookmark.session_key,view.bookmark.seq])} className="border-b border-border py-2">
          <button type="button" disabled={view.status==="unavailable"} className="text-left" onClick={()=>onOpen(view.bookmark.session_key,view.bookmark.seq)}>{view.session?.title ?? view.bookmark.title} · message #{view.bookmark.seq}</button>
          <p className="line-clamp-3 whitespace-pre-wrap">{view.bookmark.note || view.bookmark.excerpt}</p>
          <p className="text-muted-foreground">{view.session?.host ? `@${view.session.host}` : view.session ? "Local" : "Source unavailable"} · {view.status}</p>
        </li>)}</ul> : <p>No saved messages in this project.</p>}
      </section>
      <section aria-label="Recurring project errors" className="min-w-0 min-[1100px]:col-span-2"><h3 className="text-lg">Recurring errors · {report.total_errors}</h3>
        <button type="button" className="my-2 underline" onClick={onIntelligence}>View all project Intelligence</button>
        {report.errors.length ? <ul>{report.errors.map(bug=><li key={bug.signature} className="border-b border-border py-2"><p className="whitespace-pre-wrap">{bug.message}</p>
          <p>{bug.sessions} sessions · previous occurrences</p>
          <button type="button" className="mr-3 underline" onClick={()=>onFindError?.(bug.message)}>Find all occurrences of this error</button>
          {bug.evidence.map(evidence=><button type="button" className="mr-3 underline" key={JSON.stringify([evidence.session_key,evidence.seq])}
            onClick={()=>onOpen(evidence.session_key,evidence.seq)}>Open {evidence.title} · message #{evidence.seq}</button>)}
        </li>)}</ul> : <p>No recurring errors recorded in this range. Sessions without tools cannot contribute error evidence.</p>}
      </section>

      </div>
    </>}
  </section>;
}
