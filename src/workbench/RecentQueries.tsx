export function RecentQueries({items,onApply,onRemove,onClear}:{items:string[];onApply:(query:string)=>void;onRemove:(query:string)=>void;onClear:()=>void}) {
  if(!items.length)return null;
  // Keep focus in the search box while the pointer uses the list; keyboard users Tab into it.
  return <section aria-label="Recent searches" className="glass mt-1 px-2.5 py-1.5 text-[13px]" onMouseDown={event=>event.preventDefault()}>
    <div className="flex items-center justify-between">
      <h3 className="label-mono text-[11px] text-muted-foreground">Recent searches</h3>
      <button type="button" className="text-[12px] underline" onClick={onClear}>Clear recent</button>
    </div>
    <ul>{items.map(query=><li key={query} className="flex items-center gap-2">
      <button type="button" className="min-w-0 flex-1 truncate py-1 text-left" title={query} onClick={()=>onApply(query)}>{query}</button>
      <button type="button" className="flex-none text-[12px] underline" aria-label={`Remove recent search ${query}`} onClick={()=>onRemove(query)}>Remove</button>
    </li>)}</ul>
  </section>;
}

/** Shown in place of the list when the stored preference cannot be used. Mouse use keeps focus in the search box. */
export function RecentQueriesRecovery({status,onReset,onRetry}:{status:"invalid"|"unavailable";onReset:()=>void;onRetry:()=>void}) {
  return <section aria-label="Recent searches" role="status" className="glass mt-1 px-2.5 py-1.5 text-[13px]" onMouseDown={event=>event.preventDefault()}>
    {status==="invalid"
      ? <><p>Recent searches could not be read. Their stored data is unchanged.</p>
        <button type="button" className="mt-1 text-[12px] underline" onClick={onReset}>Reset recent searches</button></>
      : <><p>Could not read recent searches.</p>
        <button type="button" className="mt-1 text-[12px] underline" onClick={onRetry}>Retry</button></>}
  </section>;
}
