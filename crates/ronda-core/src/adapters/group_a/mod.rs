use crate::{
    AgentAdapter, AgentId, ImageAttachment, MessageKind, ParsedSession, ResumeSpec, Role,
    SessionMeta, SourceRef, ToolCall, TranscriptMessage,
};
use anyhow::{Context, Result};
use chrono::DateTime;
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use walkdir::WalkDir;

pub fn adapters() -> Vec<Box<dyn AgentAdapter>> {
    [
        AgentId::ClaudeCode,
        AgentId::Codex,
        AgentId::Qoder,
        AgentId::Codebuddy,
        AgentId::Workbuddy,
        AgentId::Cursor,
    ]
    .into_iter()
    .map(|agent| Box::new(FileAdapter(agent)) as Box<dyn AgentAdapter>)
    .collect()
}

struct FileAdapter(AgentId);

impl AgentAdapter for FileAdapter {
    fn agent(&self) -> AgentId {
        self.0
    }
    fn fingerprint(&self, source: &SourceRef) -> String {
        let extra = if self.0 == AgentId::Codex {
            codex_db(&source.path)
                .and_then(|p| p.metadata().ok())
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis())
                .unwrap_or(0)
        } else {
            0
        };
        format!("{}:{}:{extra}", source.modified_ms, source.size)
    }

    fn roots(&self, home: &Path) -> Vec<PathBuf> {
        let configured = |key: &str, default: &str| {
            let local_home = dirs::home_dir().is_some_and(|p| p == home);
            if local_home {
                if let Some(p) = std::env::var_os(key)
                    .map(PathBuf::from)
                    .filter(|p| p.is_dir())
                {
                    return p;
                }
            }
            home.join(default)
        };
        match self.0 {
            AgentId::ClaudeCode => vec![home.join(".claude/projects")],
            AgentId::Codex => {
                let base = configured("CODEX_HOME", ".codex");
                vec![base.join("sessions"), base.join("archived_sessions")]
            }
            AgentId::Qoder => vec![configured("QODER_CONFIG_DIR", ".qoder").join("projects")],
            AgentId::Codebuddy => {
                vec![configured("CODEBUDDY_CONFIG_DIR", ".codebuddy").join("projects")]
            }
            AgentId::Workbuddy => {
                vec![configured("WORKBUDDY_CONFIG_DIR", ".workbuddy").join("projects")]
            }
            AgentId::Cursor => vec![home.join(".cursor/projects")],
            _ => unreachable!(),
        }
    }

    fn discover(&self, root: &Path) -> Result<Vec<SourceRef>> {
        if !root.is_dir() {
            return Ok(Vec::new());
        }
        let mut found = Vec::new();
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|x| x.to_str()) != Some("jsonl") {
                continue;
            }
            let relative = match path.strip_prefix(root) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let parts: Vec<_> = relative.components().collect();
            let child_parent = subagent_parent(path, self.0);
            let valid = match self.0 {
                AgentId::ClaudeCode => {
                    parts.len() == 2 || (parts.len() == 4 && child_parent.is_some())
                }
                AgentId::Codex => {
                    path.file_name()
                        .and_then(|x| x.to_str())
                        .is_some_and(|x| x.starts_with("rollout-"))
                        && !codex_internal(path)
                }
                AgentId::Qoder | AgentId::Codebuddy | AgentId::Workbuddy => parts.len() == 2,
                AgentId::Cursor => {
                    (parts.len() == 4 || (parts.len() == 5 && child_parent.is_some()))
                        && parts[1].as_os_str() == "agent-transcripts"
                        && !cursor_marker_only(path)
                }
                _ => false,
            };
            if !valid {
                continue;
            }
            let stat = entry.metadata()?;
            let native_id = match self.0 {
                AgentId::Codex => {
                    let stem = path.file_stem().unwrap().to_string_lossy();
                    if stem.len() >= 36
                        && stem.as_bytes()[stem.len() - 36..]
                            .iter()
                            .all(|c| c.is_ascii_hexdigit() || *c == b'-')
                    {
                        stem[stem.len() - 36..].to_owned()
                    } else {
                        stem.into_owned()
                    }
                }
                _ => {
                    let stem = path.file_stem().unwrap().to_string_lossy();
                    child_parent
                        .map(|parent| format!("{parent}:{stem}"))
                        .unwrap_or_else(|| stem.into_owned())
                }
            };
            found.push(SourceRef {
                agent: self.0,
                native_id,
                path: path.to_path_buf(),
                modified_ms: stat
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0),
                size: stat.len(),
            });
        }
        found.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(found)
    }

    fn parse(&self, source: &SourceRef) -> Result<Option<ParsedSession>> {
        if source.agent != self.0 {
            anyhow::bail!("source belongs to another adapter");
        }
        if self.0 == AgentId::Codex && codex_internal(&source.path) {
            return Ok(None);
        }
        if self.0 == AgentId::Cursor && cursor_marker_only(&source.path) {
            return Ok(None);
        }
        let child_parent = subagent_parent(&source.path, self.0);
        let is_child = child_parent.is_some();
        let rows = read_rows(&source.path)?;
        let mut parsed = match self.0 {
            AgentId::ClaudeCode => parse_claude(&rows, is_child),
            AgentId::Codex => parse_codex(&rows),
            AgentId::Qoder => parse_qoder(&rows),
            AgentId::Codebuddy | AgentId::Workbuddy => parse_buddy(&rows),
            AgentId::Cursor => parse_cursor(&rows),
            _ => unreachable!(),
        };
        let mut codex_state = None;
        if self.0 == AgentId::Codex {
            codex_state = codex_enrichment(&source.path, &source.native_id);
            if let Some(state) = &codex_state {
                if let Some(title) = &state.title {
                    parsed.title = title.clone();
                }
                if let Some(cwd) = &state.cwd {
                    parsed.cwd = Some(cwd.clone());
                }
                if parsed.model.is_none() {
                    parsed.model = state.model.clone();
                }
                if parsed.tokens.is_none() {
                    parsed.tokens = state.tokens;
                }
                parsed.created = state.created.or(parsed.created);
                parsed.updated = state.updated.or(parsed.updated);
            }
        }
        if parsed.messages.is_empty() && self.0 == AgentId::Cursor {
            return Ok(None);
        }
        for (i, message) in parsed.messages.iter_mut().enumerate() {
            message.seq = i as i64;
        }
        if parsed.title.is_empty() {
            parsed.title = parsed
                .messages
                .iter()
                .find(|m| {
                    matches!(m.role, Role::User)
                        && matches!(m.kind, MessageKind::Text)
                        && !m.text.trim().is_empty()
                })
                .map(|m| {
                    m.text
                        .lines()
                        .next()
                        .unwrap_or("")
                        .chars()
                        .take(120)
                        .collect()
                })
                .unwrap_or_else(|| source.native_id.clone());
        }
        if is_child && self.0 == AgentId::ClaudeCode {
            if let Some(title) = sidechain_title(&source.path) {
                parsed.title = title;
            }
        }
        let project = if self.0 == AgentId::Cursor {
            cursor_project(&source.path).or(parsed.cwd)
        } else {
            parsed.cwd
        };
        let archived = codex_state
            .as_ref()
            .and_then(|s| s.archived)
            .unwrap_or_else(|| {
                self.0 == AgentId::Codex
                    && source
                        .path
                        .components()
                        .any(|p| p.as_os_str() == "archived_sessions")
            });
        let meta = SessionMeta {
            key: format!("{}:{}", self.0.as_str(), source.native_id),
            native_id: source.native_id.clone(),
            agent: self.0,
            host: None,
            parent_key: child_parent.map(|id| format!("{}:{id}", self.0.as_str())),
            title: parsed.title,
            project_path: project,
            source_path: source.path.to_string_lossy().into_owned(),
            created_at: parsed.created.unwrap_or(source.modified_ms),
            updated_at: parsed.updated.unwrap_or(source.modified_ms),
            model: parsed.model,
            source: parsed.source.or_else(|| codex_state.and_then(|s| s.source)),
            tokens: parsed.tokens.filter(|n| *n > 0),
            archived,
            metadata_only: false,
            can_delete: !is_child,
            starred: false,
            pinned: false,
        };
        Ok(Some(ParsedSession {
            meta,
            messages: parsed.messages,
        }))
    }

    fn resume(&self, meta: &SessionMeta) -> Option<ResumeSpec> {
        if meta.agent != self.0 || self.0 == AgentId::Workbuddy || meta.parent_key.is_some() {
            return None;
        }
        let (program, args) = match self.0 {
            AgentId::ClaudeCode => ("claude", vec!["--resume", &meta.native_id]),
            AgentId::Codex => ("codex", vec!["resume", &meta.native_id]),
            AgentId::Qoder => ("qoder", vec!["--resume", &meta.native_id]),
            AgentId::Codebuddy => ("codebuddy", vec!["--resume", &meta.native_id]),
            AgentId::Cursor => ("cursor-agent", vec!["resume", &meta.native_id]),
            _ => return None,
        };
        Some(ResumeSpec {
            program: program.into(),
            args: args.into_iter().map(str::to_owned).collect(),
            cwd: meta.project_path.clone(),
        })
    }

    fn owned_paths(&self, meta: &SessionMeta) -> Vec<PathBuf> {
        let main = PathBuf::from(&meta.source_path);
        let mut paths = vec![main.clone()];
        if matches!(
            self.0,
            AgentId::ClaudeCode | AgentId::Qoder | AgentId::Codebuddy | AgentId::Workbuddy
        ) {
            let sidecar = main.with_extension("meta.json");
            if sidecar
                .symlink_metadata()
                .is_ok_and(|m| m.file_type().is_file())
            {
                paths.push(sidecar);
            }
            let sidechain = main.with_extension("");
            if sidechain
                .symlink_metadata()
                .is_ok_and(|m| m.file_type().is_dir())
            {
                paths.push(sidechain);
            }
        }
        if self.0 == AgentId::Cursor && meta.parent_key.is_none() {
            let sidechain = main.parent().unwrap_or(Path::new("")).join("subagents");
            if sidechain
                .symlink_metadata()
                .is_ok_and(|m| m.file_type().is_dir())
            {
                paths.push(sidechain);
            }
        }
        paths
    }
}

fn subagent_parent(path: &Path, agent: AgentId) -> Option<String> {
    if !matches!(agent, AgentId::ClaudeCode | AgentId::Cursor)
        || path.extension().and_then(|x| x.to_str()) != Some("jsonl")
        || path.parent()?.file_name()? != "subagents"
    {
        return None;
    }
    let owner = path.parent()?.parent()?;
    let id = owner.file_name()?.to_str()?.to_owned();
    let parent_file = match agent {
        AgentId::ClaudeCode => {
            if !path.file_stem()?.to_str()?.starts_with("agent-") {
                return None;
            }
            owner.parent()?.join(format!("{id}.jsonl"))
        }
        AgentId::Cursor => {
            if owner.parent()?.file_name()? != "agent-transcripts" {
                return None;
            }
            owner.join(format!("{id}.jsonl"))
        }
        _ => unreachable!(),
    };
    parent_file
        .symlink_metadata()
        .is_ok_and(|m| m.file_type().is_file())
        .then_some(id)
}

fn sidechain_title(path: &Path) -> Option<String> {
    let sidecar = path.with_extension("meta.json");
    if !sidecar
        .symlink_metadata()
        .is_ok_and(|m| m.file_type().is_file())
    {
        return None;
    }
    let raw = std::fs::read_to_string(sidecar).ok()?;
    let meta: Value = serde_json::from_str(&raw).ok()?;
    nonempty(&meta["description"]).or_else(|| nonempty(&meta["agentType"]))
}

fn read_rows(path: &Path) -> Result<Vec<Value>> {
    let file = File::open(path).with_context(|| format!("opening {}", path.display()))?;
    // ponytail: holds one session in memory; stream rows if large transcripts exceed the memory budget.
    // Partial last writes are common while an agent is active.
    Ok(BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str(&line).ok())
        .collect())
}

fn codex_internal(path: &Path) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    let mut first = String::new();
    if BufReader::new(file).read_line(&mut first).is_err() {
        return false;
    }
    let Ok(row): Result<Value, _> = serde_json::from_str(&first) else {
        return false;
    };
    row["type"] == "session_meta"
        && (row["payload"]["source"].is_object()
            || matches!(
                row["payload"]["thread_source"].as_str(),
                Some("subagent" | "guardian_review" | "memory_consolidation")
            ))
}

fn codex_db(path: &Path) -> Option<PathBuf> {
    let base = path
        .ancestors()
        .find(|p| {
            p.file_name()
                .is_some_and(|name| name == "sessions" || name == "archived_sessions")
        })?
        .parent()?;
    Some(base.join("state_5.sqlite"))
}

#[derive(Default)]
struct CodexState {
    title: Option<String>,
    cwd: Option<String>,
    model: Option<String>,
    source: Option<String>,
    tokens: Option<i64>,
    archived: Option<bool>,
    created: Option<i64>,
    updated: Option<i64>,
}

fn codex_enrichment(path: &Path, id: &str) -> Option<CodexState> {
    let db = codex_db(path)?;
    if !db.is_file() {
        return None;
    }
    let conn = Connection::open_with_flags(
        db,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    conn.query_row("SELECT title, name, cwd, model, source, tokens_used, archived, created_at_ms, updated_at_ms FROM threads WHERE id = ?1",
        [id], |r| {
            let title: Option<String> = r.get(0)?;
            let name: Option<String> = r.get(1)?;
            let cwd: Option<String> = r.get(2)?;
            let model: Option<String> = r.get(3)?;
            let source: Option<String> = r.get(4)?;
            let tokens: Option<i64> = r.get(5)?;
            let archived: Option<i64> = r.get(6)?;
            let created: Option<i64> = r.get(7)?;
            let updated: Option<i64> = r.get(8)?;
            Ok(CodexState { title: name.filter(|s| !s.trim().is_empty()).or(title.filter(|s| !s.trim().is_empty())),
                cwd, model, source, tokens, archived: archived.map(|n| n != 0), created, updated })
        }).ok()
}

fn cursor_marker_only(path: &Path) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    let mut valid = false;
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else {
            return false;
        };
        let Ok(row): Result<Value, _> = serde_json::from_str(&line) else {
            return false;
        };
        if row["type"] != "turn_ended" {
            return false;
        }
        valid = true;
    }
    valid
}

#[derive(Default)]
struct Parsed {
    messages: Vec<TranscriptMessage>,
    title: String,
    cwd: Option<String>,
    model: Option<String>,
    source: Option<String>,
    tokens: Option<i64>,
    created: Option<i64>,
    updated: Option<i64>,
}

impl Parsed {
    fn time(&mut self, row: &Value) -> Option<i64> {
        let t = epoch_ms(&row["timestamp"])?;
        self.created = Some(self.created.map_or(t, |old| old.min(t)));
        self.updated = Some(self.updated.map_or(t, |old| old.max(t)));
        Some(t)
    }
    fn push(
        &mut self,
        role: Role,
        kind: MessageKind,
        text: String,
        timestamp: Option<i64>,
    ) -> usize {
        let index = self.messages.len();
        self.messages.push(TranscriptMessage {
            seq: 0,
            role,
            kind,
            text,
            timestamp,
            model: self.model.clone(),
            thinking: None,
            tool_calls: Vec::new(),
            images: Vec::new(),
        });
        index
    }
}

fn epoch_ms(value: &Value) -> Option<i64> {
    if let Some(n) = value.as_i64() {
        return Some(if n.abs() < 100_000_000_000 {
            n * 1000
        } else {
            n
        });
    }
    let s = value.as_str()?;
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.timestamp_millis())
        .or_else(|| {
            s.parse::<i64>().ok().map(|n| {
                if n.abs() < 100_000_000_000 {
                    n * 1000
                } else {
                    n
                }
            })
        })
}

fn nonempty(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

fn body(value: &Value) -> (String, Vec<ImageAttachment>) {
    let mut text = Vec::new();
    let mut images = Vec::new();
    let parts: Vec<&Value> = if let Some(a) = value.as_array() {
        a.iter().collect()
    } else {
        vec![value]
    };
    for part in parts {
        if let Some(s) = part.as_str() {
            if !s.is_empty() {
                text.push(s.to_owned());
            }
            continue;
        }
        let kind = part["type"].as_str().unwrap_or("");
        if kind.is_empty() {
            if let Some(s) = part["text"].as_str() {
                text.push(s.to_owned());
            }
        }
        if matches!(
            kind,
            "text" | "input_text" | "output_text" | "reasoning_text"
        ) {
            if let Some(s) = part["text"].as_str() {
                if !s.is_empty() {
                    text.push(s.to_owned());
                }
            }
        }
        if matches!(kind, "image" | "input_image") {
            let media_type = part
                .pointer("/source/media_type")
                .or_else(|| part.get("media_type"))
                .and_then(Value::as_str)
                .unwrap_or("image/png");
            let data = part
                .pointer("/source/data")
                .or_else(|| part.get("data"))
                .and_then(Value::as_str)
                .or_else(|| {
                    part["image_url"]
                        .as_str()
                        .filter(|s| s.starts_with("data:image/"))
                });
            if let Some(data) = data {
                let raw = data.split_once(";base64,").map(|(_, s)| s).unwrap_or(data);
                let media_type = data
                    .strip_prefix("data:")
                    .and_then(|s| s.split_once(";base64,"))
                    .map(|(kind, _)| kind)
                    .unwrap_or(media_type);
                if raw.len() <= 8_000_000 {
                    images.push(ImageAttachment {
                        media_type: media_type.to_owned(),
                        data_base64: raw.to_owned(),
                    });
                }
            }
        }
    }
    (text.join("\n\n"), images)
}

fn tool(id: &str, name: &str, input: &Value) -> ToolCall {
    ToolCall {
        id: id.to_owned(),
        name: name.to_owned(),
        input: if input.is_null() {
            None
        } else if let Some(s) = input.as_str() {
            Some(s.to_owned())
        } else {
            Some(input.to_string())
        },
        output: None,
        is_error: false,
    }
}

fn usage(value: &Value) -> Option<i64> {
    let n = [
        "input_tokens",
        "output_tokens",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
        "prompt_tokens",
        "completion_tokens",
    ]
    .into_iter()
    .filter_map(|key| value[key].as_i64())
    .sum::<i64>();
    (n > 0).then_some(n)
}

fn parse_claude(rows: &[Value], include_sidechain: bool) -> Parsed {
    let mut out = Parsed::default();
    let mut ai_id: Option<String> = None;
    let mut ai_idx: Option<usize> = None;
    let mut calls: HashMap<String, (usize, usize)> = HashMap::new();
    let mut counted = HashSet::new();
    for row in rows {
        let kind = row["type"].as_str().unwrap_or("");
        if kind == "custom-title" {
            if let Some(t) = nonempty(&row["customTitle"]) {
                out.title = t;
            }
            continue;
        }
        if !matches!(kind, "user" | "assistant" | "system") {
            continue;
        }
        if row["isSidechain"] == true && !include_sidechain {
            continue;
        }
        let ts = out.time(row);
        if out.cwd.is_none() {
            out.cwd = nonempty(&row["cwd"]);
        }
        match kind {
            "system" => {
                ai_idx = None;
                if row["subtype"] == "compact_boundary" {
                    out.push(
                        Role::System,
                        MessageKind::CompactSummary,
                        "Context compacted".into(),
                        ts,
                    );
                }
            }
            "user" => {
                ai_idx = None;
                let content = &row["message"]["content"];
                let (mut text, mut images) = (Vec::new(), Vec::new());
                for block in content.as_array().map(Vec::as_slice).unwrap_or(&[]) {
                    if block["type"] == "tool_result" {
                        if let Some(id) = block["tool_use_id"].as_str().and_then(|id| calls.get(id))
                        {
                            let (body, _) = body(&block["content"]);
                            out.messages[id.0].tool_calls[id.1].output = Some(body);
                            out.messages[id.0].tool_calls[id.1].is_error =
                                block["is_error"] == true;
                        }
                    } else {
                        let (s, imgs) = body(block);
                        if !s.is_empty() {
                            text.push(s);
                        }
                        images.extend(imgs);
                    }
                }
                if let Some(s) = content.as_str() {
                    text.push(s.to_owned());
                }
                if !text.is_empty() || !images.is_empty() {
                    let kind = if row["isCompactSummary"] == true {
                        MessageKind::CompactSummary
                    } else if row["isMeta"] == true || row["isVisibleInTranscriptOnly"] == true {
                        MessageKind::Meta
                    } else {
                        MessageKind::Text
                    };
                    let i = out.push(Role::User, kind, text.join("\n\n"), ts);
                    out.messages[i].images = images;
                }
            }
            "assistant" => {
                let message = &row["message"];
                let id = nonempty(&message["id"]);
                if id != ai_id || ai_idx.is_none() {
                    ai_id = id.clone();
                    ai_idx = Some(out.push(Role::Assistant, MessageKind::Text, String::new(), ts));
                }
                let i = ai_idx.unwrap();
                if let Some(m) = nonempty(&message["model"]) {
                    out.model = Some(m.clone());
                    out.messages[i].model = Some(m);
                }
                if let Some(id) = id {
                    if counted.insert(id) {
                        if let Some(n) = usage(&message["usage"]) {
                            out.tokens = Some(out.tokens.unwrap_or(0) + n);
                        }
                    }
                }
                if let Some(blocks) = message["content"].as_array() {
                    for block in blocks {
                        match block["type"].as_str().unwrap_or("") {
                            "thinking" => {
                                if let Some(s) = block["thinking"].as_str() {
                                    out.messages[i].thinking = Some(s.to_owned());
                                }
                            }
                            "tool_use" => {
                                let id = block["id"].as_str().unwrap_or("");
                                let j = out.messages[i].tool_calls.len();
                                out.messages[i].tool_calls.push(tool(
                                    id,
                                    block["name"].as_str().unwrap_or("tool"),
                                    &block["input"],
                                ));
                                if !id.is_empty() {
                                    calls.insert(id.to_owned(), (i, j));
                                }
                            }
                            _ => {
                                let (s, imgs) = body(block);
                                if !s.is_empty() {
                                    if !out.messages[i].text.is_empty() {
                                        out.messages[i].text.push_str("\n\n");
                                    }
                                    out.messages[i].text.push_str(&s);
                                }
                                out.messages[i].images.extend(imgs);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    out.messages.retain(|m| {
        !m.text.is_empty()
            || !m.tool_calls.is_empty()
            || m.thinking.is_some()
            || !m.images.is_empty()
    });
    out
}

fn parse_codex(rows: &[Value]) -> Parsed {
    let mut out = Parsed::default();
    let mut fallback = Vec::new();
    let mut calls: HashMap<String, (usize, usize)> = HashMap::new();
    for row in rows {
        let ts = out.time(row);
        let payload = &row["payload"];
        match row["type"].as_str().unwrap_or("") {
            "session_meta" => {
                if out.cwd.is_none() {
                    out.cwd = nonempty(&payload["cwd"]);
                }
                out.source =
                    nonempty(&payload["originator"]).or_else(|| nonempty(&payload["source"]));
            }
            "turn_context" => {
                if out.cwd.is_none() {
                    out.cwd = nonempty(&payload["cwd"]);
                }
                if let Some(m) = nonempty(&payload["model"]) {
                    out.model = Some(m);
                }
            }
            "event_msg" => match payload["type"].as_str().unwrap_or("") {
                "token_count" => {
                    out.tokens = payload
                        .pointer("/info/total_token_usage/total_tokens")
                        .and_then(Value::as_i64);
                }
                "user_message" | "agent_message" => {
                    if let Some(s) = nonempty(&payload["message"]) {
                        let role = if payload["type"] == "user_message" {
                            Role::User
                        } else {
                            Role::Assistant
                        };
                        fallback.push((role, s, ts));
                    }
                }
                _ => {}
            },
            "response_item" => match payload["type"].as_str().unwrap_or("") {
                "message" => {
                    let role = match payload["role"].as_str() {
                        Some("user") => Role::User,
                        Some("assistant") => Role::Assistant,
                        _ => Role::System,
                    };
                    let (text, images) = body(&payload["content"]);
                    if !text.is_empty() || !images.is_empty() {
                        let i = out.push(role, MessageKind::Text, text, ts);
                        out.messages[i].images = images;
                    }
                }
                "reasoning" => {
                    let (s, _) = body(&payload["summary"]);
                    if !s.is_empty() {
                        let i = out.push(Role::Assistant, MessageKind::Text, String::new(), ts);
                        out.messages[i].thinking = Some(s);
                    }
                }
                "function_call" | "custom_tool_call" | "local_shell_call" => {
                    let id = payload["call_id"]
                        .as_str()
                        .or_else(|| payload["id"].as_str())
                        .unwrap_or("");
                    let name = payload["name"].as_str().unwrap_or("exec");
                    let i = out
                        .messages
                        .len()
                        .checked_sub(1)
                        .filter(|i| matches!(out.messages[*i].role, Role::Assistant))
                        .unwrap_or_else(|| {
                            out.push(Role::Assistant, MessageKind::Text, String::new(), ts)
                        });
                    let j = out.messages[i].tool_calls.len();
                    // Custom tools keep their payload under `input`; local shell calls under `action`.
                    let input = [&payload["arguments"], &payload["input"], &payload["action"]]
                        .into_iter()
                        .find(|v| !v.is_null())
                        .unwrap_or(&Value::Null);
                    out.messages[i].tool_calls.push(tool(id, name, input));
                    if !id.is_empty() {
                        calls.insert(id.to_owned(), (i, j));
                    }
                }
                "function_call_output" | "custom_tool_call_output" => {
                    if let Some((i, j)) = payload["call_id"]
                        .as_str()
                        .and_then(|s| calls.get(s))
                        .copied()
                    {
                        let (s, _) = body(&payload["output"]);
                        out.messages[i].tool_calls[j].is_error =
                            crate::intel::tools::exit_code(&s).is_some_and(|code| code != 0);
                        out.messages[i].tool_calls[j].output = Some(s);
                    }
                }
                _ => {}
            },
            "compacted" => {
                out.push(
                    Role::System,
                    MessageKind::CompactSummary,
                    "Context compacted".into(),
                    ts,
                );
            }
            _ => {}
        }
    }
    if !out
        .messages
        .iter()
        .any(|m| !m.text.is_empty() && matches!(m.role, Role::User | Role::Assistant))
    {
        out.messages.clear();
        for (role, text, ts) in fallback {
            out.push(role, MessageKind::Text, text, ts);
        }
    }
    out
}

fn parse_qoder(rows: &[Value]) -> Parsed {
    let mut out = Parsed::default();
    let mut nodes = HashMap::<String, (&Value, Option<String>)>::new();
    let mut order = Vec::new();
    let mut active: Option<Option<String>> = None;
    let mut ai_title = None;
    let mut last_prompt = None;
    for row in rows {
        match row["type"].as_str().unwrap_or("") {
            "custom-title" => {
                if let Some(s) = nonempty(&row["customTitle"]) {
                    out.title = s;
                }
            }
            "ai-title" => {
                ai_title = nonempty(&row["aiTitle"]);
            }
            "last-prompt" => {
                last_prompt = nonempty(&row["lastPrompt"]);
            }
            "active-leaf" => {
                active = Some(nonempty(&row["leafUuid"]));
            }
            "runtime-config" => {
                out.model = nonempty(&row["model"]);
            }
            "relocated" => {
                out.cwd = nonempty(&row["relocatedCwd"]);
            }
            "user" | "assistant" | "system" | "attachment" => {
                if row["isSidechain"] == true {
                    continue;
                }
                if let Some(id) = nonempty(&row["uuid"]) {
                    let parent = nonempty(&row["logicalParentUuid"])
                        .or_else(|| nonempty(&row["parentUuid"]));
                    if !nodes.contains_key(&id) {
                        order.push(id.clone());
                    }
                    nodes.insert(id, (row, parent));
                }
            }
            _ => {}
        }
    }
    if out.title.is_empty() {
        out.title = ai_title.or(last_prompt).unwrap_or_default();
    }
    let chosen = match active {
        Some(None) => Vec::new(),
        leaf => {
            let Some(mut id) = leaf
                .flatten()
                .filter(|id| nodes.contains_key(id))
                .or_else(|| order.last().cloned())
            else {
                return out;
            };
            let mut chain = Vec::new();
            let mut seen = HashSet::new();
            while seen.insert(id.clone()) {
                let Some((_, parent)) = nodes.get(&id) else {
                    break;
                };
                chain.push(id.clone());
                let Some(next) = parent else {
                    break;
                };
                id = next.clone();
            }
            chain.reverse();
            chain
        }
    };
    let mut calls = HashMap::<String, (usize, usize)>::new();
    for id in chosen {
        let Some((row, _)) = nodes.get(&id) else {
            continue;
        };
        let kind = row["type"].as_str().unwrap_or("");
        if kind == "attachment" {
            continue;
        }
        let ts = out.time(row);
        if out.cwd.is_none() {
            out.cwd = nonempty(&row["cwd"]);
        }
        let content = &row["message"]["content"];
        let role = if kind == "user" {
            Role::User
        } else if kind == "assistant" {
            Role::Assistant
        } else {
            Role::System
        };
        let mut texts = Vec::new();
        let mut imgs = Vec::new();
        let mut tools = Vec::new();
        for block in content.as_array().map(Vec::as_slice).unwrap_or(&[]) {
            match block["type"].as_str().unwrap_or("") {
                "tool_result" => {
                    if let Some((i, j)) = block["tool_use_id"]
                        .as_str()
                        .and_then(|s| calls.get(s))
                        .copied()
                    {
                        let (s, _) = body(&block["content"]);
                        out.messages[i].tool_calls[j].output = Some(s);
                    }
                }
                "tool_use" => tools.push(tool(
                    block["id"].as_str().unwrap_or(""),
                    block["name"].as_str().unwrap_or("tool"),
                    &block["input"],
                )),
                "thinking" => {}
                _ => {
                    let (s, images) = body(block);
                    if !s.is_empty() {
                        texts.push(s);
                    }
                    imgs.extend(images);
                }
            }
        }
        if let Some(s) = content.as_str() {
            texts.push(s.to_owned());
        }
        if texts.is_empty() && tools.is_empty() && imgs.is_empty() {
            continue;
        }
        let msg_kind = if row["isCompactSummary"] == true {
            MessageKind::CompactSummary
        } else if row["isMeta"] == true {
            MessageKind::Meta
        } else {
            MessageKind::Text
        };
        let i = out.push(role, msg_kind, texts.join("\n\n"), ts);
        out.messages[i].images = imgs;
        out.messages[i].tool_calls = tools;
        for (j, call) in out.messages[i].tool_calls.iter().enumerate() {
            calls.insert(call.id.clone(), (i, j));
        }
        if let Some(m) = nonempty(&row["message"]["model"]) {
            out.model = Some(m);
        }
        if let Some(n) = usage(&row["message"]["usage"]) {
            out.tokens = Some(out.tokens.unwrap_or(0) + n);
        }
    }
    out
}

fn parse_buddy(rows: &[Value]) -> Parsed {
    let mut out = Parsed::default();
    let mut titles = (None, None, None);
    let mut calls = HashMap::<String, (usize, usize)>::new();
    let mut pending: Option<usize> = None;
    for row in rows {
        let kind = row["type"].as_str().unwrap_or("");
        match kind {
            "custom-title" => {
                titles.0 = nonempty(&row["customTitle"]);
                continue;
            }
            "ai-title" => {
                titles.1 = nonempty(&row["aiTitle"]);
                continue;
            }
            "topic" => {
                titles.2 = nonempty(&row["topic"]);
                continue;
            }
            _ => {}
        }
        let ts = out.time(row);
        if out.cwd.is_none() {
            out.cwd = nonempty(&row["cwd"]);
        }
        if let Some(m) = nonempty(&row["providerData"]["requestModelName"])
            .or_else(|| nonempty(&row["providerData"]["model"]))
        {
            out.model = Some(m);
        }
        if let Some(n) = usage(&row["providerData"]["rawUsage"]) {
            out.tokens = Some(out.tokens.unwrap_or(0) + n);
        }
        match kind {
            "message" => {
                let role = row["role"].as_str().unwrap_or("");
                let (text, images) = body(&row["content"]);
                if text.is_empty() && images.is_empty() {
                    continue;
                }
                let i = match role {
                    "user" => {
                        pending = None;
                        out.push(Role::User, MessageKind::Text, text, ts)
                    }
                    "assistant" => {
                        let i = *pending.get_or_insert_with(|| {
                            out.push(Role::Assistant, MessageKind::Text, String::new(), ts)
                        });
                        if !out.messages[i].text.is_empty() {
                            out.messages[i].text.push_str("\n\n");
                        }
                        out.messages[i].text.push_str(&text);
                        i
                    }
                    "system" => {
                        pending = None;
                        out.push(Role::System, MessageKind::Meta, text, ts)
                    }
                    _ => continue,
                };
                out.messages[i].images.extend(images);
            }
            "reasoning" => {
                let i = *pending.get_or_insert_with(|| {
                    out.push(Role::Assistant, MessageKind::Text, String::new(), ts)
                });
                let (s, _) = body(&row["rawContent"]);
                if !s.is_empty() {
                    out.messages[i].thinking = Some(s);
                }
            }
            "function_call" => {
                let i = *pending.get_or_insert_with(|| {
                    out.push(Role::Assistant, MessageKind::Text, String::new(), ts)
                });
                let id = row["callId"].as_str().unwrap_or("");
                let j = out.messages[i].tool_calls.len();
                out.messages[i].tool_calls.push(tool(
                    id,
                    row["name"].as_str().unwrap_or("tool"),
                    &row["arguments"],
                ));
                if !id.is_empty() {
                    calls.insert(id.to_owned(), (i, j));
                }
            }
            "function_call_result" => {
                if let Some((i, j)) = row["callId"].as_str().and_then(|s| calls.get(s)).copied() {
                    let (s, _) = body(&row["output"]);
                    out.messages[i].tool_calls[j].output = Some(s);
                    out.messages[i].tool_calls[j].is_error = row["status"] == "error";
                }
                pending = None;
            }
            _ => {}
        }
    }
    out.title = titles.0.or(titles.1).or(titles.2).unwrap_or_default();
    out
}

fn parse_cursor(rows: &[Value]) -> Parsed {
    let mut out = Parsed::default();
    let mut pending = None;
    for row in rows {
        if row["type"] == "turn_ended" {
            pending = None;
            continue;
        }
        let role = row["role"].as_str().unwrap_or("");
        let ts = out.time(row);
        let content = &row["message"]["content"];
        let mut texts = Vec::new();
        let mut images = Vec::new();
        let mut tools = Vec::new();
        for block in content.as_array().map(Vec::as_slice).unwrap_or(&[]) {
            if block["type"] == "tool_use" {
                tools.push(tool(
                    block["id"].as_str().unwrap_or(""),
                    block["name"].as_str().unwrap_or("tool"),
                    &block["input"],
                ));
            } else {
                let (mut s, imgs) = body(block);
                if role == "user" {
                    if let Some(begin) = s.find("<user_query>") {
                        let suffix = &s[begin + "<user_query>".len()..];
                        if let Some(end) = suffix.find("</user_query>") {
                            s = suffix[..end].to_owned();
                        }
                    }
                }
                if !s.is_empty() {
                    texts.push(s);
                }
                images.extend(imgs);
            }
        }
        if texts.is_empty() && images.is_empty() && tools.is_empty() {
            continue;
        }
        match role {
            "user" => {
                pending = None;
                let i = out.push(Role::User, MessageKind::Text, texts.join("\n\n"), ts);
                out.messages[i].images = images;
            }
            "assistant" => {
                let i = *pending.get_or_insert_with(|| {
                    out.push(Role::Assistant, MessageKind::Text, String::new(), ts)
                });
                if !out.messages[i].text.is_empty() && !texts.is_empty() {
                    out.messages[i].text.push_str("\n\n");
                }
                out.messages[i].text.push_str(&texts.join("\n\n"));
                out.messages[i].images.extend(images);
                out.messages[i].tool_calls.extend(tools);
            }
            _ => {}
        }
    }
    out
}

fn cursor_project(path: &Path) -> Option<String> {
    let slug = path
        .ancestors()
        .find(|p| p.file_name().is_some_and(|s| s == "agent-transcripts"))
        .and_then(Path::parent)?
        .file_name()?
        .to_str()?;
    fn existing(base: &Path, encoded: &str) -> Option<PathBuf> {
        if encoded.is_empty() {
            return Some(base.to_path_buf());
        }
        let entries = std::fs::read_dir(base).ok()?;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().replace(' ', "-");
            let rest = if name == encoded {
                Some("")
            } else {
                encoded
                    .strip_prefix(&name)
                    .and_then(|s| s.strip_prefix('-'))
            };
            if let Some(rest) = rest {
                if entry.path().is_dir() {
                    if let Some(found) = existing(&entry.path(), rest) {
                        return Some(found);
                    }
                }
            }
        }
        None
    }
    existing(Path::new("/"), slug)
        .map(|p| p.to_string_lossy().into_owned())
        .or_else(|| Some(format!("/{}", slug.replace('-', "/"))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fixture(agent: AgentId, relative: &str, contents: &str) -> (PathBuf, Vec<SourceRef>) {
        let root = std::env::temp_dir().join(format!(
            "ronda-group-a-{}-{}-{}",
            agent.as_str(),
            std::process::id(),
            std::thread::current().name().unwrap_or("test")
        ));
        let _ = fs::remove_dir_all(&root);
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, contents).unwrap();
        let sources = FileAdapter(agent).discover(&root).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), contents);
        (root, sources)
    }

    #[test]
    fn claude_tools_and_images() {
        let data = concat!(
            "{\"type\":\"user\",\"cwd\":\"/My Project\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"message\":{\"content\":\"你好\"}}\n",
            "{\"type\":\"assistant\",\"timestamp\":\"2026-01-01T00:00:01Z\",\"message\":{\"id\":\"m1\",\"model\":\"sonnet\",\"usage\":{\"input_tokens\":3,\"output_tokens\":4},\"content\":[{\"type\":\"text\",\"text\":\"Done\"},{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"Bash\",\"input\":{\"command\":\"pwd\"}}]}}\n",
            "{\"type\":\"user\",\"message\":{\"content\":[{\"type\":\"tool_result\",\"tool_use_id\":\"t1\",\"content\":\"/My Project\"}]}}\n");
        let (root, sources) = fixture(AgentId::ClaudeCode, "slug/s1.jsonl", data);
        let parsed = FileAdapter(AgentId::ClaudeCode)
            .parse(&sources[0])
            .unwrap()
            .unwrap();
        assert_eq!(parsed.messages.len(), 2);
        assert_eq!(parsed.messages[0].seq, 0);
        assert_eq!(parsed.messages[1].seq, 1);
        assert_eq!(
            parsed.messages[1].tool_calls[0].output.as_deref(),
            Some("/My Project")
        );
        assert_eq!(parsed.meta.tokens, Some(7));
        assert_eq!(parsed.meta.project_path.as_deref(), Some("/My Project"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn claude_subagent_is_indexed_under_parent() {
        let parent = concat!(
            "{\"type\":\"user\",\"message\":{\"content\":\"Delegate the review\"}}\n",
            "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Working\"}]}}\n"
        );
        let child = concat!(
            "{\"type\":\"user\",\"isSidechain\":true,\"message\":{\"content\":\"Review file A\"}}\n",
            "{\"type\":\"assistant\",\"isSidechain\":true,\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Found issue\"}]}}\n"
        );
        let (root, _) = fixture(AgentId::ClaudeCode, "project/main.jsonl", parent);
        let child_path = root.join("project/main/subagents/agent-review.jsonl");
        fs::create_dir_all(child_path.parent().unwrap()).unwrap();
        fs::write(&child_path, child).unwrap();
        fs::write(
            child_path.with_extension("meta.json"),
            "{\"description\":\"Review file A\"}",
        )
        .unwrap();
        let adapter = FileAdapter(AgentId::ClaudeCode);
        let sources = adapter.discover(&root).unwrap();
        assert_eq!(sources.len(), 2);
        let main = adapter
            .parse(sources.iter().find(|s| s.native_id == "main").unwrap())
            .unwrap()
            .unwrap();
        let sub = adapter
            .parse(
                sources
                    .iter()
                    .find(|s| s.native_id == "main:agent-review")
                    .unwrap(),
            )
            .unwrap()
            .unwrap();
        assert_eq!(main.meta.parent_key, None);
        assert_eq!(sub.meta.parent_key.as_deref(), Some("claude-code:main"));
        assert_eq!(sub.meta.key, "claude-code:main:agent-review");
        assert_eq!(sub.meta.title, "Review file A");
        assert_eq!(
            sub.messages.iter().map(|m| m.seq).collect::<Vec<_>>(),
            [0, 1]
        );
        assert_eq!(
            sub.messages
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>(),
            ["Review file A", "Found issue"]
        );
        assert!(!sub.meta.can_delete);
        assert!(adapter.resume(&sub.meta).is_none());
        assert_eq!(fs::read_to_string(&child_path).unwrap(), child);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cursor_subagent_is_indexed_under_parent() {
        let parent = "{\"role\":\"user\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Main task\"}]}}\n";
        let child = concat!(
            "{\"role\":\"user\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"<user_query>Inspect helper</user_query>\"}]}}\n",
            "{\"role\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Helper checked\"}]}}\n"
        );
        let (root, _) = fixture(
            AgentId::Cursor,
            "workspace/agent-transcripts/main/main.jsonl",
            parent,
        );
        let child_path = root.join("workspace/agent-transcripts/main/subagents/helper.jsonl");
        fs::create_dir_all(child_path.parent().unwrap()).unwrap();
        fs::write(&child_path, child).unwrap();
        let adapter = FileAdapter(AgentId::Cursor);
        let sources = adapter.discover(&root).unwrap();
        assert_eq!(sources.len(), 2);
        let main = adapter
            .parse(sources.iter().find(|s| s.native_id == "main").unwrap())
            .unwrap()
            .unwrap();
        let sub = adapter
            .parse(
                sources
                    .iter()
                    .find(|s| s.native_id == "main:helper")
                    .unwrap(),
            )
            .unwrap()
            .unwrap();
        assert_eq!(main.meta.parent_key, None);
        assert_eq!(sub.meta.parent_key.as_deref(), Some("cursor:main"));
        assert_eq!(sub.meta.key, "cursor:main:helper");
        assert_eq!(
            sub.messages.iter().map(|m| m.seq).collect::<Vec<_>>(),
            [0, 1]
        );
        assert_eq!(
            sub.messages
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>(),
            ["Inspect helper", "Helper checked"]
        );
        assert!(!sub.meta.can_delete);
        assert!(adapter.resume(&sub.meta).is_none());
        assert_eq!(fs::read_to_string(&child_path).unwrap(), child);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn codex_archived_and_internal() {
        let public = concat!(
            "{\"type\":\"session_meta\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"payload\":{\"id\":\"123e4567-e89b-12d3-a456-426614174000\",\"cwd\":\"/repo\",\"source\":\"cli\"}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"Fix 搜索\"}]}}\n");
        let (root, sources) = fixture(AgentId::Codex,
            "archived_sessions/rollout-2026-01-01T00-00-00-123e4567-e89b-12d3-a456-426614174000.jsonl", public);
        let db = Connection::open(root.join("state_5.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE threads (id TEXT, title TEXT, name TEXT, cwd TEXT, model TEXT, source TEXT, tokens_used INTEGER, archived INTEGER, created_at_ms INTEGER, updated_at_ms INTEGER); INSERT INTO threads VALUES ('123e4567-e89b-12d3-a456-426614174000','DB title',NULL,'/repo','gpt-5','cli',42,1,1000,2000);").unwrap();
        drop(db);
        assert_eq!(sources.len(), 1);
        let parsed = FileAdapter(AgentId::Codex)
            .parse(&sources[0])
            .unwrap()
            .unwrap();
        assert_eq!(
            parsed.meta.native_id,
            "123e4567-e89b-12d3-a456-426614174000"
        );
        assert!(parsed.meta.archived);
        assert_eq!(parsed.meta.title, "DB title");
        assert_eq!(parsed.meta.source.as_deref(), Some("cli"));
        assert_eq!(parsed.meta.tokens, Some(42));
        assert_eq!(parsed.messages[0].text, "Fix 搜索");
        fs::write(
            root.join("archived_sessions/rollout-internal.jsonl"),
            "{\"type\":\"session_meta\",\"payload\":{\"source\":{\"subagent\":\"review\"}}}\n",
        )
        .unwrap();
        assert_eq!(
            FileAdapter(AgentId::Codex).discover(&root).unwrap().len(),
            1
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn codex_tool_inputs_and_exit_codes() {
        let rows: Vec<Value> = [
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Fix the build"}]}}"#,
            r#"{"type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"a","arguments":"{\"cmd\":\"cargo test\"}"}}"#,
            r#"{"type":"response_item","payload":{"type":"function_call_output","call_id":"a","output":"Wall time: 1 seconds\nProcess exited with code 101\nOutput:\nerror"}}"#,
            r#"{"type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch","call_id":"b","input":"*** Begin Patch\n*** Update File: /repo/a.rs\n*** End Patch"}}"#,
            r#"{"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"b","output":[{"type":"input_text","text":"Success. Updated the following files:"}]}}"#,
            r#"{"type":"response_item","payload":{"type":"local_shell_call","call_id":"c","action":{"type":"exec","command":["bash","-lc","ls"]}}}"#,
        ]
        .iter()
        .map(|row| serde_json::from_str(row).unwrap())
        .collect();
        let calls = &parse_codex(&rows).messages[1].tool_calls;
        assert_eq!(calls[0].input.as_deref(), Some("{\"cmd\":\"cargo test\"}"));
        assert!(calls[0].is_error);
        assert!(calls[1]
            .input
            .as_deref()
            .unwrap()
            .contains("Update File: /repo/a.rs"));
        assert!(!calls[1].is_error);
        assert!(calls[2]
            .input
            .as_deref()
            .unwrap()
            .contains("\"command\":[\"bash\",\"-lc\",\"ls\"]"));
    }

    #[test]
    fn qoder_active_branch() {
        let data = concat!(
            "{\"type\":\"user\",\"uuid\":\"u\",\"message\":{\"content\":\"Start\"}}\n",
            "{\"type\":\"assistant\",\"uuid\":\"old\",\"parentUuid\":\"u\",\"message\":{\"content\":\"old answer\"}}\n",
            "{\"type\":\"assistant\",\"uuid\":\"new\",\"parentUuid\":\"u\",\"message\":{\"content\":\"new answer\"}}\n",
            "{\"type\":\"active-leaf\",\"leafUuid\":\"new\"}\n");
        let (root, sources) = fixture(AgentId::Qoder, "slug/s1.jsonl", data);
        let parsed = FileAdapter(AgentId::Qoder)
            .parse(&sources[0])
            .unwrap()
            .unwrap();
        assert_eq!(
            parsed
                .messages
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>(),
            ["Start", "new answer"]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn buddy_twins_and_cursor_marker() {
        let buddy = concat!(
            "{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"Do it\"}]}\n",
            "{\"type\":\"function_call\",\"callId\":\"c\",\"name\":\"run\",\"arguments\":\"{}\"}\n",
            "{\"type\":\"function_call_result\",\"callId\":\"c\",\"output\":{\"text\":\"ok\"}}\n");
        for agent in [AgentId::Codebuddy, AgentId::Workbuddy] {
            let (root, sources) = fixture(agent, "slug/s1.jsonl", buddy);
            let parsed = FileAdapter(agent).parse(&sources[0]).unwrap().unwrap();
            assert_eq!(parsed.messages.len(), 2);
            assert_eq!(
                parsed.messages[1].tool_calls[0].output.as_deref(),
                Some("ok")
            );
            fs::remove_dir_all(root).unwrap();
        }
        let (root, _) = fixture(
            AgentId::Cursor,
            "slug/agent-transcripts/s1/s1.jsonl",
            "{\"type\":\"turn_ended\"}\n",
        );
        assert!(FileAdapter(AgentId::Cursor)
            .discover(&root)
            .unwrap()
            .is_empty());
        fs::write(root.join("slug/agent-transcripts/s1/s1.jsonl"),
            "{\"role\":\"user\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"<user_query>Hello</user_query>\"}]}}\n").unwrap();
        let sources = FileAdapter(AgentId::Cursor).discover(&root).unwrap();
        assert_eq!(
            FileAdapter(AgentId::Cursor)
                .parse(&sources[0])
                .unwrap()
                .unwrap()
                .messages[0]
                .text,
            "Hello"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
