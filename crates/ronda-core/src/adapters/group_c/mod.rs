use crate::{
    AgentAdapter, AgentId, ImageAttachment, MessageKind, ParsedSession, ResumeSpec, Role,
    SessionMeta, SourceRef, ToolCall, TranscriptMessage,
};
use anyhow::{Context, Result};
use rusqlite::{types::ValueRef, Connection, OpenFlags, OptionalExtension, Row};
use serde_json::{Map, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

pub fn adapters() -> Vec<Box<dyn AgentAdapter>> {
    [
        Kind::Copilot,
        Kind::CursorIde,
        Kind::OpenCode,
        Kind::Hermes,
        Kind::OpenClaw,
        Kind::Antigravity,
    ]
    .into_iter()
    .map(|kind| Box::new(Store { kind }) as Box<dyn AgentAdapter>)
    .collect()
}

#[derive(Clone, Copy)]
enum Kind {
    Copilot,
    CursorIde,
    OpenCode,
    Hermes,
    OpenClaw,
    Antigravity,
}
struct Store {
    kind: Kind,
}

fn open(path: &Path) -> Result<Connection> {
    // A normal read-only connection sees a live WAL. `immutable=1` would silently miss it.
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("open {}", path.display()))?;
    db.pragma_update(None, "query_only", "ON")?;
    Ok(db)
}

fn table(db: &Connection, name: &str) -> bool {
    db.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
        [name],
        |_| Ok(()),
    )
    .is_ok()
}

fn columns(db: &Connection, name: &str) -> HashSet<String> {
    let Ok(mut q) = db.prepare(&format!("PRAGMA table_info({name})")) else {
        return HashSet::new();
    };
    q.query_map([], |r| r.get::<_, String>(1))
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .collect()
}

fn value(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(n) => Value::from(n),
        ValueRef::Real(n) => Value::from(n),
        ValueRef::Text(b) | ValueRef::Blob(b) => {
            Value::String(String::from_utf8_lossy(b).into_owned())
        }
    }
}

fn row_map(r: &Row<'_>) -> rusqlite::Result<Map<String, Value>> {
    let mut out = Map::new();
    for i in 0..r.as_ref().column_count() {
        out.insert(r.as_ref().column_name(i)?.to_string(), value(r.get_ref(i)?));
    }
    Ok(out)
}

fn rows(db: &Connection, sql: &str, id: Option<&str>) -> Result<Vec<Map<String, Value>>> {
    let mut q = db.prepare(sql)?;
    let mapped = if let Some(id) = id {
        q.query_map([id], row_map)?
    } else {
        q.query_map([], row_map)?
    };
    Ok(mapped.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn string(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}
fn field(m: &Map<String, Value>, k: &str) -> Option<String> {
    m.get(k).and_then(string)
}
fn nfield(m: &Map<String, Value>, k: &str) -> Option<i64> {
    m.get(k).and_then(number)
}
fn number(v: &Value) -> Option<i64> {
    v.as_i64()
        .or_else(|| v.as_f64().map(|n| n as i64))
        .or_else(|| v.as_str()?.parse().ok())
}
fn json(raw: Option<String>) -> Value {
    raw.and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null)
}
fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(a) => a
            .iter()
            .map(text)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(o) => o
            .get("text")
            .or_else(|| o.get("content"))
            .or_else(|| o.get("output"))
            .map(text)
            .unwrap_or_default(),
        _ => String::new(),
    }
}
fn millis(v: Option<&Value>) -> i64 {
    let Some(v) = v else { return 0 };
    if let Some(s) = v.as_str() {
        if let Ok(n) = s.parse::<f64>() {
            return numeric_ms(n);
        }
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
            return dt.timestamp_millis();
        }
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S") {
            return dt.and_utc().timestamp_millis();
        }
    }
    v.as_f64().map(numeric_ms).unwrap_or(0)
}
fn numeric_ms(n: f64) -> i64 {
    if n.abs() < 100_000_000_000.0 {
        (n * 1000.0) as i64
    } else {
        n as i64
    }
}
fn stamp(path: &Path) -> (i64, u64) {
    let mut latest = 0;
    let mut bytes = 0;
    for p in [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
    ] {
        if let Ok(m) = fs::metadata(p) {
            latest = latest.max(
                m.modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0),
            );
            bytes += m.len();
        }
    }
    (latest, bytes)
}
fn source(agent: AgentId, id: String, path: &Path) -> SourceRef {
    let (modified_ms, size) = stamp(path);
    SourceRef {
        agent,
        native_id: id,
        path: path.to_path_buf(),
        modified_ms,
        size,
    }
}
fn message(role: Role, content: impl Into<String>, timestamp: i64) -> TranscriptMessage {
    TranscriptMessage {
        seq: 0,
        role,
        kind: MessageKind::Text,
        text: content.into(),
        timestamp: (timestamp > 0).then_some(timestamp),
        model: None,
        thinking: None,
        tool_calls: Vec::new(),
        images: Vec::<ImageAttachment>::new(),
    }
}
fn push(out: &mut Vec<TranscriptMessage>, role: Role, content: impl Into<String>, timestamp: i64) {
    let content = content.into();
    if !content.trim().is_empty() {
        out.push(message(role, content, timestamp));
    }
}
fn finish(mut meta: SessionMeta, mut messages: Vec<TranscriptMessage>) -> ParsedSession {
    for (i, m) in messages.iter_mut().enumerate() {
        m.seq = i as i64;
    }
    if meta.title.trim().is_empty() {
        meta.title = messages
            .iter()
            .find(|m| matches!(m.role, Role::User) && !m.text.trim().is_empty())
            .map(|m| m.text.chars().take(100).collect())
            .unwrap_or_else(|| "Untitled session".into());
    }
    ParsedSession { meta, messages }
}
fn meta(
    s: &SourceRef,
    title: String,
    project: Option<String>,
    created: i64,
    updated: i64,
    model: Option<String>,
    tokens: Option<i64>,
) -> SessionMeta {
    let db_variant = if s.agent == AgentId::Opencode
        && s.path.file_name().and_then(|n| n.to_str()) == Some("opencode-next.db")
    {
        "next:"
    } else {
        ""
    };
    SessionMeta {
        key: format!("{}:{db_variant}{}", s.agent.as_str(), s.native_id),
        native_id: s.native_id.clone(),
        agent: s.agent,
        host: None,
        parent_key: None,
        title,
        project_path: project,
        source_path: s.path.to_string_lossy().into_owned(),
        created_at: created.max(0),
        updated_at: updated.max(created).max(0),
        model,
        tokens: tokens.filter(|n| *n > 0),
        archived: false,
        metadata_only: false,
        can_delete: false,
        source: None,
        starred: false,
        pinned: false,
    }
}
fn select_ids(
    db: &Connection,
    table_name: &str,
    id_col: &str,
    filter: &str,
) -> Result<Vec<String>> {
    let sql = format!("SELECT {id_col} FROM {table_name} {filter}");
    let mut q = db.prepare(&sql)?;
    let ids = q
        .query_map([], |r| r.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(ids)
}
fn select_one(db: &Connection, sql: &str, id: &str) -> Result<Option<Map<String, Value>>> {
    Ok(rows(db, sql, Some(id))?.into_iter().next())
}

impl AgentAdapter for Store {
    fn agent(&self) -> AgentId {
        match self.kind {
            Kind::Copilot => AgentId::Copilot,
            Kind::CursorIde => AgentId::Cursor,
            Kind::OpenCode => AgentId::Opencode,
            Kind::Hermes => AgentId::Hermes,
            Kind::OpenClaw => AgentId::Openclaw,
            Kind::Antigravity => AgentId::Antigravity,
        }
    }
    fn rank(&self) -> u8 {
        if matches!(self.kind, Kind::CursorIde) {
            1
        } else {
            0
        }
    }
    fn roots(&self, home: &Path) -> Vec<PathBuf> {
        match self.kind {
            Kind::Copilot => vec![home.join(".copilot/session-store.db")],
            Kind::CursorIde => {
                let base = if cfg!(target_os = "macos") {
                    home.join("Library/Application Support")
                } else if cfg!(windows) {
                    std::env::var_os("APPDATA")
                        .map(PathBuf::from)
                        .unwrap_or_else(|| home.join("AppData/Roaming"))
                } else {
                    std::env::var_os("XDG_CONFIG_HOME")
                        .map(PathBuf::from)
                        .unwrap_or_else(|| home.join(".config"))
                };
                vec![base.join("Cursor/User/globalStorage/state.vscdb")]
            }
            Kind::OpenCode => {
                let mut v = vec![home.join(".local/share/opencode")];
                if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
                    let p = PathBuf::from(xdg).join("opencode");
                    if !v.contains(&p) {
                        v.push(p);
                    }
                }
                if let Some(db) = std::env::var_os("OPENCODE_DB") {
                    let p = PathBuf::from(db);
                    if p.is_absolute() && !v.contains(&p) {
                        v.push(p);
                    }
                }
                v
            }
            Kind::Hermes => vec![std::env::var_os("HERMES_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".hermes"))],
            Kind::OpenClaw => vec![std::env::var_os("OPENCLAW_STATE_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".openclaw"))],
            Kind::Antigravity => {
                vec![home.join(".gemini/antigravity-cli/conversation_summaries.db")]
            }
        }
    }
    fn discover(&self, root: &Path) -> Result<Vec<SourceRef>> {
        let mut out = Vec::new();
        let dbs: Vec<PathBuf> = match self.kind {
            Kind::Copilot | Kind::CursorIde | Kind::Antigravity => vec![root.to_path_buf()],
            Kind::OpenCode => {
                if root.is_file() {
                    vec![root.to_path_buf()]
                } else {
                    ["opencode.db", "opencode-next.db"]
                        .iter()
                        .map(|n| root.join(n))
                        .collect()
                }
            }
            Kind::Hermes => {
                let mut v = vec![if root.is_file() {
                    root.to_path_buf()
                } else {
                    root.join("state.db")
                }];
                if let Ok(profiles) = fs::read_dir(root.join("profiles")) {
                    for p in profiles.flatten() {
                        if p.path().is_dir() {
                            v.push(p.path().join("state.db"));
                        }
                    }
                }
                v
            }
            Kind::OpenClaw => {
                if root.is_file() {
                    if root.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                        if let Some(id) = root.file_stem().and_then(|s| s.to_str()) {
                            out.push(source(self.agent(), id.into(), root));
                        }
                        return Ok(out);
                    }
                    vec![root.to_path_buf()]
                } else {
                    let mut v = Vec::new();
                    if let Ok(agents) = fs::read_dir(root.join("agents")) {
                        for agent in agents.flatten() {
                            let p = agent.path();
                            v.push(p.join("agent/openclaw-agent.sqlite"));
                            let legacy = p.join("sessions");
                            if let Ok(files) = fs::read_dir(legacy) {
                                for f in files.flatten() {
                                    let p = f.path();
                                    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                                    if p.is_file()
                                        && name.ends_with(".jsonl")
                                        && ![".deleted.", ".reset.", ".checkpoint."]
                                            .iter()
                                            .any(|x| name.contains(x))
                                    {
                                        if let Some(id) = p.file_stem().and_then(|n| n.to_str()) {
                                            out.push(source(self.agent(), id.into(), &p));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    v
                }
            }
        };
        for path in dbs {
            if !path.is_file() {
                continue;
            }
            let Ok(db) = open(&path) else { continue };
            let ids = match self.kind {
                Kind::Copilot if table(&db, "sessions") => select_ids(&db, "sessions", "id", "")?,
                Kind::CursorIde if table(&db, "cursorDiskKV") => {
                    let mut q = db.prepare(
                        "SELECT substr(key, 14) FROM cursorDiskKV WHERE key LIKE 'composerData:%'",
                    )?;
                    let ids = q
                        .query_map([], |r| r.get::<_, String>(0))?
                        .filter_map(|r| r.ok())
                        .collect();
                    ids
                }
                Kind::OpenCode => {
                    let mut ids = Vec::new();
                    for t in ["session", "session_v2"] {
                        if table(&db, t) {
                            let filter = if columns(&db, t).contains("parent_id") {
                                "WHERE parent_id IS NULL"
                            } else {
                                ""
                            };
                            ids.extend(select_ids(&db, t, "id", filter)?);
                        }
                    }
                    ids.sort();
                    ids.dedup();
                    ids
                }
                Kind::Hermes if table(&db, "sessions") => select_ids(&db, "sessions", "id", "")?,
                Kind::OpenClaw if table(&db, "session_windows") => {
                    select_ids(&db, "session_windows", "session_id", "")?
                }
                Kind::Antigravity if table(&db, "conversation_summaries") => {
                    let filter = if columns(&db, "conversation_summaries").contains("nesting_depth")
                    {
                        "WHERE nesting_depth = 0"
                    } else {
                        ""
                    };
                    select_ids(&db, "conversation_summaries", "conversation_id", filter)?
                }
                _ => Vec::new(),
            };
            out.extend(ids.into_iter().map(|id| source(self.agent(), id, &path)));
        }
        Ok(out)
    }
    fn parse(&self, s: &SourceRef) -> Result<Option<ParsedSession>> {
        if s.agent != self.agent() {
            return Ok(None);
        }
        let parsed = match self.kind {
            Kind::Copilot => parse_copilot(s)?,
            Kind::CursorIde => parse_cursor(s)?,
            Kind::OpenCode => parse_opencode(s)?,
            Kind::Hermes => parse_hermes(s)?,
            Kind::OpenClaw => parse_openclaw(s)?,
            Kind::Antigravity => parse_antigravity(s)?,
        };
        Ok(parsed)
    }
    fn resume(&self, meta: &SessionMeta) -> Option<ResumeSpec> {
        let (program, args) = match self.kind {
            Kind::OpenCode => ("opencode", vec!["--session", &meta.native_id]),
            Kind::Hermes => ("hermes", vec!["--continue", &meta.native_id]),
            Kind::OpenClaw => ("openclaw", vec!["--session", &meta.native_id]),
            _ => return None,
        };
        Some(ResumeSpec {
            program: program.into(),
            args: args.into_iter().map(str::to_string).collect(),
            cwd: meta.project_path.clone(),
        })
    }
    fn owned_paths(&self, meta: &SessionMeta) -> Vec<PathBuf> {
        // Database sessions are shared files; never hand one to Trash.
        if meta.can_delete {
            vec![PathBuf::from(&meta.source_path)]
        } else {
            Vec::new()
        }
    }
}

fn parse_copilot(s: &SourceRef) -> Result<Option<ParsedSession>> {
    let db = open(&s.path)?;
    let Some(row) = select_one(&db, "SELECT * FROM sessions WHERE id=?1", &s.native_id)? else {
        return Ok(None);
    };
    let mut messages: Vec<TranscriptMessage> = Vec::new();
    if table(&db, "turns") {
        for turn in rows(
            &db,
            "SELECT * FROM turns WHERE session_id=?1 ORDER BY turn_index",
            Some(&s.native_id),
        )? {
            let ts = millis(turn.get("timestamp"));
            push(
                &mut messages,
                Role::User,
                field(&turn, "user_message").unwrap_or_default(),
                ts,
            );
            push(
                &mut messages,
                Role::Assistant,
                field(&turn, "assistant_response").unwrap_or_default(),
                ts,
            );
        }
    }
    let created = millis(row.get("created_at"));
    let updated = millis(row.get("updated_at"));
    let meta = meta(
        s,
        field(&row, "summary").unwrap_or_default(),
        field(&row, "cwd"),
        created,
        updated,
        None,
        None,
    );
    Ok(Some(finish(meta, messages)))
}

fn parse_cursor(s: &SourceRef) -> Result<Option<ParsedSession>> {
    let db = open(&s.path)?;
    let raw: Option<String> = db
        .query_row(
            "SELECT CAST(value AS TEXT) FROM cursorDiskKV WHERE key=?1",
            [format!("composerData:{}", s.native_id)],
            |r| r.get(0),
        )
        .optional()?;
    let Some(raw) = raw else { return Ok(None) };
    let data: Value = serde_json::from_str(&raw)?;
    let mut messages = Vec::new();
    if let Some(headers) = data
        .get("fullConversationHeadersOnly")
        .and_then(Value::as_array)
    {
        let mut q = db.prepare("SELECT CAST(value AS TEXT) FROM cursorDiskKV WHERE key=?1")?;
        for h in headers {
            let Some(id) = h.get("bubbleId").and_then(Value::as_str) else {
                continue;
            };
            let raw: Option<String> = q
                .query_row([format!("bubbleId:{}:{id}", s.native_id)], |r| r.get(0))
                .optional()?
                .flatten();
            let Some(v) = raw.and_then(|s| serde_json::from_str::<Value>(&s).ok()) else {
                continue;
            };
            let role = if h.get("type").or_else(|| v.get("type")).and_then(number) == Some(1) {
                Role::User
            } else {
                Role::Assistant
            };
            let ts = millis(v.get("createdAt"));
            let mut m = message(role, text(v.get("text").unwrap_or(&Value::Null)), ts);
            m.thinking = v
                .pointer("/thinking/text")
                .and_then(Value::as_str)
                .map(str::to_string)
                .filter(|s| !s.is_empty());
            if let Some(t) = v.get("toolFormerData") {
                let name = t
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("tool")
                    .to_string();
                let input = t
                    .get("rawArgs")
                    .or_else(|| t.get("params"))
                    .map(text_or_json);
                let output = t.get("result").map(text_or_json);
                m.tool_calls.push(ToolCall {
                    id: t
                        .get("toolCallId")
                        .and_then(Value::as_str)
                        .unwrap_or(id)
                        .into(),
                    name,
                    input,
                    output,
                    is_error: false,
                });
            }
            if !m.text.trim().is_empty() || m.thinking.is_some() || !m.tool_calls.is_empty() {
                messages.push(m);
            }
        }
    }
    let project = data
        .pointer("/workspaceIdentifier/uri/fsPath")
        .or_else(|| data.pointer("/trackedGitRepos/0/repoPath"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let created = millis(data.get("createdAt"));
    let updated = millis(data.get("lastUpdatedAt"));
    let meta = meta(
        s,
        data.get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .into(),
        project,
        created,
        updated,
        None,
        None,
    );
    Ok(Some(finish(meta, messages)))
}

fn text_or_json(v: &Value) -> String {
    if let Some(s) = v.as_str() {
        s.to_string()
    } else {
        v.to_string()
    }
}

fn parse_opencode(s: &SourceRef) -> Result<Option<ParsedSession>> {
    let db = open(&s.path)?;
    let sess_table = if table(&db, "session_v2")
        && select_one(&db, "SELECT * FROM session_v2 WHERE id=?1", &s.native_id)?.is_some()
    {
        "session_v2"
    } else {
        "session"
    };
    if !table(&db, sess_table) {
        return Ok(None);
    }
    let Some(row) = select_one(
        &db,
        &format!("SELECT * FROM {sess_table} WHERE id=?1"),
        &s.native_id,
    )?
    else {
        return Ok(None);
    };
    if field(&row, "parent_id").is_some() {
        return Ok(None);
    }
    let mut messages = Vec::new();
    let v2 = table(&db, "session_message")
        && db
            .query_row(
                "SELECT 1 FROM session_message WHERE session_id=?1 LIMIT 1",
                [&s.native_id],
                |_| Ok(()),
            )
            .is_ok();
    if v2 {
        for r in rows(
            &db,
            "SELECT * FROM session_message WHERE session_id=?1 ORDER BY seq",
            Some(&s.native_id),
        )? {
            let data = json(field(&r, "data"));
            let role_name = field(&r, "type")
                .or_else(|| data.get("role").and_then(string))
                .unwrap_or_default();
            let role = match role_name.as_str() {
                "user" | "synthetic" => Role::User,
                "assistant" => Role::Assistant,
                _ => Role::System,
            };
            let ts = millis(data.pointer("/time/created"));
            let mut m = message(
                role,
                if role_name == "user" {
                    data.get("text")
                        .map(text)
                        .filter(|t| !t.is_empty())
                        .unwrap_or_else(|| text(data.get("content").unwrap_or(&Value::Null)))
                } else {
                    text(
                        data.get("content")
                            .or_else(|| data.get("text"))
                            .unwrap_or(&Value::Null),
                    )
                },
                ts,
            );
            m.model = data
                .pointer("/model/id")
                .and_then(Value::as_str)
                .map(str::to_string);
            if role_name == "synthetic" || role_name == "system" {
                m.kind = MessageKind::Meta;
            }
            if role_name == "compaction" {
                m.kind = MessageKind::CompactSummary;
                m.text = data.get("summary").map(text).unwrap_or_default();
            }
            if !m.text.trim().is_empty() {
                messages.push(m);
            }
        }
    } else if table(&db, "message") {
        let mut parts: HashMap<String, Vec<Value>> = HashMap::new();
        if table(&db, "part") {
            for p in rows(
                &db,
                "SELECT * FROM part WHERE session_id=?1 ORDER BY id",
                Some(&s.native_id),
            )? {
                if let Some(mid) = field(&p, "message_id") {
                    parts.entry(mid).or_default().push(json(field(&p, "data")));
                }
            }
        }
        for r in rows(
            &db,
            "SELECT * FROM message WHERE session_id=?1 ORDER BY time_created,id",
            Some(&s.native_id),
        )? {
            let data = json(field(&r, "data"));
            let role = match data.get("role").and_then(Value::as_str) {
                Some("user") => Role::User,
                Some("assistant") => Role::Assistant,
                _ => Role::System,
            };
            let ts = millis(data.pointer("/time/created"));
            let mut m = message(role, "", ts);
            for p in parts
                .remove(&field(&r, "id").unwrap_or_default())
                .unwrap_or_default()
            {
                match p.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        if !m.text.is_empty() {
                            m.text.push_str("\n\n");
                        }
                        m.text
                            .push_str(&text(p.get("text").unwrap_or(&Value::Null)));
                        if p.get("synthetic").and_then(Value::as_bool) == Some(true) {
                            m.kind = MessageKind::Meta;
                        }
                    }
                    Some("reasoning") => {
                        m.thinking = Some(text(p.get("text").unwrap_or(&Value::Null)))
                    }
                    Some("tool") => m.tool_calls.push(ToolCall {
                        id: p.get("callID").and_then(Value::as_str).unwrap_or("").into(),
                        name: p
                            .get("tool")
                            .and_then(Value::as_str)
                            .unwrap_or("tool")
                            .into(),
                        input: p.pointer("/state/input").map(text_or_json),
                        output: p.pointer("/state/output").map(text_or_json),
                        is_error: p.pointer("/state/status").and_then(Value::as_str)
                            == Some("error"),
                    }),
                    _ => {}
                }
            }
            if !m.text.trim().is_empty() || m.thinking.is_some() || !m.tool_calls.is_empty() {
                messages.push(m);
            }
        }
    }
    let created = millis(row.get("time_created"));
    let updated = millis(row.get("time_updated"));
    let tokens = ["tokens_input", "tokens_output", "tokens_reasoning"]
        .iter()
        .filter_map(|k| nfield(&row, k))
        .sum::<i64>();
    let model = field(&row, "model").and_then(|s| {
        serde_json::from_str::<Value>(&s)
            .ok()
            .and_then(|v| v.get("id").and_then(Value::as_str).map(str::to_string))
            .or(Some(s))
    });
    let mut meta = meta(
        s,
        field(&row, "title").unwrap_or_default(),
        field(&row, "directory"),
        created,
        updated,
        model,
        Some(tokens),
    );
    meta.archived = nfield(&row, "time_archived").is_some();
    Ok(Some(finish(meta, messages)))
}

fn parse_hermes(s: &SourceRef) -> Result<Option<ParsedSession>> {
    let db = open(&s.path)?;
    let Some(row) = select_one(&db, "SELECT * FROM sessions WHERE id=?1", &s.native_id)? else {
        return Ok(None);
    };
    let mut messages: Vec<TranscriptMessage> = Vec::new();
    let mut calls: HashMap<String, (usize, usize)> = HashMap::new();
    if table(&db, "messages") {
        for r in rows(
            &db,
            "SELECT * FROM messages WHERE session_id=?1 ORDER BY timestamp,id",
            Some(&s.native_id),
        )? {
            let role = field(&r, "role").unwrap_or_default();
            let ts = millis(r.get("timestamp"));
            match role.as_str() {
                "tool" => {
                    if let Some((mi, ti)) =
                        field(&r, "tool_call_id").and_then(|id| calls.get(&id).copied())
                    {
                        messages[mi].tool_calls[ti].output = field(&r, "content");
                    }
                }
                "user" | "assistant" | "system" => {
                    let kind = match role.as_str() {
                        "user" => Role::User,
                        "assistant" => Role::Assistant,
                        _ => Role::System,
                    };
                    let mut m = message(kind, field(&r, "content").unwrap_or_default(), ts);
                    m.thinking = field(&r, "reasoning");
                    if role == "system" {
                        m.kind = MessageKind::Meta;
                    }
                    let calls_json = json(field(&r, "tool_calls"));
                    if let Some(a) = calls_json.as_array() {
                        for c in a {
                            let f = c.get("function").unwrap_or(c);
                            let id = c
                                .get("id")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string();
                            let call = ToolCall {
                                id: id.clone(),
                                name: f
                                    .get("name")
                                    .and_then(Value::as_str)
                                    .unwrap_or("tool")
                                    .into(),
                                input: f.get("arguments").map(text_or_json),
                                output: None,
                                is_error: false,
                            };
                            if !id.is_empty() {
                                calls.insert(id, (messages.len(), m.tool_calls.len()));
                            }
                            m.tool_calls.push(call);
                        }
                    }
                    if !m.text.trim().is_empty() || m.thinking.is_some() || !m.tool_calls.is_empty()
                    {
                        messages.push(m);
                    }
                }
                _ => {}
            }
        }
    }
    let created = millis(row.get("started_at"));
    let updated = millis(row.get("ended_at")).max(
        messages
            .iter()
            .filter_map(|m| m.timestamp)
            .max()
            .unwrap_or(0),
    );
    let tokens = [
        "input_tokens",
        "output_tokens",
        "cache_read_tokens",
        "cache_write_tokens",
        "reasoning_tokens",
    ]
    .iter()
    .filter_map(|k| nfield(&row, k))
    .sum();
    let mut meta = meta(
        s,
        field(&row, "title").unwrap_or_default(),
        None,
        created,
        updated,
        field(&row, "model"),
        Some(tokens),
    );
    meta.source = field(&row, "source").filter(|s| s != "cli");
    meta.parent_key = field(&row, "parent_session_id").map(|id| format!("hermes:{id}"));
    Ok(Some(finish(meta, messages)))
}

fn parse_openclaw(s: &SourceRef) -> Result<Option<ParsedSession>> {
    let mut row = Map::new();
    let events = if s.path.extension().and_then(|x| x.to_str()) == Some("jsonl") {
        BufReader::new(fs::File::open(&s.path)?)
            .lines()
            .filter_map(|r| r.ok().and_then(|l| serde_json::from_str::<Value>(&l).ok()))
            .collect::<Vec<_>>()
    } else {
        let db = open(&s.path)?;
        let Some(r) = select_one(
            &db,
            "SELECT * FROM session_windows WHERE session_id=?1",
            &s.native_id,
        )?
        else {
            return Ok(None);
        };
        row = r;
        let all = rows(
            &db,
            "SELECT * FROM transcript_events WHERE session_id=?1 ORDER BY seq",
            Some(&s.native_id),
        )?;
        let active: Vec<i64> = if table(&db, "session_transcript_active_events") {
            rows(&db, "SELECT * FROM session_transcript_active_events WHERE session_id=?1 ORDER BY active_position", Some(&s.native_id))?
                .iter().filter_map(|r| nfield(r, "event_seq")).collect()
        } else {
            Vec::new()
        };
        let active: HashSet<i64> = active.into_iter().collect();
        all.into_iter()
            .filter(|r| active.is_empty() || nfield(r, "seq").is_some_and(|n| active.contains(&n)))
            .filter_map(|r| {
                field(&r, "event_json").and_then(|s| serde_json::from_str::<Value>(&s).ok())
            })
            .collect()
    };
    let mut messages = Vec::new();
    let mut project = None;
    let mut created = 0;
    let mut model = None;
    let mut title = field(&row, "display_name").unwrap_or_default();
    for e in &events {
        let typ = e.get("type").and_then(Value::as_str).unwrap_or("");
        if typ == "session" {
            project = e.get("cwd").and_then(Value::as_str).map(str::to_string);
            created = millis(e.get("timestamp"));
        }
        if typ == "session_info" {
            title = e
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(&title)
                .to_string();
        }
        let m = e.get("message").unwrap_or(e);
        if typ != "message" && m.get("role").is_none() {
            continue;
        }
        let role = match m.get("role").and_then(Value::as_str) {
            Some("user") => Role::User,
            Some("assistant") => Role::Assistant,
            Some("system") => Role::System,
            _ => continue,
        };
        let ts = millis(e.get("timestamp").or_else(|| m.get("timestamp")));
        let content = m.get("content").map(text).unwrap_or_default();
        let mut msg = message(role, content, ts);
        msg.model = m.get("model").and_then(Value::as_str).map(str::to_string);
        model = msg.model.clone().or(model);
        if !msg.text.trim().is_empty() {
            messages.push(msg);
        }
    }
    let created = created.max(millis(row.get("started_at")).max(millis(row.get("created_at"))));
    let updated = millis(row.get("transcript_updated_at"))
        .max(millis(row.get("updated_at")))
        .max(
            messages
                .iter()
                .filter_map(|m| m.timestamp)
                .max()
                .unwrap_or(0),
        );
    let mut meta = meta(
        s,
        title,
        project,
        created,
        updated,
        model.or_else(|| field(&row, "model")),
        None,
    );
    meta.source = field(&row, "channel");
    meta.parent_key = field(&row, "spawned_by").map(|id| format!("openclaw:{id}"));
    meta.can_delete = s.path.extension().and_then(|x| x.to_str()) == Some("jsonl");
    Ok(Some(finish(meta, messages)))
}

fn parse_antigravity(s: &SourceRef) -> Result<Option<ParsedSession>> {
    let db = open(&s.path)?;
    let Some(row) = select_one(
        &db,
        "SELECT * FROM conversation_summaries WHERE conversation_id=?1",
        &s.native_id,
    )?
    else {
        return Ok(None);
    };
    if nfield(&row, "nesting_depth").unwrap_or(0) != 0
        || field(&row, "parent_conversation_id").is_some()
    {
        return Ok(None);
    }
    let preview = field(&row, "preview").unwrap_or_default();
    let title = field(&row, "title")
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| preview.clone());
    let project = field(&row, "workspace_uris")
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| v.as_array()?.first()?.as_str().map(str::to_string))
        .map(|s| percent_decode(s.strip_prefix("file://").unwrap_or(&s)));
    let ts = millis(row.get("last_modified_time"));
    let mut meta = meta(s, title, project, ts, ts, None, None);
    meta.metadata_only = true;
    let mut m = message(
        Role::System,
        if preview.is_empty() {
            "Antigravity conversation content is encrypted; only metadata is available in Ronda."
                .into()
        } else {
            format!("{preview}\n\nAntigravity conversation content is encrypted; only metadata is available in Ronda.")
        },
        ts,
    );
    m.kind = MessageKind::Meta;
    Ok(Some(finish(meta, vec![m])))
}
fn percent_decode(s: &str) -> String {
    let mut out = Vec::with_capacity(s.len());
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(n) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(n);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let n = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let p = std::env::temp_dir().join(format!("ronda-group-c-{}-{n}", std::process::id()));
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
        fn db(&self, name: &str, sql: &str) -> PathBuf {
            let p = self.0.join(name);
            let db = Connection::open(&p).unwrap();
            db.execute_batch(sql).unwrap();
            drop(db);
            p
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn only(adapter: &dyn AgentAdapter, root: &Path) -> ParsedSession {
        let refs = adapter.discover(root).unwrap();
        assert_eq!(refs.len(), 1);
        let parsed = adapter.parse(&refs[0]).unwrap().unwrap();
        for (i, m) in parsed.messages.iter().enumerate() {
            assert_eq!(m.seq, i as i64);
        }
        parsed
    }

    #[test]
    fn sqlite_sources_are_read_only_and_have_stable_message_order() {
        let f = Fixture::new();
        let copilot = f.db("session-store.db", r#"
            CREATE TABLE sessions(id TEXT,cwd TEXT,summary TEXT,created_at TEXT,updated_at TEXT);
            CREATE TABLE turns(id INTEGER,session_id TEXT,turn_index INTEGER,user_message TEXT,assistant_response TEXT,timestamp TEXT);
            INSERT INTO sessions VALUES('cp','/a b','', '2026-01-01T00:00:00Z','2026-01-01T00:01:00Z');
            INSERT INTO turns VALUES(1,'cp',2,'second','reply 2','2026-01-01T00:00:02Z');
            INSERT INTO turns VALUES(2,'cp',1,'first','reply 1','2026-01-01T00:00:01Z');
        "#);
        let before = fs::read(&copilot).unwrap();
        let p = only(
            &Store {
                kind: Kind::Copilot,
            },
            &copilot,
        );
        assert_eq!(
            p.messages
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>(),
            ["first", "reply 1", "second", "reply 2"]
        );
        assert_eq!(p.meta.title, "first");
        assert!(!p.meta.can_delete);
        assert_eq!(fs::read(&copilot).unwrap(), before);

        let cursor = f.db("state.vscdb", r#"
            CREATE TABLE cursorDiskKV(key TEXT PRIMARY KEY,value TEXT);
            INSERT INTO cursorDiskKV VALUES('composerData:cur', '{"name":"Cursor chat","fullConversationHeadersOnly":[{"bubbleId":"z","type":1},{"bubbleId":"a","type":2}]}');
            INSERT INTO cursorDiskKV VALUES('bubbleId:cur:a', '{"text":"answer"}');
            INSERT INTO cursorDiskKV VALUES('bubbleId:cur:z', '{"text":"question"}');
        "#);
        let c = only(
            &Store {
                kind: Kind::CursorIde,
            },
            &cursor,
        );
        assert_eq!(
            c.messages
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>(),
            ["question", "answer"]
        );
        assert_eq!(
            Store {
                kind: Kind::CursorIde
            }
            .rank(),
            1
        );

        let anti = f.db("conversation_summaries.db", r#"
            CREATE TABLE conversation_summaries(conversation_id TEXT,title TEXT,preview TEXT,nesting_depth INTEGER,parent_conversation_id TEXT,last_modified_time TEXT,workspace_uris TEXT);
            INSERT INTO conversation_summaries VALUES('ag','','Preview',0,'','2026-01-01T00:00:00Z','["file:///a%20b"]');
        "#);
        let a = only(
            &Store {
                kind: Kind::Antigravity,
            },
            &anti,
        );
        assert!(a.meta.metadata_only);
        assert_eq!(a.meta.project_path.as_deref(), Some("/a b"));
        assert!(a.messages[0].text.contains("encrypted"));
    }

    #[test]
    fn opencode_hermes_and_openclaw_sources() {
        let f = Fixture::new();
        let opencode = f.db("opencode.db", r#"
            CREATE TABLE session(id TEXT,parent_id TEXT,title TEXT,directory TEXT,time_created INTEGER,time_updated INTEGER);
            CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT);
            CREATE TABLE part(id TEXT,session_id TEXT,message_id TEXT,data TEXT);
            INSERT INTO session VALUES('oc',NULL,'OC','/project',1760000000000,1760000001000);
            INSERT INTO message VALUES('m','oc',1,'{"role":"user","time":{"created":1760000000000}}');
            INSERT INTO part VALUES('p','oc','m','{"type":"text","text":"find this code"}');
        "#);
        let o = only(
            &Store {
                kind: Kind::OpenCode,
            },
            &opencode,
        );
        assert_eq!(o.messages[0].text, "find this code");

        let next = f.db("opencode-next.db", r#"
            CREATE TABLE session(id TEXT,parent_id TEXT,title TEXT,directory TEXT,time_created INTEGER,time_updated INTEGER);
            CREATE TABLE session_message(session_id TEXT,seq INTEGER,type TEXT,data TEXT);
            INSERT INTO session VALUES('oc',NULL,'Next','/next',1760000000000,1760000001000);
            INSERT INTO session_message VALUES('oc',1,'user','{"text":"new format"}');
        "#);
        let n = only(
            &Store {
                kind: Kind::OpenCode,
            },
            &next,
        );
        assert_eq!(n.messages[0].text, "new format");
        assert_ne!(o.meta.key, n.meta.key);

        let hermes = f.db("state.db", r#"
            CREATE TABLE sessions(id TEXT,title TEXT,source TEXT,model TEXT,started_at REAL,ended_at REAL);
            CREATE TABLE messages(id INTEGER,session_id TEXT,role TEXT,content TEXT,tool_calls TEXT,tool_call_id TEXT,timestamp REAL);
            INSERT INTO sessions VALUES('h','Hermes','telegram','gpt',1760000000,1760000001);
            INSERT INTO messages VALUES(1,'h','assistant','running','[{"id":"call","function":{"name":"shell","arguments":"ls"}}]',NULL,1760000000);
            INSERT INTO messages VALUES(2,'h','tool','files',NULL,'call',1760000001);
        "#);
        let h = only(&Store { kind: Kind::Hermes }, &hermes);
        assert_eq!(h.messages[0].tool_calls[0].output.as_deref(), Some("files"));
        assert_eq!(h.meta.source.as_deref(), Some("telegram"));

        let claw = f.db("openclaw-agent.sqlite", r#"
            CREATE TABLE session_windows(session_id TEXT,session_key TEXT,display_name TEXT,created_at INTEGER,updated_at INTEGER);
            CREATE TABLE transcript_events(session_id TEXT,seq INTEGER,event_json TEXT);
            INSERT INTO session_windows VALUES('cl','key','Claw',1760000000000,1760000001000);
            INSERT INTO transcript_events VALUES('cl',1,'{"type":"message","message":{"role":"user","content":"hello"}}');
        "#);
        let cl = only(
            &Store {
                kind: Kind::OpenClaw,
            },
            &claw,
        );
        assert_eq!(cl.messages[0].text, "hello");
        assert!(!cl.meta.can_delete);

        let legacy = f.0.join("legacy.jsonl");
        fs::write(&legacy, "{\"type\":\"session\",\"cwd\":\"/old\"}\n{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":\"legacy\"}}\n").unwrap();
        let old = only(
            &Store {
                kind: Kind::OpenClaw,
            },
            &legacy,
        );
        assert_eq!(old.messages[0].text, "legacy");
        assert!(old.meta.can_delete);
    }

    #[test]
    fn sees_committed_wal_without_changing_agent_files() {
        let f = Fixture::new();
        let path = f.0.join("live.db");
        let writer = Connection::open(&path).unwrap();
        writer.pragma_update(None, "journal_mode", "WAL").unwrap();
        writer.execute_batch("CREATE TABLE sessions(id TEXT,summary TEXT); INSERT INTO sessions VALUES('live','WAL session');").unwrap();
        let wal = PathBuf::from(format!("{}-wal", path.display()));
        let db_bytes = fs::read(&path).unwrap();
        let wal_bytes = fs::read(&wal).unwrap();
        let session = only(
            &Store {
                kind: Kind::Copilot,
            },
            &path,
        );
        assert_eq!(session.meta.title, "WAL session");
        assert_eq!(fs::read(&path).unwrap(), db_bytes);
        assert_eq!(fs::read(&wal).unwrap(), wal_bytes);
        drop(writer);
    }
}
