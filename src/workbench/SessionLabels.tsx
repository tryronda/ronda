import { useEffect, useRef, useState } from "react";
import {
  LABEL_NAME_LIMIT, MAX_LABELS_PER_SESSION, MAX_SESSION_LABELS,
  type SessionLabel, type SessionMeta, type WorkbenchBackend,
} from "./api";

/** Mirrors the core limits so the form can explain a rejection before any write. */
export function validateLabelName(name: string, labels: SessionLabel[], exceptId?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a label name";
  if (Array.from(trimmed).length > LABEL_NAME_LIMIT || new TextEncoder().encode(trimmed).length > 160)
    return `Label names are limited to ${LABEL_NAME_LIMIT} characters`;
  const folded = trimmed.toLowerCase();
  if (labels.some(label => label.id !== exceptId && label.name.toLowerCase() === folded)) return "A label with that name already exists";
  return null;
}

const failure = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/** Create, rename, and delete labels. Deleting a label unassigns it from every session. */
export function LabelManager({ api, labels, onCatalog, onDeleted }: {
  api: WorkbenchBackend; labels: SessionLabel[]; onCatalog: (labels: SessionLabel[]) => void; onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [edited, setEdited] = useState("");
  const [message, setMessage] = useState("");
  const full = labels.length >= MAX_SESSION_LABELS;
  const focusRename = useRef<string | null>(null);
  useEffect(() => {
    if (editing === null && focusRename.current) {
      document.getElementById(`label-rename-button-${focusRename.current}`)?.focus();
      focusRename.current = null;
    }
  }, [editing]);
  const cancelRename = (id: string) => { focusRename.current = id; setEditing(null); setMessage(""); };
  const create = async () => {
    const problem = full ? `You can have at most ${MAX_SESSION_LABELS} labels` : validateLabelName(name, labels);
    if (problem) { setMessage(problem); return; }
    try {
      const created = await api.createSessionLabel(name.trim());
      onCatalog([...labels, created]); setName(""); setMessage("Label created");
    } catch (cause) { setMessage(failure(cause)); }
  };
  const rename = async (label: SessionLabel) => {
    const problem = validateLabelName(edited, labels, label.id);
    if (problem) { setMessage(problem); return; }
    try {
      const renamed = await api.renameSessionLabel(label.id, edited.trim());
      onCatalog(labels.map(item => item.id === label.id ? renamed : item)); setEditing(null); setMessage("Label renamed");
    } catch (cause) { setMessage(failure(cause)); }
  };
  const remove = async (label: SessionLabel) => {
    if (!window.confirm(`Delete the label “${label.name}”? It will be removed from every session.`)) return;
    try {
      await api.deleteSessionLabel(label.id);
      onCatalog(labels.filter(item => item.id !== label.id)); onDeleted(label.id); setMessage("Label deleted");
    } catch (cause) { setMessage(failure(cause)); }
  };
  return <details className="mt-2 text-[13px]">
    <summary className="cursor-pointer text-muted-foreground">Manage labels ({labels.length}/{MAX_SESSION_LABELS})</summary>
    <form className="mt-2 flex gap-1.5" onSubmit={event => { event.preventDefault(); void create(); }}>
      <label className="sr-only" htmlFor="new-label-name">New label name</label>
      <input id="new-label-name" value={name} onChange={event => { setName(event.target.value); setMessage(""); }} placeholder="New label"
        className="min-w-0 flex-1 bg-chip px-2 py-1" />
      <button type="submit" className="bg-chip px-2 py-1 hover:bg-foreground hover:text-background disabled:opacity-50" disabled={full}>Add</button>
    </form>
    <ul className="mt-1 max-h-40 overflow-y-auto">
      {labels.map(label => <li key={label.id} className="border-b border-border py-1.5">
        {editing === label.id ? <form className="flex gap-1" onSubmit={event => { event.preventDefault(); void rename(label); }}>
          <label className="sr-only" htmlFor={`label-rename-${label.id}`}>Rename label</label>
          <input id={`label-rename-${label.id}`} autoFocus value={edited} onChange={event => { setEdited(event.target.value); setMessage(""); }}
            onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelRename(label.id); } }}
            className="min-w-0 flex-1 bg-chip px-1 py-0.5" />
          <button type="submit" className="underline">Save</button>
          <button type="button" className="underline" onClick={() => cancelRename(label.id)}>Cancel</button>
        </form> : <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate">{label.name}</span>
          <button type="button" className="underline" id={`label-rename-button-${label.id}`} aria-label={`Rename label ${label.name}`}
            onClick={() => { setEditing(label.id); setEdited(label.name); setMessage(""); }}>Rename</button>
          <button type="button" className="underline" aria-label={`Delete label ${label.name}`} onClick={() => void remove(label)}>Delete</button>
        </div>}
      </li>)}
    </ul>
    {message && <p role="status" className="mt-1 text-[12px] text-muted-foreground">{message}</p>}
  </details>;
}

/** Assign or remove labels on the open session (at most four). */
export function SessionLabelEditor({ api, session, labels, onChange, onError }: {
  api: WorkbenchBackend; session: SessionMeta; labels: SessionLabel[]; onChange: (labels: string[]) => void; onError: (message: string) => void;
}) {
  const assigned = labels.filter(label => session.labels?.includes(label.id));
  const available = labels.filter(label => !session.labels?.includes(label.id));
  const atCap = assigned.length >= MAX_LABELS_PER_SESSION;
  const set = async (label: SessionLabel, on: boolean) => {
    try {
      await api.setSessionLabel(session.key, label.id, on);
      const current = session.labels ?? [];
      onChange(on ? [...current, label.id] : current.filter(id => id !== label.id));
    } catch (cause) { onError(failure(cause)); }
  };
  if (labels.length === 0) return null;
  return <div role="group" aria-label="Session labels" className="flex flex-wrap items-center gap-2 border-b border-border px-7 py-2 text-[13px] max-[1100px]:px-5">
    <span className="label-mono text-[12px] lowercase text-muted-foreground">Labels</span>
    {assigned.map(label => <span key={label.id} className="inline-flex items-center gap-1 bg-chip px-2 py-0.5">
      {label.name}
      <button type="button" className="leading-none text-muted-foreground hover:text-foreground" aria-label={`Remove label ${label.name}`}
        onClick={() => void set(label, false)}>×</button>
    </span>)}
    {available.length > 0 && <label className="inline-flex items-center gap-1">
      <span className="sr-only">Add label</span>
      <select aria-label="Add label" value="" disabled={atCap} className="bg-chip p-1"
        title={atCap ? `A session can have at most ${MAX_LABELS_PER_SESSION} labels` : undefined}
        onChange={event => { const label = available.find(item => item.id === event.target.value); if (label) void set(label, true); }}>
        <option value="">{atCap ? "Label limit reached" : "Add label…"}</option>
        {available.map(label => <option key={label.id} value={label.id}>{label.name}</option>)}
      </select>
    </label>}
  </div>;
}
