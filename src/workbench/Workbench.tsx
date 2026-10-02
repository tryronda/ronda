import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect, type ReactNode } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Archive01Icon, ArrowLeft01Icon, ArrowRight01Icon, Delete02Icon, Folder01Icon, PinIcon, ReloadIcon,
  Search01Icon, StarIcon, Download01Icon, Cancel01Icon, Bookmark01Icon,
} from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/motion/button/base";
import { Loader } from "@/components/motion/loader";
import { SharedLayoutBg } from "@/components/motion/shared-layout-bg";
import { PixelField, PixelStrip } from "@/components/brand/pixel-field";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { inTauri } from "@/lib/tauri";
import { useLibraryRefresh, sameJson } from "@/lib/hooks/use-library-refresh";
import { calendarRange, matchesSession, restoredFilters } from "./library-filters";
import { LibraryHome } from "./LibraryHome";
import { BookmarkControl } from "./BookmarkControl";
import { TranscriptNavigation } from "./TranscriptNavigation";
import { SearchExcerpts, SearchHighlight } from "./SearchExcerpts";
import {
  backend as defaultBackend, queryDefaults, type AgentId, type ProjectInfo,
  type SearchGroup, type SearchSort, type SessionMeta, type SessionQuery, type TranscriptMessage,
  type WorkbenchBackend, type BookmarkView, type LibraryOptions,
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

function Message({ message, animate, children }: { message: TranscriptMessage; animate: boolean; children?: ReactNode }) {
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
      {message.text && <div data-transcript-field="text"><Suspense fallback={<p className="markdown mt-1 whitespace-pre-wrap">{message.text}</p>}>
        <Streamdown mode="static" dir="auto" className="markdown mt-1">{message.text}</Streamdown></Suspense></div>}
      {message.images.length > 0 && <div className="my-3 flex flex-wrap gap-2.5">
        {message.images.map((image, index) => <img key={index} className="max-h-[300px] max-w-[min(100%,420px)] object-contain shadow-lift"
          src={`data:${image.media_type};base64,${image.data_base64}`}
          alt={`Attachment ${index + 1}`} loading="lazy" />)}
      </div>}
      {message.thinking && <details className="group mt-3 bg-canvas px-3 py-2 shadow-lift">
        <summary className="label-mono cursor-pointer text-[12px] lowercase text-muted-foreground">{t.thinking}</summary>
        <pre data-transcript-field="thinking" className="message-pre mt-2 border-0 bg-transparent p-0">{message.thinking}</pre></details>}
      {message.tool_calls.length > 0 && <details className="mt-3 bg-canvas px-3 py-2 shadow-lift">
        <summary className="label-mono cursor-pointer text-[12px] lowercase text-muted-foreground">{message.tool_calls.length} {t.tools}</summary>
        {message.tool_calls.map((tool, index) => <div className="mt-2 border-t border-border pt-2.5 text-[11px]" key={`${tool.id}-${index}`}>
          <strong className="label-mono text-foreground">{tool.name}</strong>
          {tool.is_error && <span className="label-mono ml-2 text-destructive">{t.error}</span>}
          {tool.input && <pre data-transcript-field={`tool-${index}-input`} className="message-pre mt-1.5">{tool.input}</pre>}
          {tool.output && <pre data-transcript-field={`tool-${index}-output`} className="message-pre mt-1.5 text-muted-foreground">{tool.output}</pre>}
        </div>)}
      </details>}
      {children}
    </div>
  </article>;
}

export function Workbench({ api = defaultBackend, sidebarOpen = true, isActive = true, embedded = false,
  searchFocusToken = 0, homeToken = 0, openRequest = null, onActiveSessionChange }: {
  api?: WorkbenchBackend; sidebarOpen?: boolean; isActive?: boolean; embedded?: boolean;
  searchFocusToken?: number; homeToken?: number;
  /** Opens a session at a message from elsewhere in the app; a new token repeats the request. */
  openRequest?: { key: string; seq: number; token: number } | null;
  onActiveSessionChange?: (session: { title: string; project: string | null } | null) => void;
}) {
  const t = copy;
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkView[]>([]);
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const bookmarkRun = useRef(0);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);
  const [promptsOnly, setPromptsOnly] = useState(false);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [project, setProject] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentId | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateThrough, setDateThrough] = useState("");
  const [model, setModel] = useState("");
  const [host, setHost] = useState("");
  const [options, setOptions] = useState<LibraryOptions>({agents:[],models:[],hosts:[],projects:[]});
  const dates = useMemo(() => {
    try { return {range:calendarRange(dateFrom,dateThrough),error:null}; }
    catch (cause) { return {range:{},error:cause instanceof Error ? cause.message : String(cause)}; }
  }, [dateFrom,dateThrough]);
  const clearFilters = () => {
    setProject(null); setAgent(null); setStarredOnly(false); setIncludeArchived(false);
    setDateFrom(""); setDateThrough(""); setModel(""); setHost("");
  };
  const [search, setSearch] = useState("");
  const [terminals, setTerminals] = useState<Record<string, TerminalEntry>>({});
  const [terminalShown, setTerminalShown] = useState<Record<string, boolean>>({});
  const detailHeaderRef = useRef<HTMLElement>(null);
  const [detailHeaderHeight, setDetailHeaderHeight] = useState(88);
  const [hits, setHits] = useState<SearchGroup[]>([]);
  const [searchSort, setSearchSort] = useState<SearchSort>("relevance");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const preferenceTouched = useRef(false);
  const preferenceWrite = useRef(Promise.resolve());
  useEffect(() => {
    let cancelled=false;
    setPreferencesLoaded(false);
    void api.getPref("library_filters").then(raw => {
      if (cancelled) return;
      setPreferencesLoaded(true);
      if (preferenceTouched.current) return;
      const saved=restoredFilters(raw);
      if (!saved) return;
      setProject(saved.project); setAgent(saved.agent); setStarredOnly(saved.starredOnly); setIncludeArchived(saved.includeArchived);
      setDateFrom(saved.dateFrom); setDateThrough(saved.dateThrough); setModel(saved.model); setHost(saved.host); setSearchSort(saved.searchSort);
    }).catch(cause=>{if (!cancelled) setError(`Could not restore filters: ${String(cause)}`);});
    return ()=>{cancelled=true;};
  },[api]);
  useEffect(() => {
    if (!preferencesLoaded || dates.error) return;
    const value=JSON.stringify({project,agent,starredOnly,includeArchived,dateFrom,dateThrough,model,host,searchSort});
    // Serialize writes so an older preference cannot finish after a newer choice.
    preferenceWrite.current=preferenceWrite.current.catch(()=>{}).then(()=>api.setPref("library_filters",value))
      .catch(cause=>setError(`Could not save filters: ${String(cause)}`));
  },[api,preferencesLoaded,project,agent,starredOnly,includeArchived,dateFrom,dateThrough,model,host,searchSort,dates.error]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const browseOffset = useRef(0);
  const browseBusy = useRef(false);
  const pageGeneration = useRef(0);
  const searchOffset = useRef(0);
  const searchBusy = useRef(false);
  const searchRun = useRef(0);
  const [searchTotals, setSearchTotals] = useState({ sessions: 0, messages: 0 });
  const [searchContext, setSearchContext] = useState({ query: "", filter: queryDefaults, revision: 0 });
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [transcriptJumpToken, setTranscriptJumpToken] = useState(0);
  const [jumpTo, setJumpTo] = useState<number | null>(null);
  const [opened, setOpened] = useState<SessionMeta | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [revision, setRevision] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const loadedKey = useRef<string | null>(null);
  const reloadRun = useRef(0);
  const scrollRestore = useRef<{ bottom: boolean; seq: string | null; offset: number; top: number } | null>(null);

  const filter = useMemo<SessionQuery>(() => ({ ...queryDefaults, agent,
    project_path: project, starred_only: starredOnly, include_archived: includeArchived,
    ...dates.range, model:model || null, host:host.startsWith("remote:") ? host.slice(7) : null, local_only:host === "local" }),
    [agent, project, starredOnly, includeArchived, dates, model, host]);

  useEffect(() => {
    pageGeneration.current++;
    if (sessionListRef.current) sessionListRef.current.scrollTop = 0;
    browseBusy.current = false; setLoadingMore(false);
    setSessions(current => {
      const first = current.slice(0,100);
      browseOffset.current = first.length;
      return current.length > 100 ? first : current;
    });
  }, [search,searchSort]);

  const reload = useCallback(async () => {
    const run = ++reloadRun.current;
    browseBusy.current = false; setLoadingMore(false); setLoading(true);
    if (dates.error) { setLoading(false); return; }
    try {
      const [page, nextOptions] = await Promise.all([api.sessionPage(filter,0,100), api.libraryOptions()]);
      if (run !== reloadRun.current) return;
      if (sessionListRef.current) sessionListRef.current.scrollTop = 0;
      setSessions(page.items); setSessionTotal(page.total); browseOffset.current = page.offset + page.items.length;
      setProjects(nextOptions.projects);
      setOptions(nextOptions);
      setRevision(value => value + 1);
      setError(null);
    } catch (cause) { if (run === reloadRun.current) setError(String(cause)); }
    finally { if (run === reloadRun.current) setLoading(false); }
  }, [api, filter, dates.error]);

  const loadMoreSessions = async () => {
    if (loading || browseBusy.current || dates.error || browseOffset.current >= sessionTotal) return;
    const run = reloadRun.current, generation = pageGeneration.current;
    browseBusy.current = true; setLoadingMore(true);
    try {
      const page = await api.sessionPage(filter,browseOffset.current,100);
      if (run !== reloadRun.current || generation !== pageGeneration.current) return;
      if (page.total !== sessionTotal) { await reload(); return; }
      browseOffset.current = page.offset + page.items.length;
      setSessions(current => [...new Map([...current,...page.items].map(session=>[session.key,session])).values()]);
      setError(null);
    } catch (cause) { if (run === reloadRun.current && generation === pageGeneration.current) setError(String(cause)); }
    finally { if (run === reloadRun.current && generation === pageGeneration.current) { browseBusy.current = false; setLoadingMore(false); } }
  };
  const subscribeToLibrary = useCallback((changed: () => void) => api.onLibraryChanged(() => {
    // Cancel pending pages immediately; the shared hook still coalesces the actual refresh.
    reloadRun.current++; searchRun.current++; setLoading(true); setSearching(false);
    changed();
  }), [api]);

  const reloadBookmarks = useCallback(async () => {
    const run = ++bookmarkRun.current;
    const next = await api.listBookmarks("", queryDefaults);
    if (run === bookmarkRun.current) setBookmarks(next);
  }, [api]);
  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    void reloadBookmarks().catch(cause => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; bookmarkRun.current++; };
  }, [isActive, revision, reloadBookmarks]);
  const bookmarkByMessage = useMemo(() => new Map(bookmarks.map(view => [`${view.bookmark.session_key}:${view.bookmark.seq}`, view])), [bookmarks]);
  const visibleBookmarks = bookmarks.filter(({bookmark, session}) => {
    if (agent && (session?.agent ?? bookmark.agent) !== agent) return false;
    if (project && (session?.project_path ?? bookmark.project_path) !== project) return false;
    const metadataFilter = {...filter,agent:null,project_path:null,include_archived:true,starred_only:false};
    if ((host || model || dateFrom || dateThrough) && (!session || !matchesSession(session,metadataFilter))) return false;
    const text = `${session?.title ?? bookmark.title}\n${bookmark.note}\n${bookmark.excerpt}`.toLowerCase();
    return search.trim().toLowerCase().split(/\s+/).filter(Boolean).every(term => text.includes(term));
  });
  const projectOptions = useMemo(() => {
    if (!bookmarksOnly) return projects;
    const known = new Set(projects.map(project => project.path));
    const extra: ProjectInfo[] = [];
    for (const {bookmark} of bookmarks) {
      if (bookmark.project_path && !known.has(bookmark.project_path)) {
        known.add(bookmark.project_path);
        extra.push({path:bookmark.project_path, session_count:0, updated_at:bookmark.updated_at});
      }
    }
    return [...projects, ...extra];
  }, [projects, bookmarks, bookmarksOnly]);

  useLibraryRefresh(() => { void reload(); return () => { reloadRun.current++; }; }, [reload], isActive, 400, subscribeToLibrary);
  useEffect(() => {
    const idle = window.requestIdleCallback?.(() => void loadStreamdown()) ?? window.setTimeout(() => void loadStreamdown(), 600);
    return () => { if (window.cancelIdleCallback) window.cancelIdleCallback(idle); else window.clearTimeout(idle); };
  }, []);
  useEffect(() => {
    if (!isActive) return;
    if (!selectedKey) { setMessages([]); setTranscriptLoading(false); loadedKey.current = null; return; }
    let cancelled = false;
    const firstLoad = loadedKey.current !== selectedKey;
    loadedKey.current = selectedKey;
    if (firstLoad) {
      setPromptsOnly(false);
      setMessages([]); setTranscriptLoading(true); setUnavailable(false); setNewMessages(false);
      scrollRestore.current = null;
    }
    void Promise.all([api.getSession(selectedKey), api.getTranscript(selectedKey)]).then(([meta, next]) => {
      if (cancelled) return;
      setUnavailable(!meta);
      if (!meta) return;
      setOpened(meta);
      setMessages(current => {
        if (sameJson(current, next)) return current;
        const container = transcriptRef.current;
        if (!firstLoad && container) {
          const bottom = container.scrollHeight - container.scrollTop - container.clientHeight < 48;
          const rect = container.getBoundingClientRect();
          const anchor = Array.from(container.querySelectorAll<HTMLElement>('article[id]'))
            .find(item => item.getBoundingClientRect().bottom > rect.top && next.some(message => item.id === `message-${message.seq}`));
          scrollRestore.current = { bottom, seq: anchor?.id ?? null,
            offset: anchor ? anchor.getBoundingClientRect().top - rect.top : 0, top: container.scrollTop };
          if (!bottom && next.some(message => !current.some(old => old.seq === message.seq))) setNewMessages(true);
        }
        return next;
      });
    }).catch(cause => { if (!cancelled) setError(String(cause)); })
      .finally(() => { if (!cancelled) setTranscriptLoading(false); });
    return () => { cancelled = true; };
  }, [api, selectedKey, revision, isActive]);

  useLayoutEffect(() => {
    const container = transcriptRef.current;
    const restore = scrollRestore.current;
    scrollRestore.current = null;
    if (!container || !restore) return;
    if (restore.bottom) { container.scrollTop = container.scrollHeight; setNewMessages(false); }
    else {
      const anchor = restore.seq ? container.querySelector<HTMLElement>(`#${restore.seq}`) : null;
      container.scrollTop = anchor
        ? container.scrollTop + anchor.getBoundingClientRect().top - container.getBoundingClientRect().top - restore.offset
        : restore.top;
    }
  }, [messages]);

  useEffect(() => {
    const run = ++searchRun.current;
    searchOffset.current = 0; searchBusy.current = false;
    if (!isActive) { setSearching(false); return; }
    if (dates.error || bookmarksOnly || !search.trim()) { setHits([]); setSearching(false); return; }
    searchBusy.current = true; setSearching(true);
    const timer = window.setTimeout(() => {
      void api.searchGrouped(search.trim(),filter,searchSort,0,50).then(next => {
        if (run !== searchRun.current) return;
        setHits(next.groups);
        searchOffset.current = 50;
        setSearchTotals({sessions:next.total_sessions,messages:next.total_message_matches});
        setSearchContext({query:search.trim(),filter,revision});
        setError(null);
      }).catch(cause => { if (run === searchRun.current) setError(String(cause)); })
        .finally(() => { if (run === searchRun.current) { searchBusy.current = false; setSearching(false); } });
    },120);
    return () => { searchRun.current++; window.clearTimeout(timer); };
  }, [api,filter,search,searchSort,revision,isActive,bookmarksOnly,dates.error]);

  const loadMoreSearch = async () => {
    if (loading || searchBusy.current || dates.error || searchOffset.current >= searchTotals.sessions) return;
    const run = searchRun.current;
    searchBusy.current = true; setSearching(true);
    try {
      const next = await api.searchGrouped(search.trim(),filter,searchSort,searchOffset.current,50);
      if (run !== searchRun.current) return;
      if (next.total_sessions !== searchTotals.sessions || next.total_message_matches !== searchTotals.messages) { await reload(); return; }
      searchOffset.current += 50;
      setHits(current => [...new Map([...current,...next.groups].map(group=>[group.session.key,group])).values()]);
      setError(null);
    } catch (cause) { if (run === searchRun.current) setError(String(cause)); }
    finally { if (run === searchRun.current) { searchBusy.current = false; setSearching(false); } }
  };

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
  useEffect(() => { if (homeToken) { setSelectedKey(null); setMobileDetail(false); setBookmarksOnly(false); } }, [homeToken]);
  useEffect(() => {
    if (!openRequest) return;
    let cancelled = false;
    // The session may sit outside the current filters, or be a subagent, so load its details directly.
    void api.getSession(openRequest.key).then(meta => {
      if (cancelled || !meta) return;
      setOpened(meta);
      setSelectedKey(meta.key);
      setPromptsOnly(false);
      setTranscriptJumpToken(value => value + 1);
      setJumpTo(openRequest.seq);
      setMobileDetail(true);
    }).catch(cause => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; };
  }, [api, openRequest]);
  const reduce = useReducedMotion();
  const shortcut = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl+";

  useEffect(() => {
    if (jumpTo === null || transcriptLoading || !messages.some(m => m.seq === jumpTo)) return;
    const target = transcriptRef.current?.querySelector<HTMLElement>(`#message-${jumpTo}`);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: reduce ? "instant" : "smooth" });
    setJumpTo(null);
  }, [jumpTo, messages, transcriptLoading, reduce, promptsOnly]);

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
  const visible = search.trim() ? hits.map(group => ({ session: group.session, group }))
    : sessions.map(session => ({ session, group: null as SearchGroup | null }));
  const agents = useMemo(() => Array.from(new Set(bookmarksOnly ? bookmarks.map(view => view.session?.agent ?? view.bookmark.agent) : options.agents)).sort(), [options, bookmarks, bookmarksOnly]);

  const choose = (session: SessionMeta, seq?: number) => {
    setOpened(session);
    setSelectedKey(session.key);
    if (seq !== undefined) { setPromptsOnly(false); setTranscriptJumpToken(value => value + 1); }
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

  const heading = bookmarksOnly ? "Bookmarks" : search.trim() ? t.searchResults : project ? basename(project) : starredOnly ? t.favorites : agent ? agentNames[agent] : t.recent;
  const navClass = (active: boolean) => cn("flex min-h-8 w-full items-center px-2.5 text-left text-[15px] tracking-[0.02em] whitespace-nowrap transition-colors",
    "[&>div:last-child]:flex [&>div:last-child]:w-full [&>div:last-child]:min-w-0 [&>div:last-child]:items-center [&>div:last-child]:gap-2.5",
    active ? "bg-chip text-foreground" : "text-foreground/60 hover:text-foreground");
  const sectionHeading = "label-mono mx-2.5 mt-6 mb-2 text-[12px] lowercase text-muted-foreground";

  return <div ref={scopeRef} onChangeCapture={()=>{preferenceTouched.current=true;}} onClickCapture={()=>{preferenceTouched.current=true;}} className={cn("workbench-layout relative flex h-full min-h-0 min-w-0", mobileDetail && "detail-open")}>
    <aside aria-label={t.library} aria-hidden={!sidebarOpen} inert={!sidebarOpen}
      className={cn("flex min-h-0 flex-none flex-col overflow-hidden border-r border-border bg-paper transition-[width,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
        sidebarOpen ? "w-[240px] px-2 pt-2 pb-3 opacity-100 max-[1100px]:w-[200px]" : "invisible w-0 border-r-0 p-0 opacity-0")}>
      <div className={sectionHeading}>{t.library}</div>
      <SharedLayoutBg inset={0} className="gap-px" pillClassName="rounded-none bg-chip/70">
        <button key="all" className={navClass(!bookmarksOnly && !project && !starredOnly && !agent && !host && !model && !dateFrom && !dateThrough && !includeArchived)} type="button"
          onClick={() => { clearFilters(); setBookmarksOnly(false); }}>
          <HugeiconsIcon icon={Folder01Icon} size={16} strokeWidth={1.8} />{t.all}<span className="label-mono ml-auto text-muted-foreground">{sessionTotal}</span>
        </button>
        <button key="starred" className={navClass(!bookmarksOnly && starredOnly)} type="button"
          onClick={() => { setStarredOnly(value=>!value); setBookmarksOnly(false); }}>
          <HugeiconsIcon icon={StarIcon} size={16} strokeWidth={1.8} />{t.favorites}
        </button>
        <button key="bookmarks" className={navClass(bookmarksOnly)} type="button" onClick={() => {
          setBookmarksOnly(true); setProject(null); setAgent(null); setStarredOnly(false);
        }}><HugeiconsIcon icon={Bookmark01Icon} size={16} />Bookmarks<span className="label-mono ml-auto text-muted-foreground">{bookmarks.length}</span></button>
        {!bookmarksOnly && <button key="archived" className={navClass(includeArchived)} type="button"
          aria-pressed={includeArchived} onClick={() => setIncludeArchived(value => !value)}>
          <HugeiconsIcon icon={Archive01Icon} size={16} strokeWidth={1.8} />{t.includeArchived}
        </button>}
      </SharedLayoutBg>
      <div className={sectionHeading}>{t.projects}</div>
      <div className="max-h-[31vh] overflow-y-auto">
        {projectOptions.map(item => <button className={navClass(project === item.path)}
          title={item.path} key={item.path} type="button" onClick={() => setProject(value=>value === item.path ? null : item.path)}>
          <div className="flex w-full min-w-0 items-center gap-2.5">
            <HugeiconsIcon icon={Folder01Icon} size={16} strokeWidth={1.8} className="flex-none" /><span className="min-w-0 truncate">{basename(item.path)}</span>
            <span className="label-mono ml-auto text-muted-foreground">{item.session_count}</span>
          </div>
        </button>)}
      </div>
      {agents.length > 0 && <><div className={sectionHeading}>{t.agents}</div><div className="min-h-0 overflow-y-auto">
        {agents.map(item => <button className={navClass(agent === item)} key={item} type="button"
          onClick={() => setAgent(value=>value === item ? null : item)}>
          <div className="flex w-full min-w-0 items-center gap-2.5"><span className={`agent-dot agent-${item}`} />{agentNames[item]}</div></button>)}
      </div></>}
      <div className="mt-auto px-2.5 pt-5">
        <PixelStrip className="mb-3" />
        <div className="label-mono flex items-center gap-2 text-[12px] lowercase text-muted-foreground">
          <span className="size-1.5 bg-olive" />{t.localPrivate}
        </div>
      </div>
    </aside>

    <section aria-label={bookmarksOnly ? "Bookmarks" : t.recent}
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
        <p role="status" className="label-mono mt-1 mb-3.5 text-[12px] text-muted-foreground">{dates.error ? "Choose a valid date range" : scanning ? t.refreshing : bookmarksOnly ? `${visibleBookmarks.length} saved messages` : search.trim() ? `Showing ${hits.length} of ${searchTotals.sessions} sessions · ${searchTotals.messages} matching messages` : `Showing ${sessions.length} of ${sessionTotal} sessions`}</p>
        <label className="glass flex h-9 items-center gap-2 px-2.5 text-muted-foreground transition-shadow focus-within:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--foreground)]">
          <HugeiconsIcon icon={Search01Icon} size={15} strokeWidth={2} />
          <input ref={searchRef} type="search" value={search} onChange={event => setSearch(event.target.value)}
            placeholder={bookmarksOnly ? "Search notes and saved excerpts" : t.search} aria-label={bookmarksOnly ? "Search bookmarks" : t.search}
            className="w-full min-w-0 border-0 bg-transparent text-[15px] tracking-[0.02em] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:shadow-none" />
          <kbd className="label-mono flex-none bg-chip px-1.5 py-px text-[10px]">{shortcut}K</kbd></label>
        <details className="mt-2 text-[13px]">
          <summary className="cursor-pointer text-muted-foreground">Filters</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label>Updated from<input aria-label="Updated from" type="date" value={dateFrom}
              onInput={event=>setDateFrom(event.currentTarget.value)} className="mt-1 w-full min-w-0 bg-chip p-1" /></label>
            <label>Updated through<input aria-label="Updated through" type="date" value={dateThrough}
              onInput={event=>setDateThrough(event.currentTarget.value)} className="mt-1 w-full min-w-0 bg-chip p-1" /></label>
            <label>Model<select aria-label="Filter by model" value={model} onChange={event=>setModel(event.target.value)} className="mt-1 w-full min-w-0 bg-chip p-1">
              <option value="">All models</option>{[...new Set([...options.models,...(model ? [model] : [])])].map(value=><option key={value}>{value}</option>)}
            </select></label>
            <label>Host<select aria-label="Filter by host" value={host} onChange={event=>setHost(event.target.value)} className="mt-1 w-full min-w-0 bg-chip p-1">
              <option value="">All hosts</option><option value="local">Local sessions</option>
              {[...new Set([...options.hosts,...(host.startsWith("remote:") ? [host.slice(7)] : [])])].map(value=><option value={`remote:${value}`} key={value}>{value}</option>)}
            </select></label>
            <button type="button" className="text-left underline" onClick={clearFilters}>Clear filters</button>
          </div>
          <p className="mt-2 text-muted-foreground">Dates use session update time in your local time zone, including the entire end day.</p>
        </details>
        {dates.error && <p role="alert" className="mt-2 text-destructive">{dates.error}</p>}
        {!bookmarksOnly && search.trim() && <label className="label-mono mt-2 flex items-center gap-2 text-[12px] text-muted-foreground">
          Sort results
          <select aria-label="Sort search results" value={searchSort} className="min-w-0 bg-paper p-1 text-foreground"
            onChange={event => setSearchSort(event.target.value as SearchSort)}>
            <option value="relevance">Relevance</option><option value="recent">Recent</option>
          </select>
        </label>}
      </div>
      <div ref={sessionListRef} className="session-list min-h-0 flex-1 overflow-y-auto p-2" aria-label={t.recent} aria-busy={loading || loadingMore || searching || scanning}
        onKeyDown={event => {
          if (event.target instanceof HTMLElement && event.target.closest("textarea,input,[contenteditable='true']")) return;
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          const cards = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".session-card"));
          const index = cards.indexOf(document.activeElement as HTMLButtonElement);
          const next = cards[index + (event.key === "ArrowDown" ? 1 : -1)];
          if (next) { event.preventDefault(); next.focus(); }
        }}>
        {bookmarksOnly ? <>
          {visibleBookmarks.length === 0 && <p className="m-5 text-muted-foreground">No matching bookmarks. Save a message from a transcript to keep its excerpt and add a note.</p>}
          {visibleBookmarks.map(view => <div key={`${view.bookmark.session_key}:${view.bookmark.seq}`} className="border-b border-border p-3">
            <button className="session-card w-full text-left" type="button" disabled={!view.session || view.status === "unavailable"}
              onClick={() => { if (view.session) choose(view.session, view.bookmark.seq); }}>
              <strong className="font-normal"><SearchHighlight text={view.session?.title ?? view.bookmark.title} query={search} /></strong>
              <p className="mt-1 text-[12px] text-muted-foreground">Message #{view.bookmark.seq} · {agentNames[view.bookmark.agent]} · {timeLabel(view.bookmark.updated_at)}</p>
              <p className="mt-2 whitespace-pre-wrap text-[13px]"><SearchHighlight text={view.bookmark.excerpt} query={search} /></p>
            </button>
            <BookmarkControl api={api} sessionKey={view.bookmark.session_key} seq={view.bookmark.seq} view={view} changed={reloadBookmarks} />
          </div>)}
        </> : loading && visible.length === 0 ? <div className="session-skeletons grid gap-1 p-1" role="status" aria-label={t.loading}>
          {[0, 1, 2, 3, 4].map(index => <div className="grid gap-2.5 px-2.5 py-3.5" key={index}>
            <i className="skeleton h-2 w-2/5" /><i className="skeleton h-3 w-4/5" /><i className="skeleton h-2 w-1/3" /></div>)}
        </div> : visible.length === 0 ? <div className="mx-5 mt-[18vh] flex flex-col items-center gap-3 text-center text-muted-foreground">
          {searching ? <Loader variant="dot-matrix" size={22} label={t.searching} className="text-foreground" />
            : <PixelField cols={4} rows={4} cell={9} seed={3} className="size-9" />}
          <strong className="text-[14px] font-medium text-foreground">{loading ? t.loading : search.trim() ? searching ? t.searching : t.searchEmpty : t.noSessions}</strong>
          {!search.trim() && <p className="m-0 text-[12px] leading-relaxed">{options.agents.length ? "Try clearing filters or including archived sessions." : t.noSessionsHint}</p>}</div> : visible.map(({ session, group }, index) =>
          <div key={session.key}><button type="button"
            aria-current={selectedKey === session.key ? "true" : undefined}
            className={cn("session-card relative mb-1 block w-full px-3 py-3 text-left transition-[background-color,border-color,box-shadow] duration-100 [contain-intrinsic-size:auto_86px] [content-visibility:auto]",
              !reduce && index < 16 && "animate-in fade-in fill-mode-both duration-150",
              selectedKey === session.key ? "selected bg-paper shadow-lift" : "hover:bg-chip/70")}
            onClick={() => choose(session)}>
            {selectedKey === session.key && <motion.span layoutId="session-marker" className="absolute top-0 bottom-0 left-0 w-[3px] bg-sky-deep"
              transition={{ type: "spring", stiffness: 700, damping: 45 }} />}
            <div className="label-mono flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
              <span className={`agent-dot agent-${session.agent}`} /><span className="whitespace-nowrap">{agentNames[session.agent]}</span>
              {session.host && <span>@{session.host}</span>}
              {session.pinned && <HugeiconsIcon icon={PinIcon} size={12} />}
              <time className="ml-auto whitespace-nowrap">{timeLabel(session.updated_at)}</time></div>
            <strong className="mt-1.5 mb-1 line-clamp-2 pr-4 text-[16px] leading-snug font-normal tracking-[0.015em] text-foreground">{group ? <SearchHighlight text={plainTitle(session.title)} query={searchContext.query} /> : plainTitle(session.title)}</strong>
            <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
              <HugeiconsIcon icon={Folder01Icon} size={12} className="flex-none" /><span className="truncate">{session.project_path ? basename(session.project_path) : t.unknown}</span></div>
            {group && <p className="mt-1 text-[12px] text-muted-foreground">
              {group.title_match && "Title match · "}{group.message_matches} matching message{group.message_matches === 1 ? "" : "s"}
            </p>}
            {session.starred && <span className="absolute right-3 bottom-3 text-[12px] text-olive" aria-label={t.favorites}>★</span>}
          </button>{group && <SearchExcerpts
            key={`${session.key}-${searchContext.query}-${searchContext.revision}-${JSON.stringify(searchContext.filter)}`}
            api={api} group={group} query={searchContext.query} filter={searchContext.filter}
            choose={seq => choose(session, seq)} />}</div>)}
        {!bookmarksOnly && !dates.error && <nav aria-label="Session pages" className="p-2 text-[13px]">
          {search.trim() ? searchOffset.current < searchTotals.sessions && <button type="button" disabled={loading || searching}
            onClick={()=>void loadMoreSearch()}>Load more search results</button>
            : browseOffset.current < sessionTotal && <button type="button" disabled={loading || loadingMore}
              onClick={()=>void loadMoreSessions()}>Load more sessions</button>}
        </nav>}
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
        <TranscriptNavigation key={selected.key} container={transcriptRef} scope={scopeRef} embedded={embedded}
          active={isActive && !terminalShown[selected.key]} promptsOnly={promptsOnly} setPromptsOnly={setPromptsOnly} reducedMotion={!!reduce} jumpToken={transcriptJumpToken} />
        {!matchesSession(selected,filter) && <p role="status" className="bg-chip px-5 py-2 text-sm">Outside current filters</p>}
        {unavailable && <p role="status" className="bg-chip px-5 py-2 text-sm">Session no longer available. Previously loaded content is kept below.</p>}
        {newMessages && <button type="button" className="bg-chip px-5 py-2 text-sm" onClick={() => {
          const container = transcriptRef.current;
          if (container) container.scrollTop = container.scrollHeight;
          setNewMessages(false);
        }}>New messages ↓</button>}
        <div ref={transcriptRef} inert={!!terminalShown[selected.key]} aria-hidden={!!terminalShown[selected.key]} className="min-h-0 flex-1 overflow-y-auto scroll-smooth motion-reduce:scroll-auto" aria-busy={transcriptLoading}>
          {transcriptLoading ? <div className="transcript-skeleton mx-auto max-w-[780px] px-10 py-9" role="status" aria-label={t.loading}>
            {[0, 1, 2].map(index => <div className="flex gap-4 border-b border-border pt-5 pb-7" key={index}><i className="skeleton size-6 flex-none" />
              <div className="grid flex-1 content-start gap-3"><i className="skeleton h-2.5 w-1/5" /><i className="skeleton h-2.5 w-[88%]" /><i className="skeleton h-2.5 w-3/5" /></div></div>)}
          </div> : messages.length ? <div className="transcript-messages mx-auto max-w-[780px] px-10 pt-6 pb-24 max-[1100px]:px-6">
            {messages.filter(message => !promptsOnly || (message.role === "user" && message.kind === "text")).map((message, index) => <Message key={message.seq} message={message} animate={!reduce && index < 10}>
              <BookmarkControl api={api} sessionKey={selected.key} seq={message.seq} view={bookmarkByMessage.get(`${selected.key}:${message.seq}`)} changed={reloadBookmarks} />
            </Message>)}</div>
            : <div className="flex h-full flex-col items-center justify-center gap-4 text-[13px] text-muted-foreground">
              <PixelField cols={6} rows={3} cell={12} seed={11} className="w-[72px]" /><p className="m-0">{t.noTranscript}</p></div>}
        </div>
      </motion.div> : <motion.div key="home" className="flex min-h-0 flex-1 flex-col"
        initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12 }}>
        <LibraryHome sessions={sessions} sessionCount={sessionTotal} agentCount={options.agents.length} projectCount={projects.length} agentNames={agentNames}
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
          <span>{error}</span><button type="button" onClick={() => void reload()} className="underline">Retry refresh</button><button type="button" className="text-[16px] leading-none opacity-80 hover:opacity-100" onClick={() => setError(null)} aria-label="Dismiss">×</button></motion.div>}
        {notice && <motion.div key={notice} role="status" layout
          initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.96 }}
          className="label-mono pointer-events-auto flex items-center gap-2.5 bg-foreground px-3.5 py-2.5 text-[12px] text-background shadow-lg">
          <span className="size-1.5 bg-sky-deep" />{notice}</motion.div>}
      </AnimatePresence>
    </div>
  </div>;
}
