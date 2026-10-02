import { useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { inTauri, invoke } from "@/lib/tauri";
import type { WorkbenchBackend } from "./api";
import { CONTEXT_LIMIT, contextLength, formatContext, loadContext, validateContext, type ContextSelection } from "./context-bundle";

export function ContextBundle({ api, selection, clear, embedded }: {
  api: Pick<WorkbenchBackend, "getSession" | "getTranscript">; selection: ContextSelection[]; clear: () => void; embedded: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [tools, setTools] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [edited, setEdited] = useState(false);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const generate = async () => {
    const next = formatContext(await loadContext(api, selection), { tools, thinking });
    setDraft(next); setEdited(false);
  };
  return <div className="mt-2 text-[13px]" aria-label="Context selection">
    <div className="flex flex-wrap gap-3">
      <button ref={trigger} type="button" disabled={(!selection.length && !draft) || busy} onClick={() => {
        dialog.current?.showModal();
        dialog.current?.querySelector("textarea")?.focus();
        if (!draft) void run(generate);
      }}>Preview context ({selection.length})</button>
      {selection.length > 0 && <button type="button" disabled={busy} onClick={clear}>Clear context selection</button>}
    </div>
    <dialog ref={dialog} aria-labelledby="context-heading" className="m-auto max-h-[90vh] w-[min(900px,94vw)] overflow-y-auto border border-border bg-paper p-5 text-foreground shadow-lg backdrop:bg-black/40"
      onClose={() => trigger.current?.focus()} onCancel={event => { if (busy) event.preventDefault(); }}>
      <h2 id="context-heading" className="font-serif text-2xl">Copy context for another agent</h2>
      <p className="my-3">Inspect the draft for secrets and personal paths before sharing it. Nothing is sent to another agent automatically. References identify local messages for the Ronda MCP tools; they are not promised operating-system links.</p>
      {embedded && <p className="my-3">This preview contains synthetic sample data.</p>}
      <div className="my-3 flex flex-wrap gap-4">
        <label><input type="checkbox" checked={tools} onChange={event => setTools(event.target.checked)} /> Include tool input and output</label>
        <label><input type="checkbox" checked={thinking} onChange={event => setThinking(event.target.checked)} /> Include thinking</label>
      </div>
      <p className="my-2 text-muted-foreground">Images and internal/system context are excluded. Changing options or selection requires regenerating the draft; closing keeps your edits.</p>
      <button type="button" disabled={busy || edited || !selection.length} onClick={() => void run(generate)}>Regenerate from selected messages</button>
      {edited && <p role="status" className="my-2">Your edits are kept. <button type="button" onClick={() => void run(generate)} disabled={busy || !selection.length}>Discard edits and regenerate</button></p>}
      <label className="my-3 block">Editable Markdown draft<textarea rows={16} value={draft} disabled={busy} onChange={event => { setDraft(event.target.value); setEdited(true); setNotice(""); }} className="mt-2 block w-full bg-chip p-3 font-mono text-[13px]" /></label>
      <p role="status">{contextLength(draft).toLocaleString()} / {CONTEXT_LIMIT.toLocaleString()} characters</p>
      <div className="my-3 flex flex-wrap gap-4">
        <button type="button" disabled={busy || !draft || contextLength(draft) > CONTEXT_LIMIT} onClick={() => void run(async () => {
          validateContext(draft); await navigator.clipboard.writeText(draft); setNotice("Context copied. Paste it into your chosen agent yourself.");
        })}>Copy context</button>
        <button type="button" disabled={busy || !draft || contextLength(draft) > CONTEXT_LIMIT} onClick={() => void run(async () => {
          validateContext(draft);
          if (inTauri() && !embedded) {
            const destination = await save({defaultPath:"ronda-context.md",filters:[{name:"Markdown",extensions:["md"]}]});
            if (!destination) return;
            await invoke("export_context", {destination, text:draft});
          } else {
            const url = URL.createObjectURL(new Blob([draft], {type:"text/markdown;charset=utf-8"}));
            const link = document.createElement("a"); link.href=url; link.download="ronda-context.md"; link.click(); URL.revokeObjectURL(url);
          }
          setNotice("Context exported");
        })}>Export context Markdown</button>
        <button type="button" disabled={busy} onClick={() => dialog.current?.close()}>Close context preview</button>
      </div>
      {error && <p role="alert" className="my-2 text-destructive">{error}</p>}
      {notice && <p role="status" className="my-2">{notice}</p>}
    </dialog>
  </div>;
}
