import { useEffect, useRef, useState } from "react";
import type { BookmarkView, WorkbenchBackend } from "./api";

export function BookmarkControl({ api, sessionKey, seq, view, changed }: {
  api: WorkbenchBackend; sessionKey: string; seq: number; view?: BookmarkView; changed: () => Promise<void>;
}) {
  const bookmark = view?.bookmark;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => { if (open) editor.current?.focus(); }, [open]);
  useEffect(() => {
    if (restoreFocus.current && !open && !busy) { toggle.current?.focus(); restoreFocus.current = false; }
  }, [open, busy]);
  const close = () => { restoreFocus.current = true; setOpen(false); setError(""); };
  const edit = () => { setNote(bookmark?.note ?? ""); setBaseUpdatedAt(bookmark?.updated_at ?? null); setOpen(true); setError(""); };
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const count = Array.from(note).length;
  return <div className="mt-3 text-[13px]" aria-label={`Bookmark for message ${seq}`}>
    <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
      <button ref={toggle} type="button" disabled={busy} aria-expanded={open} onClick={() => {
        if (bookmark) { if (open) close(); else edit(); }
        else void run(async () => {
          const saved = await api.saveBookmark(sessionKey, seq, "", false, null);
          await changed(); setNote(saved.note); setBaseUpdatedAt(saved.updated_at); setOpen(true);
        });
      }}>{bookmark ? `Edit bookmark note for message ${seq}` : `Bookmark message ${seq}`}</button>
      {bookmark && <button type="button" disabled={busy || open} onClick={() => void run(async () => {
        await api.deleteBookmark(sessionKey, seq); await changed();
      })}>Remove bookmark {seq}</button>}
    </div>
    {view?.status === "changed" && <div className="mt-2 bg-chip p-2" role="status">
      <p>Changed since bookmarking. The note still belongs to this saved excerpt:</p>
      <blockquote className="whitespace-pre-wrap">{bookmark?.excerpt}</blockquote>
      <button type="button" disabled={busy || open} onClick={() => void run(async () => {
        await api.saveBookmark(sessionKey, seq, bookmark!.note, true, bookmark!.updated_at); await changed();
      })}>Update saved excerpt to this message</button>
    </div>}
    {view?.status === "unavailable" && <p className="mt-2 text-muted-foreground">Message unavailable. Its saved excerpt and note are kept.</p>}
    {!open && bookmark?.note && <p className="mt-2 line-clamp-4 whitespace-pre-wrap">{bookmark.note}</p>}
    {open && <div className="mt-2 grid gap-2">
      <label>Note for message {seq}<textarea ref={editor} value={note} rows={4} className="mt-1 block w-full bg-chip p-2 text-foreground"
        onChange={event => setNote(event.target.value)} onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); close(); }
        }} /></label>
      <p role="status" className="text-muted-foreground">{count}/4,000 characters{note !== (bookmark?.note ?? "") ? " · Unsaved changes" : ""}</p>
      {bookmark && baseUpdatedAt !== bookmark.updated_at && <p role="alert">The saved note changed while you were editing. Your draft is kept; copy it before cancelling and reopening the note.</p>}
      <div className="flex gap-3">
        <button type="button" disabled={busy || count > 4000} onClick={() => void run(async () => {
          await api.saveBookmark(sessionKey, seq, note, false, baseUpdatedAt); await changed(); close();
        })}>{busy ? "Saving…" : "Save note"}</button>
        <button type="button" disabled={busy} onClick={close}>Cancel note</button>
      </div>
    </div>}
    {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
  </div>;
}
