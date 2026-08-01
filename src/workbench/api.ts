import { invoke, listen } from "@/lib/tauri";

export type AgentId =
  | "claude-code" | "codex" | "grok" | "dsh" | "cursor" | "opencode"
  | "pi" | "omp" | "kiro" | "kimi" | "gemini" | "copilot"
  | "antigravity" | "qoder" | "hermes" | "openclaw" | "codebuddy" | "workbuddy";

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
}

export interface SearchHit {
  session: SessionMeta;
  seq: number;
  snippet: string;
}

export interface ProjectInfo {
  path: string;
  session_count: number;
  updated_at: number;
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

export interface WorkbenchBackend {
  listSessions(query: SessionQuery): Promise<SessionMeta[]>;
  getSession(key: string): Promise<SessionMeta | null>;
  getTranscript(key: string): Promise<TranscriptMessage[]>;
  searchSessions(query: string, filter: SessionQuery, limit: number): Promise<SearchHit[]>;
  listProjects(): Promise<ProjectInfo[]>;
  scan(): Promise<ScanReport>;
  setSessionFlags(key: string, starred: boolean, pinned: boolean): Promise<void>;
  resumeSession(key: string): Promise<string>;
  exportSession(key: string, destination: string): Promise<void>;
  trashSession(key: string): Promise<void>;
  onLibraryChanged(callback: () => void): Promise<() => void>;
}

export const backend: WorkbenchBackend = {
  listSessions: (query) => invoke("list_sessions", { query }),
  getSession: (key) => invoke("get_session", { key }),
  getTranscript: (key) => invoke("get_transcript", { key }),
  searchSessions: (query, filter, limit) => invoke("search_sessions", { query, filter, limit }),
  listProjects: () => invoke("list_projects"),
  scan: () => invoke("scan"),
  setSessionFlags: (key, starred, pinned) => invoke("set_session_flags", { key, starred, pinned }),
  resumeSession: (key) => invoke("resume_session", { key }),
  exportSession: (key, destination) => invoke("export_session", { key, destination }),
  trashSession: (key) => invoke("trash_session", { key }),
  onLibraryChanged: async (callback) => listen("library-changed", callback),
};
