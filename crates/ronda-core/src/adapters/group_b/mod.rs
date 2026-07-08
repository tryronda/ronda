use crate::{
    AgentAdapter, AgentId, ImageAttachment, MessageKind, ParsedSession, ResumeSpec, Role,
    SessionMeta, SourceRef, ToolCall, TranscriptMessage,
};
use anyhow::Result;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

pub fn adapters() -> Vec<Box<dyn AgentAdapter>> {
    [
        AgentId::Pi,
        AgentId::Omp,
        AgentId::Grok,
        AgentId::Gemini,
        AgentId::Kiro,
        AgentId::Kimi,
        AgentId::Dsh,
    ]
    .into_iter()
    .map(|agent| {
        Box::new(Adapter {
            agent,
            grok_parents: Mutex::new(HashMap::new()),
        }) as Box<dyn AgentAdapter>
    })
    .collect()
}

struct Adapter {
    agent: AgentId,
    grok_parents: Mutex<HashMap<String, (String, PathBuf)>>,
}

fn grok_parents(root: &Path) -> HashMap<String, (String, PathBuf)> {
    let mut map = HashMap::new();
    for group in fs::read_dir(root).into_iter().flatten().flatten() {
        for session in fs::read_dir(group.path()).into_iter().flatten().flatten() {
            let parent_id = session.file_name().to_string_lossy().into_owned();
            for subagent in fs::read_dir(session.path().join("subagents"))
                .into_iter()
                .flatten()
                .flatten()
            {
                let path = subagent.path().join("meta.json");
                let meta = json(&path);
                let parent = meta
                    .get("parent_session_id")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&parent_id)
                    .to_owned();
                for key in ["child_session_id", "subagent_id"] {
                    if let Some(child) = meta
                        .get(key)
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                    {
                        map.entry(child.to_owned())
                            .or_insert_with(|| (parent.clone(), path.clone()));
                    }
                }
            }
        }
    }
    map
}

fn stamp(path: &Path) -> String {
    fs::metadata(path)
        .map(|m| format!("{}:{}", modified(&m), m.len()))
        .unwrap_or_default()
}

fn modified(m: &fs::Metadata) -> i64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn source(agent: AgentId, path: PathBuf, id: String) -> Option<SourceRef> {
    let m = fs::metadata(&path).ok()?;
    (m.is_file() && m.len() > 0).then(|| SourceRef {
        agent,
        native_id: id,
        path,
        modified_ms: modified(&m),
        size: m.len(),
    })
}

fn files(root: &Path, filter: impl Fn(&Path) -> Option<String>, agent: AgentId) -> Vec<SourceRef> {
    walkdir::WalkDir::new(root)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| filter(e.path()).and_then(|id| source(agent, e.path().to_path_buf(), id)))
        .collect()
}

fn json(path: &Path) -> Value {
    fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null)
}

fn field<'a>(v: &'a Value, name: &str) -> &'a str {
    v.get(name).and_then(Value::as_str).unwrap_or("")
}

fn str_at<'a>(v: &'a Value, path: &str) -> &'a str {
    v.pointer(path).and_then(Value::as_str).unwrap_or("")
}

fn time(v: &Value) -> i64 {
    if let Some(n) = v.as_i64() {
        return if n < 10_000_000_000 { n * 1000 } else { n };
    }
    v.as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp_millis())
        .unwrap_or(0)
}

fn text_and_images(value: &Value) -> (String, Vec<ImageAttachment>) {
    let mut parts = Vec::new();
    let mut images = Vec::new();
    fn image(v: &Value, inherited_media: &str, depth: u8) -> Option<ImageAttachment> {
        if depth > 4 {
            return None;
        }
        let media = ["media_type", "mimeType", "mime_type"]
            .iter()
            .map(|key| field(v, key))
            .find(|s| !s.is_empty())
            .unwrap_or(inherited_media);
        for key in [
            "source",
            "inlineData",
            "inline_data",
            "image_url",
            "imageUrl",
        ] {
            if let Some(inner) = v.get(key) {
                if let Some(found) = image(inner, media, depth + 1) {
                    return Some(found);
                }
            }
        }
        let raw = match v {
            Value::String(s) => s.as_str(),
            _ => field(v, "data"),
        };
        if raw.is_empty() || raw.len() > 16 * 1024 * 1024 {
            return None;
        }
        if let Some(uri) = raw.strip_prefix("data:") {
            let (header, data) = uri.split_once(',')?;
            if !header.ends_with(";base64") {
                return None;
            }
            let mime = header.trim_end_matches(";base64");
            if !mime.starts_with("image/") {
                return None;
            }
            return Some(ImageAttachment {
                media_type: mime.into(),
                data_base64: data.into(),
            });
        }
        // Only inline data is accepted. A remote URL or local path is never loaded.
        if !matches!(v, Value::Object(_))
            || !media.starts_with("image/")
            || raw.contains("://")
            || raw.starts_with("file:")
        {
            return None;
        }
        Some(ImageAttachment {
            media_type: media.into(),
            data_base64: raw.into(),
        })
    }
    fn collect(v: &Value, parts: &mut Vec<String>, images: &mut Vec<ImageAttachment>) {
        match v {
            Value::String(s) if !s.trim().is_empty() => parts.push(s.trim().to_owned()),
            Value::Array(a) => {
                for item in a {
                    collect(item, parts, images);
                }
            }
            Value::Object(_) => {
                let ty = field(v, "type");
                let kind = field(v, "kind");
                if ty.contains("image")
                    || kind.contains("image")
                    || v.get("inlineData").is_some()
                    || v.get("inline_data").is_some()
                    || v.get("image_url").is_some()
                {
                    if let Some(attachment) = image(v, "image/png", 0) {
                        images.push(attachment);
                    }
                } else if ty == "text" || kind == "text" || (ty.is_empty() && kind.is_empty()) {
                    let s = field(v, "text");
                    let s = if s.is_empty() { field(v, "data") } else { s };
                    if !s.trim().is_empty() {
                        parts.push(s.trim().to_owned());
                    }
                }
            }
            _ => {}
        }
    }
    collect(value, &mut parts, &mut images);
    (parts.join("\n\n"), images)
}

fn message(role: Role, text: String, images: Vec<ImageAttachment>, ts: i64) -> TranscriptMessage {
    TranscriptMessage {
        seq: 0,
        role,
        kind: MessageKind::Text,
        text,
        timestamp: (ts > 0).then_some(ts),
        model: None,
        thinking: None,
        tool_calls: Vec::new(),
        images,
    }
}

fn append(target: &mut String, s: &str, separator: &str) {
    if !s.is_empty() {
        if !target.is_empty() {
            target.push_str(separator);
        }
        target.push_str(s);
    }
}

fn tool(id: &str, name: &str, input: &Value) -> ToolCall {
    ToolCall {
        id: id.into(),
        name: name.into(),
        input: (!input.is_null()).then(|| {
            input
                .as_str()
                .map(String::from)
                .unwrap_or_else(|| input.to_string())
        }),
        output: None,
        is_error: false,
    }
}

fn title(messages: &[TranscriptMessage]) -> String {
    messages
        .iter()
        .find(|m| {
            matches!(m.role, Role::User)
                && matches!(m.kind, MessageKind::Text)
                && !m.text.trim().is_empty()
        })
        .map(|m| m.text.trim().chars().take(100).collect())
        .unwrap_or_else(|| "Untitled session".into())
}

#[allow(clippy::too_many_arguments)] // Each format supplies these independent metadata fields.
fn finish(
    source: &SourceRef,
    id: String,
    cwd: Option<String>,
    explicit_title: Option<String>,
    created: i64,
    updated: i64,
    model: Option<String>,
    tokens: Option<i64>,
    parent: Option<String>,
    mut messages: Vec<TranscriptMessage>,
) -> ParsedSession {
    for (seq, m) in messages.iter_mut().enumerate() {
        m.seq = seq as i64;
    }
    let name = explicit_title
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| title(&messages));
    let last_message = messages
        .iter()
        .filter_map(|m| m.timestamp)
        .max()
        .unwrap_or(0);
    let id = if id.is_empty() {
        source.native_id.clone()
    } else {
        id
    };
    ParsedSession {
        meta: SessionMeta {
            key: format!("{}:{id}", source.agent.as_str()),
            native_id: id,
            agent: source.agent,
            host: None,
            parent_key: parent,
            title: name,
            project_path: cwd.filter(|s| !s.is_empty()),
            source_path: source.path.to_string_lossy().into_owned(),
            created_at: if created > 0 {
                created
            } else {
                source.modified_ms
            },
            updated_at: updated
                .max(last_message)
                .max(if updated == 0 && last_message == 0 {
                    source.modified_ms
                } else {
                    0
                }),
            model,
            source: None,
            tokens,
            archived: false,
            metadata_only: false,
            can_delete: true,
            starred: false,
            pinned: false,
        },
        messages,
    }
}

fn rows(path: &Path, mut f: impl FnMut(Value)) -> Result<()> {
    let file = File::open(path)?;
    let reader: Box<dyn BufRead> = if path.extension().is_some_and(|x| x == "zstd") {
        Box::new(BufReader::new(zstd::stream::read::Decoder::new(file)?))
    } else {
        Box::new(BufReader::new(file))
    };
    // A concurrently appended zstd frame can be incomplete. Stop on read error; do not spin.
    for line in reader.lines() {
        let Ok(line) = line else { break };
        if let Ok(value) = serde_json::from_str(&line) {
            f(value);
        }
    }
    Ok(())
}

fn pi(source: &SourceRef) -> Result<ParsedSession> {
    let mut id = String::new();
    let mut cwd = String::new();
    let mut created = 0;
    let mut updated = 0;
    let mut model = None;
    let mut tokens: Option<i64> = None;
    let mut messages: Vec<TranscriptMessage> = Vec::new();
    let mut tools: HashMap<String, (usize, usize)> = HashMap::new();
    rows(&source.path, |row| match field(&row, "type") {
        "session" => {
            id = field(&row, "id").into();
            cwd = field(&row, "cwd").into();
            created = time(&row["timestamp"]);
        }
        "message" => {
            let msg = &row["message"];
            let ts = time(&row["timestamp"]);
            updated = updated.max(ts);
            let (text, images) = text_and_images(&msg["content"]);
            match field(msg, "role") {
                "user" if !text.is_empty() || !images.is_empty() => {
                    messages.push(message(Role::User, text, images, ts))
                }
                "assistant" => {
                    if let Some(n) = msg
                        .pointer("/usage/totalTokens")
                        .and_then(Value::as_i64)
                        .filter(|n| *n >= 0)
                    {
                        tokens = Some(tokens.unwrap_or(0).saturating_add(n));
                    }
                    if let Some(s) = msg.get("model").and_then(Value::as_str) {
                        model = Some(s.into());
                    }
                    let mut calls = Vec::new();
                    let mut thinking = String::new();
                    for b in msg["content"].as_array().into_iter().flatten() {
                        match field(b, "type") {
                            "toolCall" => {
                                calls.push(tool(field(b, "id"), field(b, "name"), &b["arguments"]))
                            }
                            "thinking" => append(&mut thinking, field(b, "thinking"), "\n\n"),
                            _ => {}
                        }
                    }
                    if text.is_empty()
                        && images.is_empty()
                        && calls.is_empty()
                        && thinking.is_empty()
                    {
                        return;
                    }
                    if !matches!(messages.last(), Some(m) if matches!(m.role, Role::Assistant)) {
                        messages.push(message(Role::Assistant, String::new(), Vec::new(), ts));
                    }
                    let mi = messages.len() - 1;
                    let m = &mut messages[mi];
                    append(&mut m.text, &text, "\n\n");
                    m.images.extend(images);
                    append(
                        m.thinking.get_or_insert_with(String::new),
                        &thinking,
                        "\n\n",
                    );
                    m.model = model.clone();
                    for call in calls {
                        tools.insert(call.id.clone(), (mi, m.tool_calls.len()));
                        m.tool_calls.push(call);
                    }
                }
                "toolResult" => {
                    if let Some(&(mi, ti)) = tools.get(field(msg, "toolCallId")) {
                        let call = &mut messages[mi].tool_calls[ti];
                        if !text.is_empty() {
                            call.output = Some(text);
                        }
                        call.is_error = msg["isError"].as_bool() == Some(true);
                        messages[mi].images.extend(images);
                    }
                }
                _ => {}
            }
        }
        _ => {}
    })?;
    Ok(finish(
        source,
        id,
        Some(cwd),
        None,
        created,
        updated,
        model,
        tokens,
        None,
        messages,
    ))
}

fn grok(source: &SourceRef, parent: Option<String>) -> Result<ParsedSession> {
    let side = json(&source.path.with_file_name("summary.json"));
    let mut messages: Vec<TranscriptMessage> = Vec::new();
    let mut tools: HashMap<String, (usize, usize)> = HashMap::new();
    rows(&source.path, |row| {
        let update = &row["params"]["update"];
        let ts = time(&row["timestamp"]);
        let kind = field(update, "sessionUpdate");
        let role = match kind {
            "user_message_chunk" => Some(Role::User),
            "agent_message_chunk" | "agent_thought_chunk" | "tool_call" => Some(Role::Assistant),
            _ => None,
        };
        if let Some(role) = role {
            if !matches!(messages.last(), Some(m) if std::mem::discriminant(&m.role) == std::mem::discriminant(&role))
            {
                messages.push(message(role, String::new(), Vec::new(), ts));
            }
        }
        match kind {
            "user_message_chunk" | "agent_message_chunk" => {
                if let Some(m) = messages.last_mut() {
                    // ACP chunks are fragments: trimming would corrupt spaces at token boundaries.
                    m.text.push_str(str_at(update, "/content/text"));
                    let (_, images) = text_and_images(&update["content"]);
                    m.images.extend(images);
                }
            }
            "agent_thought_chunk" => {
                if let Some(m) = messages.last_mut() {
                    m.thinking
                        .get_or_insert_with(String::new)
                        .push_str(str_at(update, "/content/text"));
                }
            }
            "tool_call" => {
                if !messages.is_empty() {
                    let call = tool(
                        field(update, "toolCallId"),
                        field(update, "title"),
                        &update["rawInput"],
                    );
                    let mi = messages.len() - 1;
                    let m = &mut messages[mi];
                    tools.insert(call.id.clone(), (mi, m.tool_calls.len()));
                    m.tool_calls.push(call);
                }
            }
            "tool_call_update" => {
                if let Some(&(mi, ti)) = tools.get(field(update, "toolCallId")) {
                    let call = &mut messages[mi].tool_calls[ti];
                    let (text, images) = text_and_images(&update["content"]);
                    if !text.is_empty() {
                        call.output = Some(text);
                    }
                    call.is_error |= field(update, "status") == "failed";
                    if call.input.is_none() && !update["rawInput"].is_null() {
                        call.input = Some(update["rawInput"].to_string());
                    }
                    messages[mi].images.extend(images);
                }
            }
            _ => {}
        }
    })?;
    messages.retain(|m| {
        !m.text.is_empty()
            || !m.tool_calls.is_empty()
            || !m.images.is_empty()
            || m.thinking.is_some()
    });
    let title = ["generated_title", "session_summary"]
        .iter()
        .map(|k| field(&side, k))
        .find(|s| !s.is_empty())
        .map(String::from);
    let parent = parent.or_else(|| {
        side.get("parent_session_id")
            .and_then(Value::as_str)
            .map(String::from)
    });
    Ok(finish(
        source,
        source.native_id.clone(),
        Some(str_at(&side, "/info/cwd").into()),
        title,
        time(&side["created_at"]),
        time(&side["updated_at"]),
        side.get("current_model_id")
            .and_then(Value::as_str)
            .map(String::from),
        None,
        parent
            .filter(|s| !s.is_empty())
            .map(|s| format!("grok:{s}")),
        messages,
    ))
}

fn gemini(source: &SourceRef, root: &Path) -> Result<ParsedSession> {
    let mut header = Value::Null;
    let mut snapshot = Value::Null;
    rows(&source.path, |row| {
        if row.get("sessionId").is_some() {
            header = row;
        } else if row
            .pointer("/$set/messages")
            .and_then(Value::as_array)
            .is_some()
        {
            snapshot = row["$set"].clone();
        }
    })?;
    let mut messages = Vec::new();
    for m in snapshot["messages"].as_array().into_iter().flatten() {
        let role = if field(m, "type") == "user" {
            Role::User
        } else {
            Role::Assistant
        };
        let (text, images) = text_and_images(&m["content"]);
        if !text.is_empty() || !images.is_empty() {
            messages.push(message(role, text, images, time(&m["timestamp"])));
        }
    }
    let slug = source
        .path
        .parent()
        .and_then(Path::parent)
        .and_then(Path::file_name)
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let projects_path = root.parent().unwrap_or(root).join("projects.json");
    let projects = json(&projects_path);
    let cwd = projects["projects"].as_object().and_then(|map| {
        map.iter()
            .find(|(_, value)| value.as_str() == Some(&slug))
            .map(|(path, _)| path.clone())
    });
    Ok(finish(
        source,
        field(&header, "sessionId").into(),
        cwd,
        None,
        time(&header["startTime"]),
        time(&header["lastUpdated"]),
        None,
        None,
        None,
        messages,
    ))
}

fn kiro(source: &SourceRef) -> Result<ParsedSession> {
    let side = json(&source.path.with_extension("json"));
    let mut messages = Vec::new();
    rows(&source.path, |row| {
        let role = match field(&row, "kind") {
            "Prompt" => Role::User,
            "AssistantMessage" => Role::Assistant,
            _ => return,
        };
        let (text, images) = text_and_images(&row["data"]["content"]);
        if !text.is_empty() || !images.is_empty() {
            messages.push(message(
                role,
                text,
                images,
                time(&row["data"]["meta"]["timestamp"]),
            ));
        }
    })?;
    let model = str_at(&side, "/session_state/rts_model_state/model_info/model_id");
    Ok(finish(
        source,
        source.native_id.clone(),
        Some(field(&side, "cwd").into()),
        Some(field(&side, "title").into()),
        time(&side["created_at"]),
        time(&side["updated_at"]),
        (!model.is_empty()).then(|| model.into()),
        None,
        None,
        messages,
    ))
}

fn kimi_session_dir(path: &Path) -> Option<&Path> {
    path.parent()?.parent()?.parent()
}

fn kimi(source: &SourceRef, root: &Path) -> Result<ParsedSession> {
    let dir = kimi_session_dir(&source.path).unwrap_or(&source.path);
    let state = json(&dir.join("state.json"));
    let mut messages = Vec::new();
    rows(&source.path, |row| match field(&row, "type") {
        "turn.prompt" | "turn.steer" => {
            let (text, images) = text_and_images(&row["input"]);
            if !text.is_empty() || !images.is_empty() {
                messages.push(message(Role::User, text, images, 0));
            }
        }
        "context.append_message" if str_at(&row, "/message/role") == "assistant" => {
            let (text, images) = text_and_images(&row["message"]["content"]);
            if !text.is_empty() || !images.is_empty() {
                messages.push(message(Role::Assistant, text, images, 0));
            }
        }
        _ => {}
    })?;
    let index = root.parent().unwrap_or(root).join("session_index.jsonl");
    let mut cwd = None;
    rows(&index, |row| {
        if field(&row, "sessionId") == source.native_id {
            cwd = Some(field(&row, "workDir").into());
        }
    })
    .ok();
    let title = field(&state, "title");
    Ok(finish(
        source,
        source.native_id.clone(),
        cwd,
        (title != "New Session").then(|| title.into()),
        time(&state["createdAt"]),
        time(&state["updatedAt"]),
        None,
        None,
        None,
        messages,
    ))
}

fn dsh_header(path: &Path) -> Option<Value> {
    let file = File::open(path).ok()?;
    let reader: Box<dyn BufRead> = if path.extension().is_some_and(|x| x == "zstd") {
        Box::new(BufReader::new(zstd::stream::read::Decoder::new(file).ok()?))
    } else {
        Box::new(BufReader::new(file))
    };
    let line = reader.lines().next()?.ok()?;
    let value: Value = serde_json::from_str(&line).ok()?;
    (field(&value, "type") == "session" && !field(&value, "id").is_empty()).then_some(value)
}

fn dsh(source: &SourceRef) -> Result<ParsedSession> {
    let mut header = Value::Null;
    let mut title = None;
    let mut updated = 0;
    let mut model = None;
    let mut tokens: Option<i64> = None;
    let mut messages: Vec<TranscriptMessage> = Vec::new();
    let mut tools: HashMap<String, (usize, usize)> = HashMap::new();
    rows(&source.path, |row| {
        if str_at(&row, "/surfaceOp/op") == "replace" {
            return;
        }
        let ts = time(&row["time"]);
        updated = updated.max(ts);
        let data = &row["data"];
        match field(&row, "type") {
            "session" => header = row,
            "session/title" => {
                if !field(data, "title").trim().is_empty() {
                    title = Some(field(data, "title").trim().into());
                }
            }
            "request/context" => {
                if model.is_none() && !field(data, "model").is_empty() {
                    model = Some(field(data, "model").into());
                }
            }
            "user/message" => {
                let (text, images) = text_and_images(&data["content"]);
                if !text.is_empty() || !images.is_empty() {
                    let mut m = message(Role::User, text, images, ts);
                    if let Some(kind) = data.pointer("/source/kind").and_then(Value::as_str) {
                        if kind != "user" {
                            m.kind = MessageKind::Meta;
                        }
                    }
                    messages.push(m);
                }
            }
            "assistant/message" => {
                let msg = &data["message"];
                if !str_at(msg, "/source/model").is_empty() {
                    model = Some(str_at(msg, "/source/model").into());
                }
                if let Some(u) = data.get("usage") {
                    let n: i64 = [
                        "inputTokens",
                        "outputTokens",
                        "cacheReadTokens",
                        "cacheWriteTokens",
                    ]
                    .iter()
                    .filter_map(|k| u[*k].as_i64().filter(|n| *n > 0))
                    .fold(0i64, |a, b| a.saturating_add(b));
                    if n > 0 {
                        tokens = Some(tokens.unwrap_or(0).saturating_add(n));
                    }
                }
                let mut text = String::new();
                let mut thinking = String::new();
                let mut calls = Vec::new();
                let mut images = Vec::new();
                for b in msg["content"].as_array().into_iter().flatten() {
                    match field(b, "type") {
                        "text" => append(&mut text, field(b, "text"), "\n\n"),
                        "reasoning" => append(&mut thinking, field(b, "text"), "\n\n"),
                        "tool-call" => {
                            calls.push(tool(field(b, "id"), field(b, "name"), &b["arguments"]))
                        }
                        "image" => images.extend(text_and_images(b).1),
                        _ => {}
                    }
                }
                if text.is_empty() && thinking.is_empty() && calls.is_empty() && images.is_empty() {
                    return;
                }
                if !matches!(messages.last(), Some(m) if matches!(m.role, Role::Assistant)) {
                    messages.push(message(Role::Assistant, String::new(), Vec::new(), ts));
                }
                let mi = messages.len() - 1;
                let m = &mut messages[mi];
                append(&mut m.text, &text, "\n\n");
                m.images.extend(images);
                append(
                    m.thinking.get_or_insert_with(String::new),
                    &thinking,
                    "\n\n",
                );
                m.model = model.clone();
                for call in calls {
                    tools.insert(call.id.clone(), (mi, m.tool_calls.len()));
                    m.tool_calls.push(call);
                }
            }
            "tool/result" => {
                let b = &data["message"]["content"][0];
                if let Some(&(mi, ti)) = tools.get(field(b, "toolCallId")) {
                    let (text, images) = text_and_images(&b["content"]);
                    if !text.is_empty() {
                        messages[mi].tool_calls[ti].output = Some(text);
                    }
                    messages[mi].tool_calls[ti].is_error =
                        b["isError"].as_bool() == Some(true) || !data["error"].is_null();
                    messages[mi].images.extend(images);
                }
            }
            _ => {}
        }
    })?;
    Ok(finish(
        source,
        field(&header, "id").into(),
        Some(field(&header, "cwd").into()),
        title,
        time(&header["createdAt"]),
        updated,
        model,
        tokens,
        None,
        messages,
    ))
}

impl AgentAdapter for Adapter {
    fn agent(&self) -> AgentId {
        self.agent
    }

    fn roots(&self, home: &Path) -> Vec<PathBuf> {
        vec![match self.agent {
            AgentId::Pi => home.join(".pi/agent/sessions"),
            AgentId::Omp => home.join(".omp/agent/sessions"),
            AgentId::Grok => home.join(".grok/sessions"),
            AgentId::Gemini => home.join(".gemini/tmp"),
            AgentId::Kiro => home.join(".kiro/sessions/cli"),
            AgentId::Kimi => home.join(".kimi-code/sessions"),
            AgentId::Dsh => home.join(".dsh/sessions"),
            _ => unreachable!(),
        }]
    }

    fn fingerprint(&self, source: &SourceRef) -> String {
        let mut value = format!("{}:{}", source.modified_ms, source.size);
        match self.agent {
            AgentId::Grok => {
                value.push_str(&stamp(&source.path.with_file_name("summary.json")));
                if let Some((_, path)) = self.grok_parents.lock().unwrap().get(&source.native_id) {
                    value.push_str(&stamp(path));
                }
            }
            AgentId::Kiro => value.push_str(&stamp(&source.path.with_extension("json"))),
            AgentId::Gemini => value.push_str(&stamp(
                &source
                    .path
                    .parent()
                    .and_then(Path::parent)
                    .and_then(Path::parent)
                    .and_then(Path::parent)
                    .unwrap_or(&source.path)
                    .join("projects.json"),
            )),
            AgentId::Kimi => {
                if let Some(dir) = kimi_session_dir(&source.path) {
                    value.push_str(&stamp(&dir.join("state.json")));
                    if let Some(index) = dir.parent().and_then(Path::parent).and_then(Path::parent)
                    {
                        value.push_str(&stamp(&index.join("session_index.jsonl")));
                    }
                }
            }
            _ => {}
        }
        value
    }

    fn discover(&self, root: &Path) -> Result<Vec<SourceRef>> {
        if self.agent == AgentId::Grok {
            *self.grok_parents.lock().unwrap() = grok_parents(root);
        }
        let mut out = match self.agent {
            AgentId::Pi | AgentId::Omp => files(
                root,
                |p| {
                    let stem = p.file_name()?.to_str()?.strip_suffix(".jsonl")?;
                    Some(stem.rsplit('_').next().unwrap_or(stem).into())
                },
                self.agent,
            ),
            AgentId::Kiro => files(
                root,
                |p| Some(p.file_name()?.to_str()?.strip_suffix(".jsonl")?.into()),
                self.agent,
            ),
            AgentId::Gemini => files(
                root,
                |p| {
                    let name = p.file_name()?.to_str()?;
                    (p.parent()?.file_name()? == "chats"
                        && name.starts_with("session-")
                        && name.ends_with(".jsonl"))
                    .then(|| name.trim_end_matches(".jsonl").into())
                },
                self.agent,
            ),
            AgentId::Grok => files(
                root,
                |p| {
                    if p.file_name()? != "updates.jsonl" {
                        return None;
                    }
                    Some(p.parent()?.file_name()?.to_string_lossy().into_owned())
                },
                self.agent,
            ),
            AgentId::Kimi => files(
                root,
                |p| {
                    if p.file_name()? != "wire.jsonl"
                        || p.parent()?.file_name()? != "main"
                        || p.parent()?.parent()?.file_name()? != "agents"
                    {
                        return None;
                    }
                    Some(
                        kimi_session_dir(p)?
                            .file_name()?
                            .to_string_lossy()
                            .into_owned(),
                    )
                    .filter(|id| id.starts_with("session_"))
                },
                self.agent,
            ),
            AgentId::Dsh => files(
                root,
                |p| {
                    let name = p.file_name()?.to_str()?;
                    if name != "session.jsonl" && name != "session.jsonl.zstd" {
                        return None;
                    }
                    let h = dsh_header(p)?;
                    if field(&h, "origin") == "subagent"
                        || h["delegationDepth"].as_i64().unwrap_or(0) > 0
                    {
                        return None;
                    }
                    Some(field(&h, "id").into())
                },
                self.agent,
            ),
            _ => Vec::new(),
        };
        if self.agent == AgentId::Dsh {
            // Compression switches may leave two siblings; index the newest only.
            let mut best: HashMap<PathBuf, SourceRef> = HashMap::new();
            for item in out {
                let dir = item.path.parent().unwrap_or(&item.path).to_path_buf();
                let replace = best.get(&dir).is_none_or(|old| {
                    (
                        item.modified_ms,
                        item.path.extension().is_some_and(|e| e == "zstd"),
                    ) > (
                        old.modified_ms,
                        old.path.extension().is_some_and(|e| e == "zstd"),
                    )
                });
                if replace {
                    best.insert(dir, item);
                }
            }
            out = best.into_values().collect();
        }
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    fn parse(&self, source: &SourceRef) -> Result<Option<ParsedSession>> {
        let root = match self.agent {
            AgentId::Gemini => source
                .path
                .parent()
                .and_then(Path::parent)
                .and_then(Path::parent),
            AgentId::Kimi => kimi_session_dir(&source.path)
                .and_then(Path::parent)
                .and_then(Path::parent),
            _ => None,
        }
        .unwrap_or(&source.path);
        let parsed = match self.agent {
            AgentId::Pi | AgentId::Omp => pi(source)?,
            AgentId::Grok => grok(
                source,
                self.grok_parents
                    .lock()
                    .unwrap()
                    .get(&source.native_id)
                    .map(|(parent, _)| parent.clone()),
            )?,
            AgentId::Gemini => gemini(source, root)?,
            AgentId::Kiro => kiro(source)?,
            AgentId::Kimi => kimi(source, root)?,
            AgentId::Dsh => dsh(source)?,
            _ => return Ok(None),
        };
        Ok(Some(parsed))
    }

    fn resume(&self, meta: &SessionMeta) -> Option<ResumeSpec> {
        let (program, args): (&str, Vec<String>) = match self.agent {
            AgentId::Pi => ("pi", vec!["--session".into(), meta.native_id.clone()]),
            AgentId::Omp => ("omp", vec!["--resume".into(), meta.native_id.clone()]),
            AgentId::Grok => ("grok", vec!["--resume".into(), meta.native_id.clone()]),
            AgentId::Kimi => ("kimi", vec!["--session".into(), meta.native_id.clone()]),
            AgentId::Dsh => ("npx", vec!["@deepseek-ai/dsh".into(), "web".into()]),
            _ => return None,
        };
        Some(ResumeSpec {
            program: program.into(),
            args,
            cwd: meta.project_path.clone(),
        })
    }

    fn owned_paths(&self, meta: &SessionMeta) -> Vec<PathBuf> {
        let path = PathBuf::from(&meta.source_path);
        match self.agent {
            AgentId::Kiro => [
                path.clone(),
                path.with_extension("json"),
                path.with_extension("history"),
            ]
            .into_iter()
            .filter(|p| p.exists())
            .collect(),
            AgentId::Grok | AgentId::Dsh => path
                .parent()
                .map(|d| vec![d.to_path_buf()])
                .unwrap_or_else(|| vec![path]),
            AgentId::Kimi => kimi_session_dir(&path)
                .map(|d| vec![d.to_path_buf()])
                .unwrap_or_else(|| vec![path]),
            _ => vec![path],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "ronda-group-b-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn put(home: &Path, rel: &str, content: &str) -> PathBuf {
        let path = home.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn seven_agents_discover_parse_without_touching_sources() {
        let h = home();
        put(&h, ".pi/agent/sessions/-tmp/2026_pi-1.jsonl", concat!(
            "{\"type\":\"session\",\"id\":\"pi-1\",\"cwd\":\"/tmp/space project\",\"timestamp\":\"2026-01-01T00:00:00Z\"}\n",
            "{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"Hello Pi\"}]}}\n",
            "{\"type\":\"message\",\"message\":{\"role\":\"assistant\",\"model\":\"sonnet\",\"usage\":{\"totalTokens\":9},\"content\":[{\"type\":\"text\",\"text\":\"Reply\"},{\"type\":\"toolCall\",\"id\":\"t1\",\"name\":\"read\",\"arguments\":{\"path\":\"a\"}}]}}\n",
            "{\"type\":\"message\",\"message\":{\"role\":\"toolResult\",\"toolCallId\":\"t1\",\"content\":[{\"type\":\"text\",\"text\":\"done\"}]}}\n"));
        put(
            &h,
            ".omp/agent/sessions/-tmp/2026_omp-1.jsonl",
            concat!(
            "{\"type\":\"session\",\"id\":\"omp-1\",\"cwd\":\"/tmp/omp\"}\n",
            "{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":\"Hello OMP\"}}\n"),
        );
        put(&h, ".grok/sessions/project/grok-1/summary.json", "{\"info\":{\"cwd\":\"/tmp/grok\"},\"generated_title\":\"Grok title\",\"current_model_id\":\"grok-4\"}");
        put(&h, ".grok/sessions/project/grok-1/updates.jsonl", concat!(
            "{\"timestamp\":1700000000,\"params\":{\"update\":{\"sessionUpdate\":\"user_message_chunk\",\"content\":{\"type\":\"text\",\"text\":\"Hello \"}}}}\n",
            "{\"timestamp\":1700000000,\"params\":{\"update\":{\"sessionUpdate\":\"user_message_chunk\",\"content\":{\"type\":\"text\",\"text\":\"Grok\"}}}}\n",
            "{\"timestamp\":1700000001,\"params\":{\"update\":{\"sessionUpdate\":\"agent_message_chunk\",\"content\":{\"type\":\"text\",\"text\":\"Hi\"}}}}\n"));
        put(
            &h,
            ".gemini/projects.json",
            "{\"projects\":{\"/tmp/gemini\":\"slug\"}}",
        );
        put(&h, ".gemini/tmp/slug/chats/session-g.jsonl", concat!(
            "{\"sessionId\":\"g\",\"startTime\":\"2026-01-01T00:00:00Z\"}\n",
            "{\"$set\":{\"messages\":[{\"type\":\"user\",\"content\":\"stale\"}]}}\n",
            "{\"$set\":{\"messages\":[{\"type\":\"user\",\"content\":\"latest\"},{\"type\":\"gemini\",\"content\":\"answer\"}]}}\n"));
        put(&h, ".kiro/sessions/cli/k-1.json", "{\"cwd\":\"/tmp/kiro\",\"title\":\"Kiro title\",\"session_state\":{\"rts_model_state\":{\"model_info\":{\"model_id\":\"model-k\"}}}}");
        put(&h, ".kiro/sessions/cli/k-1.jsonl", "{\"kind\":\"Prompt\",\"data\":{\"content\":[{\"kind\":\"text\",\"data\":\"Kiro prompt\"}],\"meta\":{\"timestamp\":1700000000}}}\n");
        put(
            &h,
            ".kimi-code/session_index.jsonl",
            "{\"sessionId\":\"session_k-1\",\"workDir\":\"/tmp/kimi\"}\n",
        );
        put(
            &h,
            ".kimi-code/sessions/wd_a/session_k-1/state.json",
            "{\"title\":\"New Session\",\"createdAt\":\"2026-01-01T00:00:00Z\"}",
        );
        put(&h, ".kimi-code/sessions/wd_a/session_k-1/agents/main/wire.jsonl", concat!(
            "{\"type\":\"turn.prompt\",\"input\":\"Kimi prompt\"}\n",
            "{\"type\":\"context.append_message\",\"message\":{\"role\":\"assistant\",\"content\":\"Kimi answer\"}}\n"));
        let dsh = concat!(
            "{\"type\":\"session\",\"id\":\"d-1\",\"cwd\":\"/tmp/dsh\",\"createdAt\":1700000000000}\n",
            "{\"type\":\"user/message\",\"time\":1700000001000,\"data\":{\"content\":[{\"type\":\"text\",\"text\":\"DSH prompt\"}],\"source\":{\"kind\":\"user\"}}}\n",
            "{\"type\":\"assistant/message\",\"time\":1700000002000,\"data\":{\"message\":{\"source\":{\"model\":\"deepseek\"},\"content\":[{\"type\":\"text\",\"text\":\"DSH answer\"}]},\"usage\":{\"inputTokens\":3,\"outputTokens\":4}}}\n");
        let dsh_path = put(
            &h,
            ".dsh/sessions/project/s-1/session.jsonl.zstd",
            "placeholder",
        );
        let (header, events) = dsh.split_once('\n').unwrap();
        let mut compressed = zstd::stream::encode_all(format!("{header}\n").as_bytes(), 1).unwrap();
        compressed.extend(zstd::stream::encode_all(events.as_bytes(), 1).unwrap());
        fs::write(&dsh_path, compressed).unwrap();
        let before: HashMap<PathBuf, Vec<u8>> = walkdir::WalkDir::new(&h)
            .into_iter()
            .flatten()
            .filter(|e| e.file_type().is_file())
            .map(|e| (e.path().to_path_buf(), fs::read(e.path()).unwrap()))
            .collect();

        for adapter in adapters() {
            let root = adapter.roots(&h).remove(0);
            let found = adapter.discover(&root).unwrap();
            assert_eq!(found.len(), 1, "{}", adapter.agent().as_str());
            let parsed = adapter.parse(&found[0]).unwrap().unwrap();
            assert!(!parsed.messages.is_empty(), "{}", adapter.agent().as_str());
            assert!(parsed
                .messages
                .iter()
                .enumerate()
                .all(|(i, m)| m.seq == i as i64));
            assert_eq!(parsed.meta.agent, adapter.agent());
            match adapter.agent() {
                AgentId::Pi => {
                    assert_eq!(parsed.meta.tokens, Some(9));
                    assert_eq!(
                        parsed.messages[1].tool_calls[0].output.as_deref(),
                        Some("done")
                    );
                }
                AgentId::Grok => assert_eq!(parsed.messages[0].text, "Hello Grok"),
                AgentId::Gemini => {
                    assert_eq!(parsed.messages[0].text, "latest");
                    assert_eq!(parsed.meta.project_path.as_deref(), Some("/tmp/gemini"));
                }
                AgentId::Kiro => assert_eq!(parsed.meta.model.as_deref(), Some("model-k")),
                AgentId::Kimi => assert_eq!(parsed.meta.project_path.as_deref(), Some("/tmp/kimi")),
                AgentId::Dsh => {
                    assert_eq!(parsed.meta.tokens, Some(7));
                    assert_eq!(parsed.meta.model.as_deref(), Some("deepseek"));
                }
                _ => {}
            }
        }
        for (path, content) in before {
            assert_eq!(fs::read(path).unwrap(), content);
        }
        fs::remove_dir_all(h).unwrap();
    }

    #[test]
    fn dsh_ignores_subagents_and_prefers_newer_sibling() {
        let h = home();
        let root = h.join(".dsh/sessions");
        put(
            &h,
            ".dsh/sessions/p/sub/session.jsonl",
            "{\"type\":\"session\",\"id\":\"sub\",\"origin\":\"subagent\"}\n",
        );
        put(
            &h,
            ".dsh/sessions/p/main/session.jsonl",
            "{\"type\":\"session\",\"id\":\"main\"}\n",
        );
        let compressed =
            zstd::stream::encode_all(b"{\"type\":\"session\",\"id\":\"main\"}\n".as_slice(), 1)
                .unwrap();
        let sibling = root.join("p/main/session.jsonl.zstd");
        fs::write(&sibling, compressed).unwrap();
        let adapter = adapters()
            .into_iter()
            .find(|a| a.agent() == AgentId::Dsh)
            .unwrap();
        let found = adapter.discover(&root).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, sibling);
        fs::remove_dir_all(h).unwrap();
    }

    #[test]
    fn grok_subagent_parent_comes_from_sidecar() {
        let h = home();
        let root = h.join(".grok/sessions");
        put(&h, ".grok/sessions/group/orchestrator/updates.jsonl", "{\"params\":{\"update\":{\"sessionUpdate\":\"user_message_chunk\",\"content\":{\"text\":\"parent\"}}}}\n");
        put(
            &h,
            ".grok/sessions/group/orchestrator/subagents/task/meta.json",
            "{\"parent_session_id\":\"orchestrator\",\"child_session_id\":\"child\"}",
        );
        put(&h, ".grok/sessions/group/child/updates.jsonl", "{\"params\":{\"update\":{\"sessionUpdate\":\"user_message_chunk\",\"content\":{\"text\":\"child\"}}}}\n");
        let adapter = adapters()
            .into_iter()
            .find(|a| a.agent() == AgentId::Grok)
            .unwrap();
        let found = adapter.discover(&root).unwrap();
        let child = found.iter().find(|s| s.native_id == "child").unwrap();
        assert_eq!(
            adapter
                .parse(child)
                .unwrap()
                .unwrap()
                .meta
                .parent_key
                .as_deref(),
            Some("grok:orchestrator")
        );
        fs::remove_dir_all(h).unwrap();
    }

    #[test]
    fn inline_images_do_not_read_urls_or_paths() {
        let content = serde_json::json!([
            {"type":"image", "source":{"media_type":"image/png", "data":"data:image/png;base64,aGVsbG8="}},
            {"type":"image", "source":{"media_type":"image/png", "data":"file:///private/secret"}},
            {"type":"image_url", "image_url":"https://example.com/image.png"}
        ]);
        let (_, images) = text_and_images(&content);
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].data_base64, "aGVsbG8=");
    }
}
