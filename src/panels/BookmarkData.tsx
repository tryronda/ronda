import { useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { inTauri, invoke } from "@/lib/tauri";
import type { BookmarkImport, BookmarkReplacement } from "@/workbench/api";

export function BookmarkData({ embedded = false }: { embedded?: boolean }) {
  const native = inTauri() && !embedded;
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [backup, setBackup] = useState<string | null>(null);
  const [report, setReport] = useState<BookmarkImport | null>(null);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const importBackup = async (json: string, replacements: BookmarkReplacement[] = []) => {
    const next = await invoke<BookmarkImport>("import_bookmarks", {json,replacements});
    setBackup(json); setReport(next);
    setNotice(`${next.imported} imported · ${next.unchanged} unchanged · ${next.conflicts.length} conflicts kept`);
  };
  return <div className="mt-6 border-t border-border pt-5" aria-label="Bookmark backups">
    <h3>Bookmark backups</h3>
    <p className="panel-help">Bookmarks and notes cannot be reconstructed from agent files. Export them before moving or deleting your index database. Imports keep conflicting saved notes until you explicitly replace them.</p>
    {embedded && <p className="panel-help">This preview uses synthetic bookmarks. Changes reset when you reload the page; exported files contain only sample data.</p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => void run(async () => {
        if (native) {
          const destination = await save({defaultPath:"ronda-bookmarks.json",filters:[{name:"Bookmark backup",extensions:["json"]}]});
          if (!destination) return;
          await invoke("export_bookmarks", {destination});
        } else {
          const json = await invoke<string>("get_bookmark_backup");
          const url = URL.createObjectURL(new Blob([json],{type:"application/json"}));
          const link = document.createElement("a"); link.href=url; link.download="ronda-bookmarks.json";
          link.click(); URL.revokeObjectURL(url);
        }
        setNotice("Bookmark backup exported");
      })}>Export bookmarks</button>
      <button type="button" disabled={busy} onClick={() => {
        if (!native) { picker.current?.click(); return; }
        void run(async () => {
          const source = await open({multiple:false,filters:[{name:"Bookmark backup",extensions:["json"]}]});
          if (typeof source !== "string") return;
          setBackup(null); setReport(null);
          await importBackup(await invoke<string>("read_bookmark_backup",{source}));
        });
      }}>Import bookmarks</button>
      <input ref={picker} hidden type="file" accept=".json,application/json" aria-label="Import bookmark backup file" onChange={event => {
        const file = event.target.files?.[0]; event.target.value="";
        if (!file) return;
        setBackup(null); setReport(null);
        void run(async () => importBackup(await file.text()));
      }} />
    </div>
    {notice && <p className="panel-help mt-3" role="status">{notice}</p>}
    {error && <p role="alert" className="mt-3 text-destructive">{error}</p>}
    {report?.conflicts.map(({existing,incoming}) => <div key={`${existing.session_key}:${existing.seq}`} className="mt-4 border border-border p-3">
      <h4>{existing.title} · message #{existing.seq}</h4>
      <p className="panel-help">Your saved version is kept. Review both excerpts and notes before replacing it.</p>
      <strong>Existing excerpt</strong><blockquote className="whitespace-pre-wrap">{existing.excerpt}</blockquote>
      <strong>Existing note</strong><p className="whitespace-pre-wrap">{existing.note || "No note"}</p>
      <strong>Imported excerpt</strong><blockquote className="whitespace-pre-wrap">{incoming.excerpt}</blockquote>
      <strong>Imported note</strong><p className="whitespace-pre-wrap">{incoming.note || "No note"}</p>
      <button type="button" disabled={busy} onClick={() => { if (backup) void run(() => importBackup(backup,[{
        session_key:existing.session_key,seq:existing.seq,expected_updated_at:existing.updated_at,
      }])); }}>Replace with imported bookmark</button>
    </div>)}
  </div>;
}
