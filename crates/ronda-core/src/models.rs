use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentId {
    ClaudeCode,
    Codex,
    Grok,
    Dsh,
    Cursor,
    Opencode,
    Pi,
    Omp,
    Kiro,
    Kimi,
    Gemini,
    Copilot,
    Antigravity,
    Qoder,
    Hermes,
    Openclaw,
    Codebuddy,
    Workbuddy,
}

impl AgentId {
    pub const ALL: [Self; 18] = [
        Self::ClaudeCode,
        Self::Codex,
        Self::Grok,
        Self::Dsh,
        Self::Cursor,
        Self::Opencode,
        Self::Pi,
        Self::Omp,
        Self::Kiro,
        Self::Kimi,
        Self::Gemini,
        Self::Copilot,
        Self::Antigravity,
        Self::Qoder,
        Self::Hermes,
        Self::Openclaw,
        Self::Codebuddy,
        Self::Workbuddy,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::Codex => "codex",
            Self::Grok => "grok",
            Self::Dsh => "dsh",
            Self::Cursor => "cursor",
            Self::Opencode => "opencode",
            Self::Pi => "pi",
            Self::Omp => "omp",
            Self::Kiro => "kiro",
            Self::Kimi => "kimi",
            Self::Gemini => "gemini",
            Self::Copilot => "copilot",
            Self::Antigravity => "antigravity",
            Self::Qoder => "qoder",
            Self::Hermes => "hermes",
            Self::Openclaw => "openclaw",
            Self::Codebuddy => "codebuddy",
            Self::Workbuddy => "workbuddy",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub key: String,
    pub native_id: String,
    pub agent: AgentId,
    pub host: Option<String>,
    pub parent_key: Option<String>,
    pub title: String,
    pub project_path: Option<String>,
    pub source_path: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub model: Option<String>,
    pub source: Option<String>,
    pub tokens: Option<i64>,
    pub archived: bool,
    pub metadata_only: bool,
    pub can_delete: bool,
    #[serde(default)]
    pub starred: bool,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageKind {
    Text,
    Meta,
    CompactSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: Option<String>,
    pub output: Option<String>,
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageAttachment {
    pub media_type: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptMessage {
    pub seq: i64,
    pub role: Role,
    pub kind: MessageKind,
    pub text: String,
    pub timestamp: Option<i64>,
    pub model: Option<String>,
    pub thinking: Option<String>,
    pub tool_calls: Vec<ToolCall>,
    pub images: Vec<ImageAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSnapshot {
    pub session_key_hash: String,
    pub messages: Vec<TranscriptMessage>,
    pub fingerprints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedSession {
    pub meta: SessionMeta,
    pub messages: Vec<TranscriptMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct SessionQuery {
    pub agent: Option<AgentId>,
    pub project_path: Option<String>,
    pub host: Option<String>,
    pub starred_only: bool,
    pub include_archived: bool,
    pub limit: Option<usize>,
    pub updated_from_ms: Option<i64>,
    pub updated_before_ms: Option<i64>,
    pub model: Option<String>,
    pub local_only: bool,
}

impl SessionQuery {
    pub fn validate(&self) -> anyhow::Result<()> {
        anyhow::ensure!(
            !self.local_only || self.host.is_none(),
            "Choose either local sessions or a remote host"
        );
        anyhow::ensure!(
            !matches!((self.updated_from_ms, self.updated_before_ms), (Some(from), Some(before)) if from >= before),
            "Date range must end after its start"
        );
        Ok(())
    }

    pub fn matches(&self, session: &SessionMeta) -> bool {
        (self.include_archived || !session.archived)
            && self.agent.is_none_or(|agent| session.agent == agent)
            && self
                .project_path
                .as_ref()
                .is_none_or(|path| session.project_path.as_ref() == Some(path))
            && self
                .host
                .as_ref()
                .is_none_or(|host| session.host.as_ref() == Some(host))
            && (!self.local_only || session.host.is_none())
            && self
                .model
                .as_ref()
                .is_none_or(|model| session.model.as_ref() == Some(model))
            && self
                .updated_from_ms
                .is_none_or(|from| session.updated_at >= from)
            && self
                .updated_before_ms
                .is_none_or(|before| session.updated_at < before)
            && (!self.starred_only || session.starred)
    }
}

#[derive(Debug, Serialize)]
pub struct SessionPage {
    pub items: Vec<SessionMeta>,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub session: SessionMeta,
    pub seq: i64,
    pub snippet: String,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchSort {
    #[default]
    Relevance,
    Recent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchExcerpt {
    pub seq: i64,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchGroup {
    pub session: SessionMeta,
    pub title_match: bool,
    pub message_matches: usize,
    pub excerpts: Vec<SearchExcerpt>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GroupedSearch {
    pub groups: Vec<SearchGroup>,
    pub total_sessions: usize,
    pub total_message_matches: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SearchMatches {
    pub matches: Vec<SearchExcerpt>,
    pub total_matches: usize,
}

#[derive(Debug, Serialize)]
pub struct LibraryOptions {
    pub agents: Vec<AgentId>,
    pub models: Vec<String>,
    pub hosts: Vec<String>,
    pub projects: Vec<ProjectInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub path: String,
    pub session_count: usize,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsightRow {
    pub label: String,
    pub sessions: usize,
    pub prompts: usize,
    pub tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Insights {
    pub sessions: usize,
    pub prompts: usize,
    pub tokens: i64,
    pub activity: Vec<(String, usize)>,
    pub hours: Vec<(u8, usize)>,
    pub agents: Vec<InsightRow>,
    pub projects: Vec<InsightRow>,
    pub models: Vec<InsightRow>,
}
