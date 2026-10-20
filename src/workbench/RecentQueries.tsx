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
