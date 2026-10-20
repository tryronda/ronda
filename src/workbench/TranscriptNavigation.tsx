import { useEffect, useRef, useState, type RefObject } from "react";
import { REVEAL_EVENT } from "./ToolPre";
import { transcriptMatches, type TranscriptMatch } from "./transcript-find";

/** Index of the prompt nearest to the viewport top in the given direction, or -1. */
export function nearestPrompt(tops: number[], viewportTop: number, direction: 1 | -1): number {
  if (direction === 1) return tops.findIndex(top => top > viewportTop + 1);
  for (let i = tops.length - 1; i >= 0; i--) if (tops[i] < viewportTop - 1) return i;
  return -1;
}

export function TranscriptNavigation({ container, scope, active, embedded, promptsOnly, setPromptsOnly, reducedMotion, jumpToken, findRequest, onBeforeProgrammaticScroll }: {
  container: RefObject<HTMLDivElement | null>; scope: RefObject<HTMLDivElement | null>;
  active: boolean; embedded: boolean; promptsOnly: boolean; setPromptsOnly: (value: boolean) => void; reducedMotion: boolean; jumpToken: number; findRequest?:{text:string;token:number}|null;
  onBeforeProgrammaticScroll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [thinking, setThinking] = useState(false);
  const [matches, setMatches] = useState<TranscriptMatch[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); toggle.current?.focus(); };
  const index = Math.max(0, matches.findIndex(match => match.id === cursor));
  const current = matches[index];
  const move = (direction: number) => {
    if (matches.length) setCursor(matches[(index + direction + matches.length) % matches.length].id);
  };

  useEffect(() => { setOpen(false); }, [jumpToken]);
  useEffect(()=>{if(findRequest){setQuery(findRequest.text);setCursor(null);setOpen(true);}},[findRequest]);
  useEffect(() => {
    if (open && active) input.current?.focus();
  }, [open, active]);
  const jumpRef = useRef<(direction: 1 | -1) => void>(() => {});
  const jumpPrompt = (direction: 1 | -1) => jumpRef.current(direction);
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (embedded && !(event.target instanceof Node && scope.current?.contains(event.target))) return;
      const editing = event.target instanceof HTMLElement && event.target.closest("input,textarea,[contenteditable='true'],[role='textbox'],.xterm");
      if (editing && event.target !== input.current) return;
      if ((event.key === "[" || event.key === "]") && !event.metaKey && !event.ctrlKey && !event.altKey && !editing
        && event.target instanceof Node && container.current?.contains(event.target)) {
        event.preventDefault(); jumpPrompt(event.key === "]" ? 1 : -1); return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault(); setOpen(true); input.current?.focus(); input.current?.select();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active, embedded, scope]);
  useEffect(() => {
    const element = container.current;
    if (!element || !active || !open) return;
    const collect = () => setMatches(transcriptMatches(element, query, thinking));
    collect();
    const observer = new MutationObserver(collect);
    observer.observe(element, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [active, container, open, query, thinking, promptsOnly]);
  useEffect(() => {
    if (!active || !open || !current) return;
    let parent = current.range.startContainer.parentElement;
    while (parent && parent !== container.current) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      if (parent.dataset.clamped === "true") parent.dispatchEvent(new Event(REVEAL_EVENT));
      parent = parent.parentElement;
    }
    const target = current.range.startContainer.parentElement;
    onBeforeProgrammaticScroll?.();
    target?.scrollIntoView({ block: "center", behavior: reducedMotion ? "instant" : "smooth" });
    const selection = window.getSelection();
    selection?.removeAllRanges(); selection?.addRange(current.range);
    return () => {
      if (selection?.rangeCount && selection.getRangeAt(0) === current.range) selection.removeAllRanges();
    };
  }, [active, open, current, container, reducedMotion, onBeforeProgrammaticScroll]);

  const edge = (last: boolean) => {
    const articles = container.current?.querySelectorAll("article[id^='message-']");
    onBeforeProgrammaticScroll?.();
    (last ? articles?.[articles.length - 1] : articles?.[0])?.scrollIntoView({ block: last ? "end" : "start", behavior: reducedMotion ? "instant" : "smooth" });
  };
  jumpRef.current = (direction: 1 | -1) => {
    const element = container.current;
    if (!element) return;
    const prompts = Array.from(element.querySelectorAll<HTMLElement>("article[data-prompt]"));
    const top = element.getBoundingClientRect().top;
    const target = prompts[nearestPrompt(prompts.map(prompt => prompt.getBoundingClientRect().top), top, direction)];
    if (!target) return;
    onBeforeProgrammaticScroll?.();
    target.scrollIntoView({ block: "start", behavior: reducedMotion ? "instant" : "smooth" });
  };
  const setAllDetails = (value: boolean) => container.current?.querySelectorAll("details").forEach(details => { details.open = value; });
  return <div hidden={!active} className={`${active ? "flex" : "hidden"} flex-none flex-wrap items-center gap-3 border-b border-border px-5 py-2 text-[13px]`} aria-label="Transcript navigation">
    <button ref={toggle} type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>Find in transcript</button>
    <button type="button" onClick={() => edge(false)}>First message</button>
    <button type="button" onClick={() => edge(true)}>Last message</button>
    <button type="button" onClick={() => jumpPrompt(-1)}>Previous prompt</button>
    <button type="button" onClick={() => jumpPrompt(1)}>Next prompt</button>
    <button type="button" onClick={() => setAllDetails(true)}>Expand all</button>
    <button type="button" onClick={() => setAllDetails(false)}>Collapse all</button>
    <label className="ml-auto flex items-center gap-1"><input type="checkbox" checked={promptsOnly} onChange={event => setPromptsOnly(event.target.checked)} />Prompts only</label>
    {open && <div className="flex w-full flex-wrap items-center gap-2">
      <input ref={input} type="search" aria-label="Find in transcript" value={query} placeholder="Find text in this transcript"
        className="min-w-0 flex-1 bg-chip px-2 py-1" onChange={event => { setQuery(event.target.value); setCursor(null); }}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
          else if (event.key === "Escape") { event.preventDefault(); close(); }
        }} />
      <span role="status" aria-live="polite">{query && !matches.length ? `No matches${thinking ? "" : ". Try Include thinking"}` : `${matches.length ? index + 1 : 0} of ${matches.length}`}</span>
      <button type="button" aria-label="Previous match" disabled={!matches.length} onClick={() => move(-1)}>↑</button>
      <button type="button" aria-label="Next match" disabled={!matches.length} onClick={() => move(1)}>↓</button>
      <label className="flex items-center gap-1"><input type="checkbox" checked={thinking} onChange={event => setThinking(event.target.checked)} />Include thinking</label>
      <button type="button" aria-label="Close transcript find" onClick={close}>×</button>
    </div>}
  </div>;
}
