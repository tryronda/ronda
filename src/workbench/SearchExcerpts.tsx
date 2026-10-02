import { useEffect, useState } from "react";
import type { SearchExcerpt, SearchGroup, SessionQuery, WorkbenchBackend } from "./api";
import { searchRanges } from "./search-text";

export function SearchHighlight({ text, query }: { text: string; query: string }) {
  let offset = 0;
  const parts = searchRanges(text, query).map(({ start, end }) => {
    const before = text.slice(offset, start);
    offset = end;
    return <span key={start}>{before}<mark className="bg-sky text-foreground">{text.slice(start, end)}</mark></span>;
  });
  return <>{parts}{text.slice(offset)}</>;
}

/** Remount when the query/library revision changes so expanded pages cannot outlive their results. */
export function SearchExcerpts({ api, group, query, filter, choose }: {
  api: WorkbenchBackend; group: SearchGroup; query: string; filter: SessionQuery;
  choose: (seq: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [excerpts, setExcerpts] = useState<SearchExcerpt[]>(group.excerpts);
  const [total, setTotal] = useState(group.message_matches);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setLoading(true); setError("");
    void api.searchSessionMatches(query, filter, group.session.key, page * 20, 20).then(result => {
      if (cancelled) return;
      setExcerpts(previous => page ? [...previous, ...result.matches] : result.matches);
      setTotal(result.total_matches); setLoading(false);
    }).catch(cause => { if (!cancelled) { setError(String(cause)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [api, expanded, filter, group.session.key, page, query, retry]);
  return <div className="mb-2 px-3 pb-2 text-[13px]" aria-label={`Matches in ${group.session.title}`}>
    {(expanded ? excerpts : group.excerpts).map(excerpt => <button type="button" key={excerpt.seq}
      className="my-1 block w-full border-l-2 border-olive py-1 pl-2 text-left leading-normal text-ink-soft hover:bg-chip"
      onClick={() => choose(excerpt.seq)} aria-label={`Open message ${excerpt.seq}`}>
      <SearchHighlight text={excerpt.snippet} query={query} />
    </button>)}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry matches</button></p>}
    {group.message_matches > 3 && <button type="button" aria-expanded={expanded}
      className="mt-1 text-olive underline" disabled={loading}
      onClick={() => { setExpanded(value => !value); setPage(0); }}>
      {expanded ? "Show fewer matches" : `Show all ${group.message_matches} matches`}
    </button>}
    {expanded && excerpts.length < total && !error && <button type="button" className="ml-3 text-olive underline"
      disabled={loading} onClick={() => setPage(value => value + 1)}>Load more matches</button>}
    {loading && <span role="status" className="ml-2">Loading matches…</span>}
  </div>;
}
