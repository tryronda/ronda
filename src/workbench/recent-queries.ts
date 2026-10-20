import { useCallback, useEffect, useRef, useState } from "react";

export const RECENT_QUERIES_KEY = "recent_queries_v1";
export const RECENT_QUERY_LIMIT = 8;
export const RECENT_QUERY_CHARS = 512;
export const RECENT_QUERY_BYTES = 2048;
export const RECENT_QUERY_DOCUMENT_BYTES = 16 * 1024;

export interface RecentQueryDocument { version: 1; items: string[] }
export type RecentQueryParse = { ok: true; document: RecentQueryDocument } | { ok: false };
export type RecentQueryStatus = "loading" | "ready" | "invalid" | "unavailable";

const encoder = new TextEncoder();
const utf8Bytes = (value: string) => encoder.encode(value).length;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stored query is trimmed, nonempty, and within the same limits as a saved search. */
export const validRecentQuery = (value: unknown): value is string =>
  typeof value === "string" && value.trim() === value && value !== ""
  && Array.from(value).length <= RECENT_QUERY_CHARS && utf8Bytes(value) <= RECENT_QUERY_BYTES;

export function parseRecentQueries(raw: string | null): RecentQueryParse {
  if (raw === null) return { ok: true, document: { version: 1, items: [] } };
  if (utf8Bytes(raw) > RECENT_QUERY_DOCUMENT_BYTES) return { ok: false };
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value) || Object.keys(value).length !== 2 || value.version !== 1 || !Array.isArray(value.items)
      || value.items.length > RECENT_QUERY_LIMIT || !value.items.every(validRecentQuery)
      || new Set(value.items).size !== value.items.length) return { ok: false };
    return { ok: true, document: { version: 1, items: value.items as string[] } };
  } catch { return { ok: false }; }
}

export const serializeRecentQueries = (items: string[]) =>
  JSON.stringify({ version: 1, items } satisfies RecentQueryDocument);

/** Newest first, distinct by exact literal text; returns the same array when nothing changes. */
export function recordRecentQuery(items: string[], query: string): string[] {
  const text = query.trim();
  if (!validRecentQuery(text) || items[0] === text) return items;
  return [text, ...items.filter(item => item !== text)].slice(0, RECENT_QUERY_LIMIT);
}

interface PrefStore { getPref(key: string): Promise<string | null>; setPref(key: string, value: string): Promise<void> }

/** Loads and persists the list. An unreadable preference is never overwritten: it disables the feature. */
export function useRecentQueries(api: PrefStore) {
  const [items, setItems] = useState<string[]>([]);
  const [status, setStatus] = useState<RecentQueryStatus>("loading");
  const current = useRef<string[]>([]);
  const ready = useRef(false);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    let live = true;
    ready.current = false; current.current = []; setItems([]); setStatus("loading");
    void api.getPref(RECENT_QUERIES_KEY).then(raw => {
      if (!live) return;
      const parsed = parseRecentQueries(raw);
      if (!parsed.ok) { setStatus("invalid"); return; }
      current.current = parsed.document.items; ready.current = true;
      setItems(parsed.document.items); setStatus("ready");
    }).catch(() => { if (live) setStatus("unavailable"); });
    return () => { live = false; };
  }, [api]);
  const commit = useCallback((next: string[]) => {
    if (!ready.current || next === current.current) return;
    current.current = next; setItems(next);
    const value = serializeRecentQueries(next);
    writes.current = writes.current.catch(() => {}).then(() => api.setPref(RECENT_QUERIES_KEY, value)).catch(() => {});
  }, [api]);
  const record = useCallback((query: string) => commit(recordRecentQuery(current.current, query)), [commit]);
  const remove = useCallback((query: string) => commit(current.current.filter(item => item !== query)), [commit]);
  const clear = useCallback(() => commit(current.current.length ? [] : current.current), [commit]);
  return { items, status, record, remove, clear };
}
