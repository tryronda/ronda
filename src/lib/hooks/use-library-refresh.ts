import { useEffect, useRef } from 'react';
import { listen } from '@/lib/tauri';

/**
 * Runs `refresh` when `deps` change and whenever the library changes on disk.
 * While `active` is false, library changes only mark the data stale, and the refresh
 * waits until the page is shown again. Bursts of change events are coalesced.
 */
export function useLibraryRefresh(refresh: () => () => void, deps: unknown[], active = true, delay = 400) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const activeRef = useRef(active);
  activeRef.current = active;
  const stale = useRef(false);
  const cancel = useRef<(() => void) | undefined>(undefined);

  const run = () => { stale.current = false; cancel.current?.(); cancel.current = refreshRef.current(); };

  useEffect(() => {
    if (activeRef.current) run(); else stale.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (active && stale.current) run();
  }, [active]);

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    let unlisten: (() => void) | undefined;
    void listen('library-changed', () => {
      if (!activeRef.current) { stale.current = true; return; }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (live) run(); }, delay);
    }).then(stop => { if (live) unlisten = stop; else stop(); });
    return () => { live = false; window.clearTimeout(timer); unlisten?.(); cancel.current?.(); };
  }, [delay]);
}

/** Cheap structural equality for IPC payloads, so identical refreshes skip a re-render. */
export function sameJson(a: unknown, b: unknown) {
  return a === b || (a != null && b != null && JSON.stringify(a) === JSON.stringify(b));
}
