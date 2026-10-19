import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export const CLAMP_LINES = 40;
export const CLAMP_CHARS = 4000;
export const REVEAL_EVENT = "ronda-reveal";

/** Whether tool text is long enough to be visually clamped, and its line count. */
export function clampInfo(text: string): { lines: number; clamped: boolean } {
  const lines = text.split("\n").length;
  return { lines, clamped: lines > CLAMP_LINES || text.length > CLAMP_CHARS };
}

export function ToolPre({ text, field, className }: { text: string; field: string; className?: string }) {
  const { lines, clamped } = clampInfo(text);
  const [expanded, setExpanded] = useState(false);
  const pre = useRef<HTMLPreElement>(null);
  const collapsed = clamped && !expanded;
  useEffect(() => {
    const element = pre.current;
    if (!element) return;
    const reveal = () => setExpanded(true);
    element.addEventListener(REVEAL_EVENT, reveal);
    return () => element.removeEventListener(REVEAL_EVENT, reveal);
  }, []);
  const id = `tool-pre-${useId().replace(/:/g, "")}`;
  return <>
    <pre ref={pre} id={id} data-transcript-field={field} data-clamped={collapsed ? "true" : undefined}
      className={cn("message-pre mt-1.5", collapsed && "message-pre-clamped", className)}>{text}</pre>
    {clamped && <button type="button" className="mt-1.5 block underline" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(value => !value)}>{expanded ? "Show less" : `Show all ${lines} lines`}</button>}
  </>;
}
