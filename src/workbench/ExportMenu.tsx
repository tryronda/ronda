import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import type { ExportOptions } from "./api";

/** Popover for the session export control: two opt-in detail switches, then save or copy. */
export function ExportMenu({ onExport, onCopy }: {
  onExport: (options: ExportOptions) => void | Promise<void>;
  onCopy: (options: ExportOptions) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ExportOptions>({ includeTools: false, includeThinking: false });
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", escape); };
  }, [open]);
  const action = "label-mono bg-chip px-3 py-2 text-[12px] hover:bg-foreground hover:text-background";
  return <div ref={root} className="relative">
    <button type="button" title="Export Markdown" aria-label="Export Markdown" aria-haspopup="dialog" aria-expanded={open}
      className={cn("grid size-8 flex-none place-items-center text-muted-foreground transition-colors hover:bg-chip hover:text-foreground", open && "bg-chip text-foreground")}
      onClick={() => setOpen(value => !value)}>
      <HugeiconsIcon icon={Download01Icon} size={16} strokeWidth={1.8} />
    </button>
    {open && <div role="dialog" aria-label="Export options" className="absolute right-0 top-9 z-20 grid w-72 gap-3 border border-border bg-paper p-3 text-[13px] shadow-lg">
      <label className="flex items-center gap-2"><input type="checkbox" checked={options.includeTools}
        onChange={event => setOptions({ ...options, includeTools: event.target.checked })} />Include tool input and output</label>
      {options.includeTools && <p role="note" className="text-muted-foreground">Tool output may contain secrets.</p>}
      <label className="flex items-center gap-2"><input type="checkbox" checked={options.includeThinking}
        onChange={event => setOptions({ ...options, includeThinking: event.target.checked })} />Include thinking</label>
      <div className="flex gap-2">
        <button type="button" className={action} onClick={() => { setOpen(false); void onExport(options); }}>Export Markdown…</button>
        <button type="button" className={action} onClick={() => { setOpen(false); void onCopy(options); }}>Copy as Markdown</button>
      </div>
    </div>}
  </div>;
}
