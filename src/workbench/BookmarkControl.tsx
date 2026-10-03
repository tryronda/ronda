import { useEffect, useRef, useState } from "react";
import type { BookmarkView, MessageBookmark, WorkbenchBackend } from "./api";

export type BookmarkEditorState = {
  draft: { note: string; baseUpdatedAt: number | null } | null;
  busy: boolean;
  error: string;
};
export const emptyBookmarkEditor: BookmarkEditorState = { draft: null, busy: false, error: "" };

export function BookmarkControl({ api, sessionKey, seq, view, editorState, updateEditor, changed }: {
  api: WorkbenchBackend; sessionKey: string; seq: number; view?: BookmarkView;
  editorState: BookmarkEditorState; updateEditor: (update: (current: BookmarkEditorState) => BookmarkEditorState) => void;
  changed: (saved: MessageBookmark | null, refreshed?: boolean) => Promise<void>;
}) {
  const bookmark = view?.bookmark;
  const [open, setOpen] = useState(false);
  const { draft, busy, error } = editorState;
  const note = draft?.note ?? bookmark?.note ?? "";
  const baseUpdatedAt = draft ? draft.baseUpdatedAt : bookmark?.updated_at ?? null;
  const editor = useRef<HTMLTextAreaElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => { if (open && !busy) editor.current?.focus(); }, [open, busy]);
  useEffect(() => {
    if (restoreFocus.current && !open && !busy) { toggle.current?.focus(); restoreFocus.current = false; }
  }, [open, busy]);
  const close = (discard = false) => {
    restoreFocus.current = true; setOpen(false);
    updateEditor(current => ({ ...current, draft: discard ? null : current.draft, error: "" }));
  };
  const edit = () => {
    updateEditor(current => ({ ...current, draft: current.draft ?? { note: bookmark?.note ?? "", baseUpdatedAt: bookmark?.updated_at ?? null }, error: "" }));
    setOpen(true);
  };
  const run = async (work: () => Promise<void>) => {
    updateEditor(current => ({ ...current, busy: true, error: "" }));
    try { await work(); } catch (reason) { updateEditor(current => ({ ...current, error: String(reason) })); }
    finally { updateEditor(current => ({ ...current, busy: false })); }
  };
  const count = Array.from(note).length;
  return <div className="mt-3 text-[13px]" aria-label={`Bookmark for message ${seq}`}>
    <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
      <button ref={toggle} type="button" disabled={busy} aria-expanded={open} onClick={() => {
        if (bookmark || draft) { if (open) close(); else edit(); }
        else void run(async () => {
          const saved = await api.saveBookmark(sessionKey, seq, "", false, null);
          updateEditor(current => ({ ...current, draft: { note: saved.note, baseUpdatedAt: saved.updated_at } }));
          setOpen(true); await changed(saved);
        });
      }}>{bookmark || draft ? `Edit bookmark note for message ${seq}` : `Bookmark message ${seq}`}</button>
      {bookmark && <button type="button" disabled={busy || open} onClick={() => void run(async () => {
        await api.deleteBookmark(sessionKey, seq);
        updateEditor(current => ({ ...current, draft: null }));
        try { await changed(null); } catch (reason) { throw new Error(`Bookmark removed, but refreshing bookmarks failed: ${String(reason)}`); }
      })}>Remove bookmark {seq}</button>}
    </div>
    {view?.status === "changed" && <div className="mt-2 bg-chip p-2" role="status">
      <p>Changed since bookmarking. The note still belongs to this saved excerpt:</p>
      <blockquote className="whitespace-pre-wrap">{bookmark?.excerpt}</blockquote>
      <button type="button" disabled={busy || open} onClick={() => void run(async () => {
        const saved = await api.saveBookmark(sessionKey, seq, bookmark!.note, true, bookmark!.updated_at);
        updateEditor(current => ({ ...current, draft: current.draft?.baseUpdatedAt === bookmark!.updated_at ? { ...current.draft, baseUpdatedAt: saved.updated_at } : current.draft }));
        await changed(saved, true);
      })}>Update saved excerpt to this message</button>
    </div>}
    {view?.status === "unavailable" && <p className="mt-2 text-muted-foreground">Message unavailable. Its saved excerpt and note are kept.</p>}
    {!open && bookmark?.note && <p className="mt-2 line-clamp-4 whitespace-pre-wrap">{bookmark.note}</p>}
    {!open && draft && note !== (bookmark?.note ?? "") && <p role="status" className="mt-2 text-muted-foreground">Unsaved note draft kept for this app session.</p>}
    {draft && baseUpdatedAt !== null && !bookmark && <p role="alert" className="mt-2">The saved bookmark was removed. Your draft is kept; copy it before discarding.</p>}
    {open && <div className="mt-2 grid gap-2">
      <label>Note for message {seq}<textarea ref={editor} value={note} disabled={busy} rows={4} className="mt-1 block w-full bg-chip p-2 text-foreground"
        onChange={event => { const value = event.target.value; updateEditor(current => ({ ...current, draft: { note: value, baseUpdatedAt: current.draft ? current.draft.baseUpdatedAt : bookmark?.updated_at ?? null } })); }} onKeyDown={event => {
          if (event.key === "Escape" && !busy) { event.preventDefault(); close(true); }
        }} /></label>
      <p role="status" className="text-muted-foreground">{count}/4,000 characters{note !== (bookmark?.note ?? "") ? " · Unsaved changes" : ""}</p>
      {bookmark && baseUpdatedAt !== bookmark.updated_at && <p role="alert">The saved note changed while you were editing. Your draft is kept; copy it before cancelling and reopening the note.</p>}
      <div className="flex gap-3">
        <button type="button" disabled={busy || count > 4000 || (baseUpdatedAt !== null && !bookmark)} onClick={() => void run(async () => {
          const saved = await api.saveBookmark(sessionKey, seq, note, false, baseUpdatedAt);
          close(true);
          try { await changed(saved); } catch (reason) { throw new Error(`Note saved, but refreshing bookmarks failed: ${String(reason)}`); }
        })}>{busy ? "Saving…" : "Save note"}</button>
        <button type="button" disabled={busy} onClick={() => close(true)}>Cancel note</button>
      </div>
    </div>}
    {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
  </div>;
}
