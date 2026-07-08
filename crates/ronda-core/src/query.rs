//! Shared text answers for the CLI and MCP surfaces.
use crate::intel::{
    report::{hours, Evidence},
    Outcome,
};
use crate::{AgentId, MessageKind, Role, SessionMeta, SessionQuery, Store};
use anyhow::{anyhow, Result};
use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use serde::Deserialize;
use std::path::Path;

#[derive(Default, Clone, Deserialize)]
pub struct ListArgs {
    pub project: Option<String>,
    #[serde(default)]
    pub agents: Vec<String>,
    pub since: Option<String>,
    pub limit: Option<usize>,
    #[serde(default)]
    pub starred: bool,
}
#[derive(Default, Clone, Deserialize)]
pub struct SearchArgs {
    pub query: String,
    #[serde(flatten)]
    pub filter: ListArgs,
}
#[derive(Default, Clone, Deserialize)]
pub struct ShowArgs {
    pub key: String,
    pub subagent: Option<String>,
    pub from_seq: Option<i64>,
    pub max_messages: Option<usize>,
    pub max_chars: Option<usize>,
    pub max_message_chars: Option<usize>,
    #[serde(default)]
    pub include_tools: bool,
    #[serde(default)]
    pub include_thinking: bool,
}

pub fn agent_id(name: &str) -> Option<AgentId> {
    let n = name.trim().to_lowercase().replace([' ', '_'], "-");
    AgentId::ALL
        .into_iter()
        .find(|a| a.as_str() == n)
        .or(match n.as_str() {
            "claude" => Some(AgentId::ClaudeCode),
            "deepseek" | "deepseek-harness" => Some(AgentId::Dsh),
            "opencode2" => Some(AgentId::Opencode),
            "gemini-cli" => Some(AgentId::Gemini),
            "copilot-cli" => Some(AgentId::Copilot),
            "grok-build" => Some(AgentId::Grok),
            "hermes-agent" => Some(AgentId::Hermes),
            "oh-my-pi" => Some(AgentId::Omp),
            _ => None,
        })
}

fn selected_agents(raw: &[String]) -> Result<Vec<AgentId>> {
    raw.iter()
        .flat_map(|s| s.split(','))
        .map(|s| agent_id(s).ok_or_else(|| anyhow!("unknown agent: {s}")))
        .collect()
}

fn since_ms(raw: Option<&str>) -> Result<Option<i64>> {
    let Some(s) = raw else { return Ok(None) };
    let s = s.trim();
    if let Some(unit) = s.chars().last() {
        if matches!(unit, 'm' | 'h' | 'd' | 'w')
            && s[..s.len() - 1].chars().all(|c| c.is_ascii_digit())
        {
            let n: i64 = s[..s.len() - 1].parse()?;
            let seconds = n
                .checked_mul(match unit {
                    'm' => 60,
                    'h' => 3600,
                    'd' => 86400,
                    _ => 604800,
                })
                .ok_or_else(|| anyhow!("since duration is too large"))?;
            return Ok(Some(
                Utc::now()
                    .timestamp_millis()
                    .saturating_sub(seconds.saturating_mul(1000)),
            ));
        }
    }
    if let Ok(t) = DateTime::parse_from_rfc3339(s) {
        return Ok(Some(t.timestamp_millis()));
    }
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Ok(Some(
            Local
                .from_local_datetime(&d.and_hms_opt(0, 0, 0).unwrap())
                .earliest()
                .ok_or_else(|| anyhow!("ambiguous date"))?
                .timestamp_millis(),
        ));
    }
    if let Ok(t) = NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M") {
        return Ok(Some(
            Local
                .from_local_datetime(&t)
                .earliest()
                .ok_or_else(|| anyhow!("ambiguous date"))?
                .timestamp_millis(),
        ));
    }
    Err(anyhow!("invalid since value: {s}"))
}

pub fn validate_since(raw: Option<&str>) -> Result<()> {
    since_ms(raw).map(|_| ())
}

fn project_paths(store: &Store, project: Option<&str>) -> Result<Option<Vec<String>>> {
    let Some(project) = project else {
        return Ok(None);
    };
    if project.starts_with('.') {
        return Err(anyhow!("project path must be absolute, or a project name"));
    }
    let projects = store.projects()?;
    let mut matches = Vec::new();
    if Path::new(project).is_absolute() {
        let path = Path::new(project);
        if projects.iter().any(|p| p.path == project) {
            return Ok(Some(vec![project.into()]));
        }
        let ancestor = projects
            .iter()
            .filter(|p| path.starts_with(&p.path))
            .max_by_key(|p| p.path.len());
        if let Some(p) = ancestor {
            return Ok(Some(vec![p.path.clone()]));
        }
        matches.extend(
            projects
                .iter()
                .filter(|p| Path::new(&p.path).starts_with(path))
                .map(|p| p.path.clone()),
        );
    } else {
        matches.extend(
            projects
                .iter()
                .filter(|p| {
                    Path::new(&p.path)
                        .file_name()
                        .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(project))
                })
                .map(|p| p.path.clone()),
        );
    }
    Ok(Some(matches))
}

fn accept(
    meta: &SessionMeta,
    paths: &Option<Vec<String>>,
    agents: &[AgentId],
    since: Option<i64>,
    starred: bool,
) -> bool {
    paths
        .as_ref()
        .is_none_or(|v| meta.project_path.as_ref().is_some_and(|p| v.contains(p)))
        && (agents.is_empty() || agents.contains(&meta.agent))
        && since.is_none_or(|t| meta.updated_at >= t)
        && (!starred || meta.starred)
}

fn date(ms: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ms)
        .map(|d| {
            d.with_timezone(&Local)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        })
        .unwrap_or_else(|| "unknown time".into())
}
fn freshness(store: &Store) -> Result<String> {
    let last = store
        .list_sessions(&SessionQuery {
            include_archived: true,
            ..Default::default()
        })?
        .into_iter()
        .map(|s| s.updated_at)
        .max();
    Ok(last.map(|t| format!("\nIndex covers activity up to {} (local time); Ronda keeps it fresh while running.\n", date(t)))
        .unwrap_or_else(|| "\nIndex is empty. Launch Ronda or run `ronda-cli index`.\n".into()))
}
fn unknown_project(store: &Store, name: &str) -> Result<String> {
    let mut out = format!("No indexed project matches `{name}`. Known projects:\n");
    for p in store.projects()?.into_iter().take(30) {
        out.push_str(&format!("- {}\n", p.path));
    }
    Ok(out)
}
fn session_line(meta: &SessionMeta) -> String {
    let mut suffix = String::new();
    if let Some(host) = &meta.host {
        suffix.push_str(&format!(" · @{host}"));
    }
    if let Some(source) = &meta.source {
        suffix.push_str(&format!(" · via {source}"));
    }
    if meta.starred {
        suffix.push_str(" · ★ starred");
    }
    if let Some(model) = &meta.model {
        suffix.push_str(&format!(" · {model}"));
    }
    format!(
        "- `{}` · {} · {}\n  {} · updated {}{}\n",
        meta.key,
        meta.agent.as_str(),
        meta.title,
        meta.project_path.as_deref().unwrap_or("Unknown project"),
        date(meta.updated_at),
        suffix
    )
}

pub fn list_sessions(store: &Store, args: &ListArgs) -> Result<String> {
    let paths = project_paths(store, args.project.as_deref())?;
    if paths.as_ref().is_some_and(Vec::is_empty) {
        return unknown_project(store, args.project.as_deref().unwrap_or(""));
    }
    let agents = selected_agents(&args.agents)?;
    let since = since_ms(args.since.as_deref())?;
    let mut sessions = store.list_sessions(&SessionQuery::default())?;
    sessions.retain(|s| s.parent_key.is_none() && accept(s, &paths, &agents, since, args.starred));
    sessions.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
    let count = sessions.len();
    sessions.truncate(args.limit.unwrap_or(20).clamp(1, 100));
    let mut out = format!(
        "{count} sessions — showing {} most recent.\n\n",
        sessions.len()
    );
    for s in &sessions {
        out.push_str(&session_line(s));
    }
    out.push_str(&freshness(store)?);
    Ok(out)
}

pub fn search(store: &Store, args: &SearchArgs) -> Result<String> {
    let paths = project_paths(store, args.filter.project.as_deref())?;
    if paths.as_ref().is_some_and(Vec::is_empty) {
        return unknown_project(store, args.filter.project.as_deref().unwrap_or(""));
    }
    let agents = selected_agents(&args.filter.agents)?;
    let since = since_ms(args.filter.since.as_deref())?;
    let hits = store.search(
        &args.query,
        &SessionQuery {
            include_archived: true,
            ..Default::default()
        },
        2000,
    )?;
    let mut grouped: Vec<(SessionMeta, Vec<(i64, String)>)> = Vec::new();
    for h in hits {
        if !accept(&h.session, &paths, &agents, since, false) {
            continue;
        }
        if let Some((_, snippets)) = grouped.iter_mut().find(|(s, _)| s.key == h.session.key) {
            if snippets.len() < 3 {
                snippets.push((h.seq, h.snippet));
            }
        } else {
            grouped.push((h.session, vec![(h.seq, h.snippet)]));
        }
    }
    let count = grouped.len();
    grouped.truncate(args.filter.limit.unwrap_or(10).clamp(1, 30));
    let mut out = format!(
        "{count} sessions match `{}` — showing {}.\n\n",
        args.query,
        grouped.len()
    );
    for (i, (s, snippets)) in grouped.iter().enumerate() {
        out.push_str(&format!(
            "{}. `{}` · {} · {}\n  {} · updated {}\n",
            i + 1,
            s.key,
            s.agent.as_str(),
            s.title,
            s.project_path.as_deref().unwrap_or("Unknown project"),
            date(s.updated_at)
        ));
        for (seq, snippet) in snippets {
            out.push_str(&format!(
                "  - seq {seq}: {}\n    ref: ronda://session/{}#{seq}\n",
                snippet.replace('\n', " "),
                s.key
            ));
        }
    }
    out.push_str(&freshness(store)?);
    Ok(out)
}

fn resolve_key(store: &Store, input: &str) -> Result<(String, Option<i64>)> {
    let input = input.strip_prefix("ronda://session/").unwrap_or(input);
    let (key, seq) = input
        .rsplit_once('#')
        .map(|(k, n)| (k, n.parse::<i64>().ok()))
        .unwrap_or((input, None));
    if store.get_session(key)?.is_some() {
        return Ok((key.into(), seq));
    }
    let matches: Vec<_> = store
        .list_sessions(&SessionQuery {
            include_archived: true,
            ..Default::default()
        })?
        .into_iter()
        .filter(|s| s.native_id == key)
        .map(|s| s.key)
        .collect();
    match matches.as_slice() {
        [one] => Ok((one.clone(), seq)),
        [] => Err(anyhow!(
            "unknown session `{key}`; use a key like `codex:<id>`"
        )),
        _ => Err(anyhow!(
            "ambiguous native id `{key}`; choose one of: {}",
            matches.join(", ")
        )),
    }
}

pub fn get_session(store: &Store, args: &ShowArgs) -> Result<String> {
    let (key, from_ref) = resolve_key(store, &args.key)?;
    let main = store
        .get_session(&key)?
        .ok_or_else(|| anyhow!("unknown session `{key}`"))?;
    let mut children: Vec<_> = store
        .list_sessions(&SessionQuery {
            include_archived: true,
            ..Default::default()
        })?
        .into_iter()
        .filter(|child| {
            child.host == main.host
                && child.parent_key.as_deref().is_some_and(|parent| {
                    parent == main.key
                        || parent == format!("{}:{}", main.agent.as_str(), main.native_id)
                })
        })
        .collect();
    children.sort_by(|a, b| a.native_id.cmp(&b.native_id));
    if args.subagent.as_deref() == Some("*") {
        let mut out = format!("Subagents of `{}` ({}):\n", main.key, children.len());
        append_child_refs(&mut out, &main, &children, children.len());
        return Ok(out);
    }
    let selected = args.subagent.as_deref().map(|selector| {
        let selector = selector
            .strip_prefix("ronda://session/")
            .unwrap_or(selector)
            .split('#')
            .next()
            .unwrap_or(selector);
        children
            .iter()
            .filter(|child| {
                child.key == selector
                    || child.native_id == selector
                    || child_label(&main, child) == selector
            })
            .collect::<Vec<_>>()
    });
    let meta = match selected.as_deref() {
        Some([child]) => (*child).clone(),
        Some([]) => {
            return Err(anyhow!(
                "unknown subagent for `{}`; use `--subagent '*'` to list available IDs",
                main.key
            ))
        }
        Some(_) => return Err(anyhow!("ambiguous subagent; use its full session key")),
        None => main.clone(),
    };
    let messages = store.get_transcript(&meta.key)?;
    let from = args
        .from_seq
        .or(if args.subagent.is_none() {
            from_ref
        } else {
            None
        })
        .unwrap_or(0)
        .max(0);
    let max_messages = args.max_messages.unwrap_or(60).clamp(1, 200);
    let max_chars = args.max_chars.unwrap_or(20_000).clamp(200, 100_000);
    let per_message = args.max_message_chars.unwrap_or(4_000).clamp(100, 50_000);
    let mut out = format!(
        "# {}\n\nKey: `{}` · Agent: {}",
        meta.title,
        meta.key,
        meta.agent.as_str()
    );
    if let Some(host) = &meta.host {
        out.push_str(&format!(" · Host: {host}"));
    }
    if let Some(project) = &meta.project_path {
        out.push_str(&format!("\nProject: {project}"));
    }
    if let Some(model) = &meta.model {
        out.push_str(&format!("\nModel: {model}"));
    }
    out.push_str(&format!(
        "\nUpdated: {} · {} messages\n\n",
        date(meta.updated_at),
        messages.len()
    ));
    let mut shown = 0;
    let mut next = None;
    let mut hidden_meta = 0;
    for m in messages.iter().filter(|m| m.seq >= from) {
        if matches!(m.kind, MessageKind::Meta) {
            hidden_meta += 1;
            continue;
        }
        if shown >= max_messages || out.chars().count() >= max_chars {
            next = Some(m.seq);
            break;
        }
        let role = match m.role {
            Role::User => "User",
            Role::Assistant => "Assistant",
            Role::System => "System",
        };
        let time = m
            .timestamp
            .map(|t| format!(" · {}", date(t)))
            .unwrap_or_default();
        let mut body = String::new();
        if matches!(m.kind, MessageKind::CompactSummary) {
            body.push_str("> Compaction summary\n> ");
        }
        body.push_str(&m.text);
        if args.include_thinking {
            if let Some(t) = &m.thinking {
                body.push_str(&format!("\n\nThinking: {t}"));
            }
        }
        for tool in m.tool_calls.iter().take(40) {
            body.push_str(&format!("\n- 🔧 {}", tool.name));
            if let Some(input) = &tool.input {
                body.push_str(&format!(
                    ": {}",
                    input
                        .chars()
                        .take(120)
                        .collect::<String>()
                        .replace('\n', " ")
                ));
            }
            if args.include_tools {
                if let Some(output) = &tool.output {
                    body.push_str(&format!("\n  Output: {output}"));
                }
            }
        }
        if m.tool_calls.len() > 40 {
            body.push_str(&format!(
                "\n- … {} more tool calls",
                m.tool_calls.len() - 40
            ));
        }
        if !m.images.is_empty() {
            body.push_str(&format!("\n[{} image(s)]", m.images.len()));
        }
        let body: String = body.chars().take(per_message).collect();
        out.push_str(&format!("### [seq {}] {role}{time}\n{body}\n\n", m.seq));
        shown += 1;
    }
    if hidden_meta > 0 {
        out.push_str(&format!(
            "{hidden_meta} injected context messages omitted.\n"
        ));
    }
    if let Some(next) = next {
        out.push_str(&format!(
            "Showing {shown} messages; continue with from_seq={next}.\n"
        ));
    } else {
        out.push_str("End of transcript.\n");
        if args.subagent.is_none() && !children.is_empty() {
            out.push_str(&format!("\nSubagents ({}):\n", children.len()));
            append_child_refs(&mut out, &main, &children, 30);
            if children.len() > 30 {
                out.push_str("Use --subagent '*' for the full list.\n");
            }
        }
    }
    Ok(out)
}

fn child_label<'a>(parent: &SessionMeta, child: &'a SessionMeta) -> &'a str {
    child
        .native_id
        .strip_prefix(&format!("{}:", parent.native_id))
        .unwrap_or(&child.native_id)
}

fn append_child_refs(
    out: &mut String,
    parent: &SessionMeta,
    children: &[SessionMeta],
    limit: usize,
) {
    for child in children.iter().take(limit) {
        out.push_str(&format!(
            "- `{}` · {}\n  ref: ronda://session/{}#0\n",
            child_label(parent, child),
            child.title,
            child.key
        ));
    }
}

pub fn list_projects(store: &Store, since: Option<&str>, limit: Option<usize>) -> Result<String> {
    let since = since_ms(since)?;
    let projects: Vec<_> = store
        .projects()?
        .into_iter()
        .filter(|p| since.is_none_or(|s| p.updated_at >= s))
        .take(limit.unwrap_or(50).clamp(1, 200))
        .collect();
    let mut out = format!("{} projects.\n\n", projects.len());
    for p in projects {
        out.push_str(&format!(
            "- {} · {} sessions · updated {}\n",
            p.path,
            p.session_count,
            date(p.updated_at)
        ));
    }
    out.push_str(&freshness(store)?);
    Ok(out)
}

#[derive(Default, Clone, Deserialize)]
pub struct InsightsArgs {
    pub project: Option<String>,
    pub since: Option<String>,
}
#[derive(Default, Clone, Deserialize)]
pub struct FindErrorArgs {
    pub error: String,
}

fn reference(e: &Evidence) -> String {
    format!("ronda://session/{}#{}", e.session_key, e.seq)
}

pub fn insights(store: &Store, args: &InsightsArgs) -> Result<String> {
    let since_raw = args.since.as_deref().unwrap_or("30d");
    let since = if since_raw == "all" {
        None
    } else {
        since_ms(Some(since_raw))?
    };
    let project = match project_paths(store, args.project.as_deref())? {
        None => None,
        Some(paths) if paths.is_empty() => {
            return unknown_project(store, args.project.as_deref().unwrap_or(""))
        }
        Some(paths) if paths.len() > 1 => {
            let mut out = format!(
                "`{}` matches several projects; pass one path:\n",
                args.project.as_deref().unwrap_or("")
            );
            paths.iter().for_each(|p| out.push_str(&format!("- {p}\n")));
            return Ok(out);
        }
        Some(mut paths) => paths.pop(),
    };
    let r = store.intelligence(since, project.as_deref())?;
    let t = &r.totals;
    let mut out = format!(
        "Session intelligence · {} · {}\n{} sessions · {} active · {} recovering from failing commands · {} of {} tool calls failed · {} recurring errors\n",
        if since.is_some() { format!("since {since_raw}") } else { "all time".into() },
        project.as_deref().unwrap_or("all projects"),
        t.sessions, hours(t.active_ms), hours(t.recovery_ms), t.tool_errors, t.tool_calls, t.recurring_bugs
    );
    if t.sessions == 0 {
        out.push_str(&freshness(store)?);
        return Ok(out);
    }
    out.push_str("\nWhere time goes (excluding recovery)\n");
    let mut time = r.time.clone();
    time.sort_by_key(|row| std::cmp::Reverse(row.active_ms));
    for row in &time {
        out.push_str(&format!(
            "- {}: {} · {} sessions\n",
            row.label,
            hours(row.active_ms),
            row.sessions
        ));
    }
    out.push_str("\nHow sessions end\n");
    for row in &r.outcomes {
        out.push_str(&format!(
            "- {}: {} sessions · {}\n",
            row.label,
            row.sessions,
            hours(row.active_ms)
        ));
    }
    if !r.failures.is_empty() {
        out.push_str("\nAgent failures\n");
        for row in &r.failures {
            out.push_str(&format!("- {}: {} sessions\n", row.label, row.sessions));
            for e in row.evidence.iter().take(3) {
                out.push_str(&format!("  - {} · {}\n", reference(e), e.title));
            }
        }
    }
    if !r.recurring.is_empty() {
        out.push_str("\nRecurring errors\n");
        for bug in &r.recurring {
            out.push_str(&format!(
                "- {} · {} sessions · {} · last seen {}{}\n",
                bug.message,
                bug.sessions,
                bug.agents.join(", "),
                date(bug.last_seen),
                if bug.came_back {
                    " · came back after a committed fix"
                } else {
                    ""
                }
            ));
            for e in bug.evidence.iter().take(3) {
                out.push_str(&format!("  - {} · {}\n", reference(e), e.title));
            }
        }
    }
    if !r.stack.is_empty() {
        out.push_str("\nStack (share of sessions with tool calls)\n");
        for row in r.stack.iter().take(15) {
            out.push_str(&format!(
                "- {}: {}% · {} sessions{}\n",
                row.tech,
                row.share,
                row.sessions,
                if row.new { " · new" } else { "" }
            ));
        }
    }
    if !r.callouts.is_empty() {
        out.push_str("\nNotes\n");
        r.callouts
            .iter()
            .for_each(|c| out.push_str(&format!("- {c}\n")));
    }
    let blind: Vec<&str> = r
        .coverage
        .iter()
        .filter(|c| c.with_tools == 0)
        .map(|c| c.agent.as_str())
        .collect();
    if !blind.is_empty() {
        out.push_str(&format!(
            "\nNo tool data from {}, so failures, stack, and outcomes leave them out.\n",
            blind.join(", ")
        ));
    }
    out.push_str(&freshness(store)?);
    Ok(out)
}

pub fn find_error(store: &Store, args: &FindErrorArgs) -> Result<String> {
    if args.error.trim().is_empty() {
        return Err(anyhow!("error text is empty"));
    }
    let Some((message, hits)) = store.find_error(&args.error)? else {
        return Ok("No indexed session hit this error. Ronda matches errors after removing paths, line numbers, and other values.\n".into());
    };
    let mut out = format!("Seen in {} sessions: {message}\n\n", hits.len());
    for (e, outcome) in hits.iter().take(20) {
        let label = Outcome::parse(outcome)
            .map(Outcome::label)
            .unwrap_or(outcome);
        out.push_str(&format!("- {} · {} · {}\n", reference(e), label, e.title));
    }
    out.push_str("\nRead one from that message with `ronda_get_session` (key and from_seq), including tools, to see how it was handled.\n");
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ParsedSession, TranscriptMessage};
    #[test]
    fn search_reference_opens_same_sequence() {
        let path = std::env::temp_dir().join(format!("ronda-query-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut db = Store::open(&path).unwrap();
        let meta = SessionMeta {
            key: "codex:test".into(),
            native_id: "test".into(),
            agent: AgentId::Codex,
            host: None,
            parent_key: None,
            title: "Test".into(),
            project_path: Some("/tmp/project".into()),
            source_path: "/tmp/x".into(),
            created_at: 1,
            updated_at: 2,
            model: None,
            source: None,
            tokens: None,
            archived: false,
            metadata_only: false,
            can_delete: false,
            starred: false,
            pinned: false,
        };
        let msg = TranscriptMessage {
            seq: 7,
            role: Role::User,
            kind: MessageKind::Text,
            text: "unique needle".into(),
            timestamp: None,
            model: None,
            thinking: None,
            tool_calls: Vec::new(),
            images: Vec::new(),
        };
        db.upsert(
            &ParsedSession {
                meta,
                messages: vec![msg],
            },
            "fixture",
        )
        .unwrap();
        let hits = search(
            &db,
            &SearchArgs {
                query: "needle".into(),
                filter: ListArgs::default(),
            },
        )
        .unwrap();
        assert!(hits.contains("ronda://session/codex:test#7"));
        let page = get_session(
            &db,
            &ShowArgs {
                key: "ronda://session/codex:test#7".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(page.contains("[seq 7] User"));
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
