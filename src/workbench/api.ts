import type { Intelligence } from "@/panels/IntelligenceView";
import { invoke, listen } from "@/lib/tauri";

export const agentIds = ["claude-code", "codex", "grok", "dsh", "cursor", "opencode",
  "pi", "omp", "kiro", "kimi", "gemini", "copilot", "antigravity", "qoder", "hermes", "openclaw", "codebuddy", "workbuddy"] as const;
export type AgentId = typeof agentIds[number];

export interface SessionMeta {
  key: string;
  native_id: string;
  agent: AgentId;
  host: string | null;
  parent_key: string | null;
  title: string;
  project_path: string | null;
  source_path: string;
  created_at: number;
  updated_at: number;
  model: string | null;
  source: string | null;
  tokens: number | null;
  archived: boolean;
  metadata_only: boolean;
  can_delete: boolean;
  starred: boolean;
  pinned: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: string | null;
  output: string | null;
  is_error: boolean;
}

export interface TranscriptMessage {
  seq: number;
  role: "user" | "assistant" | "system";
  kind: "text" | "meta" | "compact_summary";
  text: string;
  timestamp: number | null;
  model: string | null;
  thinking: string | null;
  tool_calls: ToolCall[];
  images: { media_type: string; data_base64: string }[];
}

export interface SessionQuery {
  agent: AgentId | null;
  project_path: string | null;
  host: string | null;
  starred_only: boolean;
  include_archived: boolean;
  limit: number | null;
  updated_from_ms?: number | null;
  updated_before_ms?: number | null;
  model?: string | null;
  local_only?: boolean;
}

export interface LibraryOptions { agents: AgentId[]; models: string[]; hosts: string[]; projects: ProjectInfo[] }
export interface SessionPage { items: SessionMeta[]; total: number; offset: number; limit: number }

export interface SearchHit {
  session: SessionMeta;
  seq: number;
  snippet: string;
}

export type SearchSort = "relevance" | "recent";
export interface SearchExcerpt { seq: number; snippet: string }
export interface SearchGroup {
  session: SessionMeta;
  title_match: boolean;
  message_matches: number;
  excerpts: SearchExcerpt[];
}
export interface GroupedSearch { groups: SearchGroup[]; total_sessions: number; total_message_matches: number }
export interface SearchMatches { matches: SearchExcerpt[]; total_matches: number }

export interface ProjectInfo {
  path: string;
  session_count: number;
  updated_at: number;
}

export interface ProjectContext { path: string; host: string | null; local_only: boolean }
export type WorkbenchLocation = {kind:"home"} | ({kind:"project"} & ProjectContext)
  | {kind:"session"; key:string; seq?:number; project?:ProjectContext};
export interface ProjectOverview extends ProjectContext {
  since:number; sessions:SessionMeta[]; total_sessions:number; bookmarks:BookmarkView[]; total_bookmarks:number;
  errors:Intelligence["recurring"]; total_errors:number; intelligence:Intelligence|null; intelligence_error:string|null;
}

export interface ErrorHistory {
  canonical:string|null; hits:{session:SessionMeta;seq:number;outcome:string}[]; total:number; offset:number; limit:number;
  indexed_sessions:number; with_tools:number;
}
export interface ErrorHistoryRequest {text:string;project:string|null;host:string|null;local_only:boolean}
export interface SessionRelationships {
  parent:SessionMeta|null; children:SessionMeta[];
  related:{session:SessionMeta;shared_errors:number;shared_files:number;explanation:string}[]; candidate_limit:number;
}

export interface ScanReport {
  discovered: number;
  indexed: number;
  unchanged: number;
  errors: string[];
}

export const queryDefaults: SessionQuery = {
  agent: null, project_path: null, host: null, starred_only: false,
  include_archived: false, limit: 500,
};

export interface MessageBookmark {
  session_key: string; seq: number; note: string; excerpt: string; text_hash: string;
  created_at: number; updated_at: number; title: string; agent: AgentId; project_path: string | null;
}
export interface BookmarkView { bookmark: MessageBookmark; session: SessionMeta | null; status: "current" | "changed" | "unavailable"; }
export interface BookmarkBackup { version: number; bookmarks: MessageBookmark[]; }
export interface BookmarkReplacement { session_key: string; seq: number; expected_updated_at: number; }
export interface BookmarkImport { imported: number; unchanged: number; conflicts: {existing: MessageBookmark; incoming: MessageBookmark}[]; }

export interface WorkbenchBackend {
  getPref(key: string): Promise<string | null>;
  setPref(key: string, value: string): Promise<void>;
  listSessions(query: SessionQuery): Promise<SessionMeta[]>;
  libraryOptions(): Promise<LibraryOptions>;
  sessionPage(query: SessionQuery, offset: number, limit: number): Promise<SessionPage>;
  getSession(key: string): Promise<SessionMeta | null>;
  getTranscript(key: string): Promise<TranscriptMessage[]>;
  searchSessions(query: string, filter: SessionQuery, limit: number): Promise<SearchHit[]>;
  searchGrouped(query: string, filter: SessionQuery, sort: SearchSort, offset: number, limit: number): Promise<GroupedSearch>;
  searchSessionMatches(query: string, filter: SessionQuery, key: string, offset: number, limit: number): Promise<SearchMatches>;
  listBookmarks(query: string, filter: SessionQuery): Promise<BookmarkView[]>;
  saveBookmark(key: string, seq: number, note: string, refreshSnapshot: boolean, expectedUpdatedAt: number | null): Promise<MessageBookmark>;
  deleteBookmark(key: string, seq: number): Promise<void>;
  listProjects(): Promise<ProjectInfo[]>;
  projectOverview(project: string, host: string | null, localOnly: boolean): Promise<ProjectOverview>;
  errorHistory(text:string,project:string|null,host:string|null,localOnly:boolean,offset:number):Promise<ErrorHistory>;
  sessionRelationships(key:string):Promise<SessionRelationships>;
  scan(): Promise<ScanReport>;
  setSessionFlags(key: string, starred: boolean, pinned: boolean): Promise<void>;
  resumeSession(key: string): Promise<string>;
  exportSession(key: string, destination: string): Promise<void>;
  trashSession(key: string): Promise<void>;
  onLibraryChanged(callback: () => void): Promise<() => void>;
}

export const backend: WorkbenchBackend = {
  getPref: key => invoke("get_pref",{key}),
  setPref: (key,value) => invoke("set_pref",{key,value}),
  listSessions: (query) => invoke("list_sessions", { query }),
  libraryOptions: () => invoke("library_options"),
  sessionPage: (query, offset, limit) => invoke("session_page", {query, offset, limit}),
  getSession: (key) => invoke("get_session", { key }),
  getTranscript: (key) => invoke("get_transcript", { key }),
  searchSessions: (query, filter, limit) => invoke("search_sessions", { query, filter, limit }),
  searchGrouped: (query, filter, sort, offset, limit) => invoke("search_grouped", { query, filter, sort, offset, limit }),
  searchSessionMatches: (query, filter, key, offset, limit) => invoke("search_session_matches", { query, filter, key, offset, limit }),
  listBookmarks: (query, filter) => invoke("list_bookmarks", {query, filter}),
  saveBookmark: (key, seq, note, refreshSnapshot, expectedUpdatedAt) => invoke("save_bookmark", {key, seq, note, refreshSnapshot, expectedUpdatedAt}),
  deleteBookmark: (key, seq) => invoke("delete_bookmark", {key, seq}),
  listProjects: () => invoke("list_projects"),
  projectOverview: (project,host,localOnly) => invoke("get_project_overview", {project,host,localOnly}),
  errorHistory:(text,project,host,localOnly,offset)=>invoke("find_error_history",{text,project,host,localOnly,offset}),
  sessionRelationships:key=>invoke("get_session_relationships",{key}),
  scan: () => invoke("scan"),
  setSessionFlags: (key, starred, pinned) => invoke("set_session_flags", { key, starred, pinned }),
  resumeSession: (key) => invoke("resume_session", { key }),
  exportSession: (key, destination) => invoke("export_session", { key, destination }),
  trashSession: (key) => invoke("trash_session", { key }),
  onLibraryChanged: async (callback) => listen("library-changed", callback),
};
