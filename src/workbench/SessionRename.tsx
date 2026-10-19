import { useState } from "react";
import { SESSION_ALIAS_TITLE_LIMIT, validateAliasInput } from "./session-alias";

/** Inline editor for a session's local title. Save, Cancel, and Escape; Reset title restores the source title. */
export function SessionRenameForm({ initial, sourceTitle, aliased, onSave, onReset, onCancel }: {
  initial: string; sourceTitle: string; aliased: boolean;
  onSave: (title: string) => string | null; onReset: () => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = () => {
    const invalid = validateAliasInput(value) ?? onSave(value);
    setProblem(invalid);
  };
  return <form className="flex flex-wrap items-center gap-2 border-b border-border px-7 py-2 text-[13px] max-[1100px]:px-5"
    aria-label="Rename session" onSubmit={event => { event.preventDefault(); submit(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>
    <label className="label-mono text-[12px] lowercase text-muted-foreground" htmlFor="session-title-input">Local title</label>
    <input id="session-title-input" autoFocus value={value} onChange={event => setValue(event.target.value)}
      aria-invalid={problem ? true : undefined} maxLength={SESSION_ALIAS_TITLE_LIMIT * 2} className="min-w-[12rem] flex-1 bg-chip px-2 py-1" />
    <button type="submit" className="bg-chip px-2 py-1">Save</button>
    <button type="button" className="bg-chip px-2 py-1" onClick={onCancel}>Cancel</button>
    {aliased && <button type="button" className="bg-chip px-2 py-1" onClick={onReset}>Reset title</button>}
    <p className="basis-full text-[12px] text-muted-foreground" role={problem ? "alert" : undefined}>
      {problem ?? `Original title: ${sourceTitle || "(none)"}. Stored only on this device; agent files are not changed.`}</p>
  </form>;
}
