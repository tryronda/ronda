import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Archive01Icon, ArrowLeft01Icon, ArrowRight01Icon, Delete02Icon, Folder01Icon, PinIcon, ReloadIcon,
  Search01Icon, StarIcon, Download01Icon, Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/motion/button/base";
import { Loader } from "@/components/motion/loader";
import { SharedLayoutBg } from "@/components/motion/shared-layout-bg";
import { PixelField, PixelStrip } from "@/components/brand/pixel-field";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { inTauri } from "@/lib/tauri";
import { LibraryHome } from "./LibraryHome";
import {
  backend as defaultBackend, queryDefaults, type AgentId, type ProjectInfo,
  type SearchHit, type SessionMeta, type SessionQuery, type TranscriptMessage,
  type WorkbenchBackend,
} from "./api";

const copy = {
  library: "Library", workbench: "Workbench", insights: "Insights", settings: "Settings",
  search: "Search all conversations", projects: "Projects", all: "All sessions", favorites: "Starred",
  agents: "Agents", recent: "Recent sessions", refresh: "Refresh library", resume: "Resume", includeArchived: "Include archived",
  export: "Export Markdown", trash: "Move to Trash", pin: "Pin", unpin: "Unpin",
  star: "Star", unstar: "Unstar", noSessions: "No sessions found", noSessionsHint: "Connect an agent or refresh your library to get started.",
  noTranscript: "No transcript is available for this session.", noSelection: "Choose a session to read its story.",
  tools: "tool calls", thinking: "Thinking", project: "Project", model: "Model", unknown: "Unknown project",
  archived: "Archived", copyRemote: "SSH command copied", opened: "Opened in terminal", exported: "Transcript exported",
  deleteConfirm: "Move this session to the system Trash?", deleted: "Session moved to Trash",
  searchResults: "Search results", searching: "Searching…", searchEmpty: "No matching messages", matches: "matches",
  loading: "Loading library…", refreshing: "Refreshing library…", browse: "Browse sessions", sessions: "sessions", scanDone: "Library refreshed",
  transcript: "Transcript", terminal: "Terminal", terminalRunning: "running", terminalExited: "exited",
  restart: "Restart", stop: "Stop and close terminal", openExternal: "Open in system terminal",
  you: "You", assistant: "Assistant", note: "Note", localPrivate: "Local and private", error: "Error",
};

const agentNames: Record<AgentId, string> = {
  "claude-code": "Claude Code", codex: "Codex", grok: "Grok Build", dsh: "DeepSeek Harness",
  cursor: "Cursor", opencode: "OpenCode", pi: "Pi", omp: "Oh My Pi", kiro: "Kiro",
  kimi: "Kimi Code", gemini: "Gemini CLI", copilot: "Copilot CLI",
  antigravity: "Antigravity", qoder: "Qoder", hermes: "Hermes", openclaw: "OpenClaw",
  codebuddy: "CodeBuddy", workbuddy: "WorkBuddy",
};

// Markdown rendering is the heaviest dependency; keep it out of the startup bundle and warm it up once the shell is idle.
const loadStreamdown = () => import("streamdown");
const SessionTerminal = lazy(() => import("./SessionTerminal").then(module => ({ default: module.SessionTerminal })));
/** A resumed session's terminal; `run` remounts it for a restart. */
type TerminalEntry = { run: number; running: boolean; code: number | null };
const Streamdown = lazy(() => loadStreamdown().then(module => ({ default: module.Streamdown })));

function timeLabel(ms: number) {
  if (!ms) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(ms));
}

function basename(path: string) {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || path;
}

function plainTitle(title: string) {
  return title.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*|__|`/g, "");
}

function IconButton({ icon, title, onClick, active, disabled }: {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  title: string; onClick: () => void; active?: boolean; disabled?: boolean;
}) {
  return <motion.button type="button" whileTap={{ scale: 0.9 }}
    className={cn("grid size-8 flex-none place-items-center text-muted-foreground transition-colors hover:bg-chip hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
      active && "bg-chip text-foreground")}
    title={title} aria-label={title} aria-pressed={active} onClick={onClick} disabled={disabled}>
    <HugeiconsIcon icon={icon} size={16} strokeWidth={1.8} />
  </motion.button>;
}

function Message({ message, animate }: { message: TranscriptMessage; animate: boolean }) {
  const t = copy;
  const isUser = message.role === "user" && message.kind === "text";
  const isMeta = message.kind !== "text" || message.role === "system";
  return <article id={`message-${message.seq}`}
    className={cn("flex scroll-mt-6 items-start gap-4 border-b border-border py-6 last:border-b-0",
      isUser && "-mx-4 my-3 border-b-0 bg-chip px-4 py-4",
      animate && "animate-in fade-in fill-mode-both duration-200",
      "[contain-intrinsic-size:auto_180px] [content-visibility:auto]")}>
    <div aria-hidden="true" className={cn("label-mono grid size-6 flex-none place-items-center text-[10px]",
      isUser ? "bg-sky text-[#171717]" : isMeta ? "bg-chip text-muted-foreground" : "bg-foreground text-background")}>
      {isUser ? "Y" : isMeta ? "·" : "R"}</div>
    <div className="min-w-0 flex-1">
      <div className="label-mono flex min-h-6 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <strong className={cn("font-medium lowercase", isMeta ? "text-muted-foreground" : "text-foreground")}>{isUser ? t.you : isMeta ? t.note : t.assistant}</strong>
        <span>#{message.seq}</span>{message.timestamp && <time className="normal-case">{timeLabel(message.timestamp)}</time>}
        {message.model && <span className="ml-auto normal-case">{message.model}</span>}
      </div>
      {message.text && <Suspense fallback={<p className="markdown mt-1 whitespace-pre-wrap">{message.text}</p>}>
        <Streamdown mode="static" dir="auto" className="markdown mt-1">{message.text}</Streamdown></Suspense>}
      {message.images.length > 0 && <div className="my-3 flex flex-wrap gap-2.5">
        {message.images.map((image, index) => <img key={index} className="max-h-[300px] max-w-[min(100%,420px)] object-contain shadow-lift"
          src={`data:${image.media_type};base64,${image.data_base64}`}
          alt={`Attachment ${index + 1}`} loading="lazy" />)}
      </div>}
      {message.thinking && <details className="group mt-3 bg-canvas px-3 py-2 shadow-lift">
        <summary className="label-mono cursor-pointer text-[12px] lowercase text-muted-foreground">{t.thinking}</summary>
        <pre className="message-pre mt-2 border-0 bg-transparent p-0">{message.thinking}</pre></details>}
      {message.tool_calls.length > 0 && <details className="mt-3 bg-canvas px-3 py-2 shadow-lift">
        <summary className="label-mono cursor-pointer text-[12px] lowercase text-muted-foreground">{message.tool_calls.length} {t.tools}</summary>
        {message.tool_calls.map((tool, index) => <div className="mt-2 border-t border-border pt-2.5 text-[11px]" key={`${tool.id}-${index}`}>
          <strong className="label-mono text-foreground">{tool.name}</strong>
          {tool.is_error && <span className="label-mono ml-2 text-destructive">{t.error}</span>}
          {tool.input && <pre className="message-pre mt-1.5">{tool.input}</pre>}
          {tool.output && <pre className="message-pre mt-1.5 text-muted-foreground">{tool.output}</pre>}
        </div>)}
      </details>}
    </div>
  </article>;
}

export function Workbench({ api = defaultBackend, sidebarOpen = true, isActive = true,
  searchFocusToken = 0, homeToken = 0, openRequest = null, onActiveSessionChange }: {
  api?: WorkbenchBackend; sidebarOpen?: boolean; isActive?: boolean;
  searchFocusToken?: number; homeToken?: number;
  /** Opens a session at a message from elsewhere in the app; a new token repeats the request. */
  openRequest?: { key: string; seq: number; token: number } | null;
  onActiveSessionChange?: (session: { title: string; project: string | null } | null) => void;
}) {
  const t = copy;
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [project, setProject] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentId | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [terminals, setTerminals] = useState<Record<string, TerminalEntry>>({});
  const [terminalShown, setTerminalShown] = useState<Record<string, boolean>>({});
  const detailHeaderRef = useRef<HTMLElement>(null);
  const [detailHeaderHeight, setDetailHeaderHeight] = useState(88);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [jumpTo, setJumpTo] = useState<number | null>(null);
  const [opened, setOpened] = useState<SessionMeta | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const filter = useMemo<SessionQuery>(() => ({ ...queryDefaults, agent,
    project_path: project, starred_only: starredOnly, include_archived: includeArchived }), [agent, project, starredOnly, includeArchived]);

  const reload = useCallback(async () => {
    try {
      const [nextSessions, nextProjects] = await Promise.all([api.listSessions(filter), api.listProjects()]);
      setSessions(nextSessions);
      setProjects(nextProjects);
      setSelectedKey(previous => previous && nextSessions.some(s => s.key === previous)
        ? previous : null);
      setError(null);
    } catch (cause) { setError(String(cause)); }
    finally { setLoading(false); }
  }, [api, filter]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const idle = window.requestIdleCallback?.(() => void loadStreamdown()) ?? window.setTimeout(() => void loadStreamdown(), 600);
    return () => { if (window.cancelIdleCallback) window.cancelIdleCallback(idle); else window.clearTimeout(idle); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void api.onLibraryChanged(() => { if (!cancelled) void reload(); }).then(unlisten => {
      if (cancelled) unlisten(); else stop = unlisten;
    }).catch(() => {});
    let stop: (() => void) | undefined;
    return () => { cancelled = true; stop?.(); };
  }, [api, reload]);

  useEffect(() => {
    if (!selectedKey) { setMessages([]); setTranscriptLoading(false); return; }
    let cancelled = false;
    setMessages([]);
    setTranscriptLoading(true);
    void api.getTranscript(selectedKey).then(next => { if (!cancelled) setMessages(next); })
      .catch(cause => { if (!cancelled) setError(String(cause)); })
      .finally(() => { if (!cancelled) setTranscriptLoading(false); });
    return () => { cancelled = true; };
  }, [api, selectedKey]);

  useEffect(() => {
    if (!search.trim()) { setHits([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void api.searchSessions(search.trim(), { ...filter, include_archived: true }, 100).then(next => {
        if (!cancelled) { setHits(next); setSearching(false); }
      }).catch(cause => { if (!cancelled) { setError(String(cause)); setSearching(false); } });
    }, 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, filter, search]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && document.activeElement === searchRef.current) {
        setSearch(""); searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  useEffect(() => { if (isActive && searchFocusToken) searchRef.current?.focus(); }, [isActive, searchFocusToken]);
  useEffect(() => { if (homeToken) { setSelectedKey(null); setMobileDetail(false); } }, [homeToken]);
  useEffect(() => {
    if (!openRequest) return;
    let cancelled = false;
    // The session may sit outside the current filters, or be a subagent, so load its details directly.
    void api.getSession(openRequest.key).then(meta => {
      if (cancelled || !meta) return;
      setOpened(meta);
      setSelectedKey(meta.key);
      setJumpTo(openRequest.seq);
      setMobileDetail(true);
    }).catch(cause => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; };
  }, [api, openRequest]);
  const reduce = useReducedMotion();
  const shortcut = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl+";

  useEffect(() => {
    if (jumpTo === null || !messages.some(m => m.seq === jumpTo)) return;
    document.getElementById(`message-${jumpTo}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    setJumpTo(null);
  }, [jumpTo, messages]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selected = sessions.find(s => s.key === selectedKey) ?? hits.find(h => h.session.key === selectedKey)?.session
    ?? (opened?.key === selectedKey ? opened : null);
  useEffect(() => {
    onActiveSessionChange?.(selected ? { title: plainTitle(selected.title),
      project: selected.project_path ? basename(selected.project_path) : null } : null);
  }, [onActiveSessionChange, selected?.key, selected?.title, selected?.project_path]);
  const visible = search.trim() ? hits.map(hit => ({ session: hit.session, hit }))
    : sessions.map(session => ({ session, hit: null as SearchHit | null }));
  const agents = useMemo(() => Array.from(new Set(sessions.map(s => s.agent))).sort(), [sessions]);

  const choose = (session: SessionMeta, seq?: number) => {
    setSelectedKey(session.key);
    setJumpTo(seq ?? null);
    setMobileDetail(true);
  };

  const flag = async (kind: "starred" | "pinned") => {
    if (!selected) return;
    const starred = kind === "starred" ? !selected.starred : selected.starred;
    const pinned = kind === "pinned" ? !selected.pinned : selected.pinned;
    try {
      await api.setSessionFlags(selected.key, starred, pinned);
      setSessions(current => current.map(s => s.key === selected.key ? { ...s, starred, pinned } : s));
      setHits(current => current.map(h => h.session.key === selected.key ? { ...h, session: { ...h.session, starred, pinned } } : h));
    } catch (cause) { setError(String(cause)); }
  };

  const refresh = async () => {
    setScanning(true);
    try { await api.scan(); await reload(); setNotice(t.scanDone); }
    catch (cause) { setError(String(cause)); }
    finally { setScanning(false); }
  };

  // Terminals sit below the (variable-height) session header, outside the keyed transcript view.
  useEffect(() => {
    const header = detailHeaderRef.current;
    if (!header) return;
    const observer = new ResizeObserver(() => setDetailHeaderHeight(header.offsetHeight));
    observer.observe(header);
    return () => observer.disconnect();
  }, [selectedKey]);

  const showTerminal = (key: string, shown: boolean) => setTerminalShown(current => ({ ...current, [key]: shown }));

  const startTerminal = (key: string) => {
    setTerminals(current => {
      const existing = current[key];
      if (existing?.running) return current;
      return { ...current, [key]: { run: (existing?.run ?? 0) + 1, running: true, code: null } };
    });
    showTerminal(key, true);
  };

  const stopTerminal = (key: string) => {
    setTerminals(current => { const next = { ...current }; delete next[key]; return next; });
    showTerminal(key, false);
  };

  const openExternally = async () => {
    if (!selected) return;
    try {
      const command = await api.resumeSession(selected.key);
      if (selected.host) { await navigator.clipboard.writeText(command); setNotice(t.copyRemote); }
      else setNotice(t.opened);
    } catch (cause) { setError(String(cause)); }
  };

  const resume = async () => {
    if (!selected || selected.parent_key) return;
    if (inTauri()) { startTerminal(selected.key); return; }
    try {
      const command = await api.resumeSession(selected.key);
      if (selected.host) { await navigator.clipboard.writeText(command); setNotice(t.copyRemote); }
      else setNotice(t.opened);
    } catch (cause) { setError(String(cause)); }
  };

  const exportMarkdown = async () => {
    if (!selected) return;
    try {
      const destination = await save({ defaultPath: `${selected.title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80) || "session"}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }] });
      if (destination) { await api.exportSession(selected.key, destination); setNotice(t.exported); }
    } catch (cause) { setError(String(cause)); }
  };

  const trash = async () => {
    if (!selected || selected.parent_key || !window.confirm(t.deleteConfirm)) return;
    try { await api.trashSession(selected.key); await reload(); setNotice(t.deleted); }
    catch (cause) { setError(String(cause)); }
  };

  const heading = search.trim() ? t.searchResults : project ? basename(project) : starredOnly ? t.favorites : agent ? agentNames[agent] : t.recent;
  const navClass = (active: boolean) => cn("flex min-h-8 w-full items-center px-2.5 text-left text-[15px] tracking-[0.02em] whitespace-nowrap transition-colors",
    "[&>div:last-child]:flex [&>div:last-child]:w-full [&>div:last-child]:min-w-0 [&>div:last-child]:items-center [&>div:last-child]:gap-2.5",
    active ? "bg-chip text-foreground" : "text-foreground/60 hover:text-foreground");
  const sectionHeading = "label-mono mx-2.5 mt-6 mb-2 text-[12px] lowercase text-muted-foreground";

  return <div className={cn("workbench-layout relative flex h-full min-h-0 min-w-0", mobileDetail && "detail-open")}>
    <aside aria-label={t.library} aria-hidden={!sidebarOpen} inert={!sidebarOpen}
      className={cn("flex min-h-0 flex-none flex-col overflow-hidden border-r border-border bg-paper transition-[width,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
        sidebarOpen ? "w-[240px] px-2 pt-2 pb-3 opacity-100 max-[1100px]:w-[200px]" : "invisible w-0 border-r-0 p-0 opacity-0")}>
      <div className={sectionHeading}>{t.library}</div>
      <SharedLayoutBg inset={0} className="gap-px" pillClassName="rounded-none bg-chip/70">
        <button key="all" className={navClass(!project && !starredOnly && !agent)} type="button"
          onClick={() => { setProject(null); setAgent(null); setStarredOnly(false); }}>
          <HugeiconsIcon icon={Folder01Icon} size={16} strokeWidth={1.8} />{t.all}<span className="label-mono ml-auto text-muted-foreground">{sessions.length}</span>
        </button>
        <button key="starred" className={navClass(starredOnly)} type="button"
          onClick={() => { setProject(null); setAgent(null); setStarredOnly(true); }}>
          <HugeiconsIcon icon={StarIcon} size={16} strokeWidth={1.8} />{t.favorites}
        </button>
        <button key="archived" className={navClass(includeArchived)} type="button"
          aria-pressed={includeArchived} onClick={() => setIncludeArchived(value => !value)}>
          <HugeiconsIcon icon={Archive01Icon} size={16} strokeWidth={1.8} />{t.includeArchived}
        </button>
      </SharedLayoutBg>
      <div className={sectionHeading}>{t.projects}</div>
      <div className="max-h-[31vh] overflow-y-auto">
        {projects.map(item => <button className={navClass(project === item.path)}
          title={item.path} key={item.path} type="button" onClick={() => { setProject(item.path); setStarredOnly(false); setAgent(null); }}>
          <div className="flex w-full min-w-0 items-center gap-2.5">
            <HugeiconsIcon icon={Folder01Icon} size={16} strokeWidth={1.8} className="flex-none" /><span className="min-w-0 truncate">{basename(item.path)}</span>
            <span className="label-mono ml-auto text-muted-foreground">{item.session_count}</span>
          </div>
        </button>)}
      </div>
      {agents.length > 0 && <><div className={sectionHeading}>{t.agents}</div><div className="min-h-0 overflow-y-auto">
        {agents.map(item => <button className={navClass(agent === item)} key={item} type="button"
          onClick={() => { setAgent(item); setProject(null); setStarredOnly(false); }}>
          <div className="flex w-full min-w-0 items-center gap-2.5"><span className={`agent-dot agent-${item}`} />{agentNames[item]}</div></button>)}
      </div></>}
      <div className="mt-auto px-2.5 pt-5">
        <PixelStrip className="mb-3" />
        <div className="label-mono flex items-center gap-2 text-[12px] lowercase text-muted-foreground">
          <span className="size-1.5 bg-olive" />{t.localPrivate}
        </div>
      </div>
    </aside>

    <section aria-label={t.recent}
      className="session-pane flex min-h-0 w-[340px] flex-none flex-col border-r border-border bg-paper max-[1100px]:w-[300px]">
      <div className="flex-none border-b border-border px-4 pt-5 pb-3.5">
        <div className="label-mono text-[12px] lowercase text-muted-foreground">{t.browse}</div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <AnimatePresence mode="wait" initial={false}>
            <motion.h1 key={heading} className="m-0 min-w-0 truncate font-serif text-[30px] leading-[1.1] tracking-[-0.01em]"
              initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -4 }} transition={{ duration: 0.1, ease: EASE_OUT }}>
              {heading}</motion.h1>
          </AnimatePresence>
          <span className={scanning ? "[&_svg]:animate-spin" : undefined}><IconButton icon={ReloadIcon} title={t.refresh} onClick={() => void refresh()} disabled={scanning} /></span>
        </div>
        <p role="status" className="label-mono mt-1 mb-3.5 text-[12px] text-muted-foreground">{scanning ? t.refreshing : `${visible.length} ${search.trim() ? t.matches : t.sessions}`}</p>
        <label className="glass flex h-9 items-center gap-2 px-2.5 text-muted-foreground transition-shadow focus-within:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--foreground)]">
          <HugeiconsIcon icon={Search01Icon} size={15} strokeWidth={2} />
          <input ref={searchRef} type="search" value={search} onChange={event => setSearch(event.target.value)}
            placeholder={t.search} aria-label={t.search}
            className="w-full min-w-0 border-0 bg-transparent text-[15px] tracking-[0.02em] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:shadow-none" />
          <kbd className="label-mono flex-none bg-chip px-1.5 py-px text-[10px]">{shortcut}K</kbd></label>
      </div>
      <div className="session-list min-h-0 flex-1 overflow-y-auto p-2" aria-label={t.recent} aria-busy={loading || searching || scanning}
        onKeyDown={event => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          const cards = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".session-card"));
          const index = cards.indexOf(document.activeElement as HTMLButtonElement);
          const next = cards[index + (event.key === "ArrowDown" ? 1 : -1)];
          if (next) { event.preventDefault(); next.focus(); }
        }}>
        {loading && visible.length === 0 ? <div className="session-skeletons grid gap-1 p-1" role="status" aria-label={t.loading}>
          {[0, 1, 2, 3, 4].map(index => <div className="grid gap-2.5 px-2.5 py-3.5" key={index}>
            <i className="skeleton h-2 w-2/5" /><i className="skeleton h-3 w-4/5" /><i className="skeleton h-2 w-1/3" /></div>)}
        </div> : visible.length === 0 ? <div className="mx-5 mt-[18vh] flex flex-col items-center gap-3 text-center text-muted-foreground">
          {searching ? <Loader variant="dot-matrix" size={22} label={t.searching} className="text-foreground" />
            : <PixelField cols={4} rows={4} cell={9} seed={3} className="size-9" />}
          <strong className="text-[14px] font-medium text-foreground">{loading ? t.loading : search.trim() ? searching ? t.searching : t.searchEmpty : t.noSessions}</strong>
          {!search.trim() && <p className="m-0 text-[12px] leading-relaxed">{t.noSessionsHint}</p>}</div> : visible.map(({ session, hit }, index) =>
          <button key={`${session.key}-${hit?.seq ?? index}`} type="button"
            aria-current={selectedKey === session.key ? "true" : undefined}
            className={cn("session-card relative mb-1 block w-full px-3 py-3 text-left transition-[background-color,border-color,box-shadow] duration-100 [contain-intrinsic-size:auto_86px] [content-visibility:auto]",
              !reduce && index < 16 && "animate-in fade-in fill-mode-both duration-150",
              selectedKey === session.key ? "selected bg-paper shadow-lift" : "hover:bg-chip/70")}
            onClick={() => choose(session, hit?.seq)}>
            {selectedKey === session.key && <motion.span layoutId="session-marker" className="absolute top-0 bottom-0 left-0 w-[3px] bg-sky-deep"
              transition={{ type: "spring", stiffness: 700, damping: 45 }} />}
            <div className="label-mono flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
              <span className={`agent-dot agent-${session.agent}`} /><span className="whitespace-nowrap">{agentNames[session.agent]}</span>
              {session.host && <span>@{session.host}</span>}
              {session.pinned && <HugeiconsIcon icon={PinIcon} size={12} />}
              <time className="ml-auto whitespace-nowrap">{timeLabel(session.updated_at)}</time></div>
            <strong className="mt-1.5 mb-1 line-clamp-2 pr-4 text-[16px] leading-snug font-normal tracking-[0.015em] text-foreground">{plainTitle(session.title)}</strong>
            <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
              <HugeiconsIcon icon={Folder01Icon} size={12} className="flex-none" /><span className="truncate">{session.project_path ? basename(session.project_path) : t.unknown}</span></div>
            {hit && <div className="mt-2 line-clamp-2 border-l-2 border-olive pl-2 text-[13px] leading-normal text-ink-soft">{hit.snippet}</div>}
            {session.starred && <span className="absolute right-3 bottom-3 text-[12px] text-olive" aria-label={t.favorites}>★</span>}
          </button>)}
      </div>
    </section>

    <main className="transcript-pane relative flex min-h-0 min-w-0 flex-1 flex-col bg-paper" aria-label="Transcript">
      {selected ? <motion.div key={selected.key} className="flex min-h-0 flex-1 flex-col"
        initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12 }}>
        <header ref={detailHeaderRef} className="flex min-h-[88px] flex-none items-center justify-between gap-4 border-b border-border px-7 py-4 max-[1100px]:flex-wrap max-[1100px]:px-5">
          <button type="button" className="mobile-back hidden size-8 place-items-center hover:bg-chip"
            aria-label={t.browse} onClick={() => setMobileDetail(false)}><HugeiconsIcon icon={ArrowLeft01Icon} size={18} /></button>
          <div className="min-w-0">
            <div className="label-mono flex items-center gap-2 text-[12px] text-muted-foreground">
              <span className={`agent-dot agent-${selected.agent}`} />{agentNames[selected.agent]}
              {selected.archived && <span className="eyebrow-chip px-1.5 pt-0.5 pb-1 text-[11px]">{t.archived}</span>}
            </div>
            <h2 className="mt-1.5 mb-1 truncate font-serif text-[32px] leading-[1.1] tracking-[-0.01em]">{plainTitle(selected.title)}</h2>
            <div className="label-mono flex min-w-0 items-center gap-2 text-muted-foreground">
              <span className="truncate">{selected.project_path ?? t.unknown}</span>
              {selected.model && <><span className="text-border">/</span><span className="whitespace-nowrap">{selected.model}</span></>}
              {selected.host && <><span className="text-border">/</span><span>@{selected.host}</span></>}
            </div>
          </div>
          <div className="flex flex-none items-center gap-0.5">
            <IconButton icon={StarIcon} title={selected.starred ? t.unstar : t.star} active={selected.starred} onClick={() => void flag("starred")} />
            <IconButton icon={PinIcon} title={selected.pinned ? t.unpin : t.pin} active={selected.pinned} onClick={() => void flag("pinned")} />
            <IconButton icon={Download01Icon} title={t.export} onClick={() => void exportMarkdown()} />
            {selected.can_delete && !selected.host && !selected.parent_key && <IconButton icon={Delete02Icon} title={t.trash} onClick={() => void trash()} />}
            {terminals[selected.key] && <div className="ml-2 flex bg-chip p-0.5" role="tablist" aria-label={t.terminal}>
              {([[false, t.transcript], [true, t.terminal]] as const).map(([shown, label]) =>
                <button key={label} type="button" role="tab" aria-selected={!!terminalShown[selected.key] === shown}
                  onClick={() => showTerminal(selected.key, shown)}
                  className={cn("label-mono flex h-8 items-center gap-2 px-3 text-[12px] lowercase transition-colors",
                    !!terminalShown[selected.key] === shown ? "glass bg-paper text-foreground" : "text-foreground/50 hover:text-foreground")}>
                  {shown && <span className={cn("size-1.5", terminals[selected.key].running ? "animate-pulse bg-olive" : "bg-stone")} />}{label}
                </button>)}
            </div>}
            {selected.project_path && !selected.parent_key && !(terminals[selected.key]?.running && terminalShown[selected.key]) && <Button size="sm" onClick={() => void resume()}
              className="label-mono ml-2 h-9 gap-2 rounded-none px-3.5 text-[13px] lowercase">{t.resume}<HugeiconsIcon icon={ArrowRight01Icon} size={15} /></Button>}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth motion-reduce:scroll-auto" aria-busy={transcriptLoading}>
          {transcriptLoading ? <div className="transcript-skeleton mx-auto max-w-[780px] px-10 py-9" role="status" aria-label={t.loading}>
            {[0, 1, 2].map(index => <div className="flex gap-4 border-b border-border pt-5 pb-7" key={index}><i className="skeleton size-6 flex-none" />
              <div className="grid flex-1 content-start gap-3"><i className="skeleton h-2.5 w-1/5" /><i className="skeleton h-2.5 w-[88%]" /><i className="skeleton h-2.5 w-3/5" /></div></div>)}
          </div> : messages.length ? <div className="transcript-messages mx-auto max-w-[780px] px-10 pt-6 pb-24 max-[1100px]:px-6">
            {messages.map((message, index) => <Message key={message.seq} message={message} animate={!reduce && index < 10} />)}</div>
            : <div className="flex h-full flex-col items-center justify-center gap-4 text-[13px] text-muted-foreground">
              <PixelField cols={6} rows={3} cell={12} seed={11} className="w-[72px]" /><p className="m-0">{t.noTranscript}</p></div>}
        </div>
      </motion.div> : <motion.div key="home" className="flex min-h-0 flex-1 flex-col"
        initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12 }}>
        <LibraryHome sessions={sessions} projectCount={projects.length} agentNames={agentNames}
          shortcut={shortcut} scanning={scanning} onOpen={session => choose(session)} onSearch={() => searchRef.current?.focus()}
          onRefresh={() => void refresh()} titleOf={session => plainTitle(session.title)}
          projectOf={session => session.project_path ? basename(session.project_path) : t.unknown} timeOf={ms => timeLabel(ms)} />
      </motion.div>}
      {Object.entries(terminals).map(([key, entry]) => {
        const session = sessions.find(s => s.key === key) ?? (selected?.key === key ? selected : undefined);
        const visible = selectedKey === key && !!terminalShown[key];
        return <div key={key} className="terminal-layer absolute inset-x-0 bottom-0 flex flex-col bg-paper"
          style={{ top: detailHeaderHeight }} data-visible={visible} aria-hidden={!visible} inert={!visible}>
          <div className="label-mono flex h-10 flex-none items-center gap-3 border-b border-border px-5 text-[12px] text-muted-foreground">
            <span className={cn("size-1.5 flex-none", entry.running ? "animate-pulse bg-olive" : "bg-stone")} />
            <span className="whitespace-nowrap text-foreground">{entry.running ? t.terminalRunning : `${t.terminalExited}${entry.code === null ? "" : ` · ${entry.code}`}`}</span>
            {session && <span className="min-w-0 truncate">{agentNames[session.agent]} · {session.host ? `@${session.host}:` : ""}{session.project_path ?? t.unknown}</span>}
            <div className="ml-auto flex items-center gap-0.5">
              {!entry.running && <IconButton icon={ReloadIcon} title={t.restart} onClick={() => startTerminal(key)} />}
              <IconButton icon={ArrowRight01Icon} title={t.openExternal} onClick={() => void openExternally()} />
              <IconButton icon={Cancel01Icon} title={t.stop} onClick={() => stopTerminal(key)} />
            </div>
          </div>
          <div className="min-h-0 flex-1 py-3 pr-2 pl-5">
            <Suspense fallback={null}>
              <SessionTerminal key={entry.run} sessionKey={key} visible={visible}
                onExit={code => setTerminals(current => current[key] ? { ...current, [key]: { ...current[key], running: false, code } } : current)}
                onError={message => { setError(message); setTerminals(current => current[key] ? { ...current, [key]: { ...current[key], running: false } } : current); }} />
            </Suspense>
          </div>
        </div>;
      })}
    </main>
    <div className="pointer-events-none fixed right-6 bottom-5 z-20 flex flex-col items-end gap-2">
      <AnimatePresence>
        {error && <motion.div key="error" role="alert" layout
          initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.96 }}
          className="pointer-events-auto flex max-w-[min(440px,80vw)] items-center gap-3 bg-destructive px-3.5 py-2.5 text-[12px] text-white shadow-lg">
          <span>{error}</span><button type="button" className="text-[16px] leading-none opacity-80 hover:opacity-100" onClick={() => setError(null)} aria-label="Dismiss">×</button></motion.div>}
        {notice && <motion.div key={notice} role="status" layout
          initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.96 }}
          className="label-mono pointer-events-auto flex items-center gap-2.5 bg-foreground px-3.5 py-2.5 text-[12px] text-background shadow-lg">
          <span className="size-1.5 bg-sky-deep" />{notice}</motion.div>}
      </AnimatePresence>
    </div>
  </div>;
}
