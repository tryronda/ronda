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
    /// Keep sessions updated at or before this time (same formats as `since`).
    #[serde(default)]
    pub until: Option<String>,
    pub limit: Option<usize>,
    #[serde(default)]
    pub starred: bool,
    /// List the oldest activity first; applies to session and project lists.
    #[serde(default)]
    pub reverse: bool,
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

/// `(min, max)` bounds applied to size options; shared with the CLI clamp notes.
pub const SESSIONS_LIMIT: (usize, usize) = (1, 100);
pub const SEARCH_LIMIT: (usize, usize) = (1, 30);
pub const PROJECTS_LIMIT: (usize, usize) = (1, 200);
pub const SHOW_MESSAGES: (usize, usize) = (1, 200);
pub const SHOW_CHARS: (usize, usize) = (200, 100_000);
pub const SHOW_MESSAGE_CHARS: (usize, usize) = (100, 50_000);

/// Returns a note when `value` falls outside `bounds` and will be clamped.
pub fn clamp_note(flag: &str, value: Option<usize>, bounds: (usize, usize)) -> Option<String> {
    let v = value?;
    let c = v.clamp(bounds.0, bounds.1);
    (c != v).then(|| format!("{flag} {v} clamped to {c}"))
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

/// Rejects unknown agent ids up front, listing the valid ones.
pub fn validate_agents(raw: &[String]) -> Result<()> {
    selected_agents(raw).map(|_| ()).map_err(|_| {
        let bad: Vec<&str> = raw
            .iter()
            .flat_map(|s| s.split(','))
            .filter(|s| agent_id(s).is_none())
            .collect();
        let valid: Vec<&str> = AgentId::ALL.iter().map(|a| a.as_str()).collect();
        anyhow!(
            "unknown agent: {}; valid agents: {}",
            bad.join(", "),
            valid.join(", ")
        )
    })
}

fn since_ms(raw: Option<&str>) -> Result<Option<i64>> {
    time_ms(raw, "since")
}

fn time_ms(raw: Option<&str>, name: &str) -> Result<Option<i64>> {
    let Some(s) = raw else { return Ok(None) };
    let s = s.trim();
    if let Some(unit) = s.chars().last() {
        let digits = &s[..s.len() - unit.len_utf8()];
        if matches!(unit, 'm' | 'h' | 'd' | 'w')
            && !digits.is_empty()
            && digits.chars().all(|c| c.is_ascii_digit())
        {
            let invalid = || anyhow!("invalid {name} value: {s}");
            let n: i64 = digits.parse().map_err(|_| invalid())?;
            let seconds = n
                .checked_mul(match unit {
                    'm' => 60,
                    'h' => 3600,
                    'd' => 86400,
                    _ => 604800,
                })
                .ok_or_else(invalid)?;
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
        let local_midnight = |d: NaiveDate| {
            Local
                .from_local_datetime(&d.and_hms_opt(0, 0, 0).unwrap())
                .earliest()
                .map(|t| t.timestamp_millis())
                .ok_or_else(|| anyhow!("ambiguous date"))
        };
        // A bare date as an upper bound means the whole local day, so it ends just before the
        // next local midnight; as a lower bound it starts at this day's midnight.
        if name == "until" {
            if let Some(next) = d.succ_opt() {
                return Ok(Some(local_midnight(next)? - 1));
            }
        }
        return Ok(Some(local_midnight(d)?));
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
    Err(anyhow!("invalid {name} value: {s}"))
}

pub fn validate_until(raw: Option<&str>) -> Result<()> {
    time_ms(raw, "until").map(|_| ())
}

pub fn validate_since(raw: Option<&str>) -> Result<()> {
    since_ms(raw).map(|_| ())
}

/// Rejects relative paths. Names that merely start with a dot, such as `.dotfiles`, are fine.
pub fn validate_project(project: Option<&str>) -> Result<()> {
    let Some(project) = project else {
        return Ok(());
    };
    let relative = project == "."
        || project == ".."
        || ["./", "../", ".\\", "..\\"]
            .iter()
            .any(|prefix| project.starts_with(prefix));
    if relative {
        return Err(anyhow!("project path must be absolute, or a project name"));
    }
    Ok(())
}

/// Distinct project paths of root sessions, archived ones included, newest first.
fn known_project_paths(store: &Store) -> Result<Vec<String>> {
    let sessions = store.list_sessions(&SessionQuery {
        include_archived: true,
        ..Default::default()
    })?;
    let mut paths: Vec<String> = Vec::new();
    for s in sessions.iter().filter(|s| s.parent_key.is_none()) {
        if let Some(p) = s.project_path.as_deref().filter(|p| !p.is_empty()) {
            if !paths.iter().any(|known| known == p) {
                paths.push(p.to_string());
            }
        }
    }
    Ok(paths)
}

fn project_paths(store: &Store, project: Option<&str>) -> Result<Option<Vec<String>>> {
    let Some(project) = project else {
        return Ok(None);
    };
    validate_project(Some(project))?;
    let projects = known_project_paths(store)?;
    let mut matches = Vec::new();
    if Path::new(project).is_absolute() {
        let path = Path::new(project);
        if projects.iter().any(|p| p == project) {
            return Ok(Some(vec![project.into()]));
        }
        let ancestor = projects
            .iter()
            .filter(|p| path.starts_with(p))
            .max_by_key(|p| p.len());
        if let Some(p) = ancestor {
            return Ok(Some(vec![p.clone()]));
        }
        matches.extend(
            projects
                .iter()
                .filter(|p| Path::new(p).starts_with(path))
                .cloned(),
        );
    } else {
        matches.extend(
            projects
                .iter()
                .filter(|p| {
                    Path::new(p)
                        .file_name()
                        .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(project))
                })
                .cloned(),
        );
    }
    Ok(Some(matches))
}

fn accept(
    meta: &SessionMeta,
    paths: &Option<Vec<String>>,
    agents: &[AgentId],
    window: (Option<i64>, Option<i64>),
    starred: bool,
) -> bool {
    let (since, until) = window;
    paths
        .as_ref()
        .is_none_or(|v| meta.project_path.as_ref().is_some_and(|p| v.contains(p)))
        && (agents.is_empty() || agents.contains(&meta.agent))
        && since.is_none_or(|t| meta.updated_at >= t)
        && until.is_none_or(|t| meta.updated_at <= t)
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
/// `1 session`, `2 sessions`.
fn plural<T: Copy + PartialEq + From<u8> + std::fmt::Display>(n: T, noun: &str) -> String {
    format!("{n} {noun}{}", if n == T::from(1) { "" } else { "s" })
}
fn freshness(store: &Store) -> Result<String> {
    let last = store.latest_activity()?;
    Ok(last.map(|t| format!("\nIndex covers activity up to {} (local time); Ronda keeps it fresh while running.\n", date(t)))
        .unwrap_or_else(|| "\nIndex is empty. Launch Ronda or run `ronda-cli index`.\n".into()))
}
fn unknown_project(store: &Store, name: &str) -> Result<String> {
    let mut out = format!("No indexed project matches `{name}`. Known projects:\n");
    for p in known_project_paths(store)?.into_iter().take(30) {
        out.push_str(&format!("- {p}\n"));
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
    if meta.archived {
        suffix.push_str(" · archived");
    }
    if let Some(tokens) = meta.tokens.filter(|t| *t > 0) {
        suffix.push_str(&format!(" · {}", plural(tokens, "token")));
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
    let window = (
        since_ms(args.since.as_deref())?,
        time_ms(args.until.as_deref(), "until")?,
    );
    let mut sessions = store.list_sessions(&SessionQuery::default())?;
    sessions.retain(|s| s.parent_key.is_none() && accept(s, &paths, &agents, window, args.starred));
    if args.reverse {
        sessions.sort_by_key(|s| s.updated_at);
    } else {
        sessions.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
    }
    let count = sessions.len();
    sessions.truncate(
        args.limit
            .unwrap_or(20)
            .clamp(SESSIONS_LIMIT.0, SESSIONS_LIMIT.1),
    );
    let shown = if sessions.len() < count {
        format!("{} of {count}", sessions.len())
    } else {
        sessions.len().to_string()
    };
    let mut out = format!(
        "{} — showing {shown} {}. Archived sessions are excluded.\n\n",
        plural(count, "session"),
        if args.reverse {
            "oldest"
        } else {
            "most recent"
        }
    );
    for s in &sessions {
        out.push_str(&session_line(s));
    }
    out.push_str(&freshness(store)?);
    Ok(out)
}

/// Most message hits a search reads before grouping them by session.
const SEARCH_HIT_CAP: usize = 2000;

/// Rejects search or error text that is empty or only whitespace.
pub fn validate_search_text(text: &str) -> Result<()> {
    anyhow::ensure!(!text.trim().is_empty(), "search text must not be blank");
    Ok(())
}

/// Rejects a `since` later than `until`, which no session can satisfy.
pub fn validate_window(since: Option<&str>, until: Option<&str>) -> Result<()> {
    if let (Some(from), Some(to)) = (since_ms(since)?, time_ms(until, "until")?) {
        anyhow::ensure!(from <= to, "since must not be later than until");
    }
    Ok(())
}

pub fn search(store: &Store, args: &SearchArgs) -> Result<String> {
    search_capped(store, args, SEARCH_HIT_CAP)
}

fn search_capped(store: &Store, args: &SearchArgs, cap: usize) -> Result<String> {
    let paths = project_paths(store, args.filter.project.as_deref())?;
    if paths.as_ref().is_some_and(Vec::is_empty) {
        return unknown_project(store, args.filter.project.as_deref().unwrap_or(""));
    }
    let agents = selected_agents(&args.filter.agents)?;
    let window = (
        since_ms(args.filter.since.as_deref())?,
        time_ms(args.filter.until.as_deref(), "until")?,
    );
    validate_window(args.filter.since.as_deref(), args.filter.until.as_deref())?;
    // Narrow in the store where one value expresses the filter, so the hit cap applies after
    // filtering; `accept` below stays the final check for the multi-valued cases.
    let hits = store.search(
        &args.query,
        &SessionQuery {
            include_archived: true,
            agent: match agents.as_slice() {
                [only] => Some(*only),
                _ => None,
            },
            project_path: match paths.as_deref() {
                Some([only]) => Some(only.clone()),
                _ => None,
            },
            updated_from_ms: window.0,
            updated_before_ms: window.1.map(|t| t.saturating_add(1)),
            starred_only: args.filter.starred,
            ..Default::default()
        },
        cap,
    )?;
    let mut grouped: Vec<(SessionMeta, Vec<(i64, String)>)> = Vec::new();
    let mut capped = false;
    for h in hits {
        if !accept(&h.session, &paths, &agents, window, args.filter.starred) {
            continue;
        }
        if let Some((_, snippets)) = grouped.iter_mut().find(|(s, _)| s.key == h.session.key) {
            // The title row (seq -1) is not an excerpt, so it never counts toward the cap.
            if h.seq < 0 || snippets.iter().filter(|(seq, _)| *seq >= 0).count() < 3 {
                snippets.push((h.seq, h.snippet));
            } else {
                capped = true;
            }
        } else {
            grouped.push((h.session, vec![(h.seq, h.snippet)]));
        }
    }
    let count = grouped.len();
    grouped.truncate(
        args.filter
            .limit
            .unwrap_or(10)
            .clamp(SEARCH_LIMIT.0, SEARCH_LIMIT.1),
    );
    let mut out = format!(
        "{} {} `{}` — showing {}.{}\n\n",
        plural(count, "session"),
        if count == 1 { "matches" } else { "match" },
        args.query,
        if grouped.len() < count {
            format!("{} of {count}", grouped.len())
        } else {
            grouped.len().to_string()
        },
        if capped {
            " Up to 3 excerpts per session."
        } else {
            ""
        }
    );
    for (i, (s, snippets)) in grouped.iter().enumerate() {
        out.push_str(&format!(
            "{}. `{}` · {} · {}\n  {} · updated {}{}\n",
            i + 1,
            s.key,
            s.agent.as_str(),
            s.title,
            s.project_path.as_deref().unwrap_or("Unknown project"),
            date(s.updated_at),
            if s.archived { " · archived" } else { "" }
        ));
        for (seq, snippet) in snippets {
            let snippet = snippet.replace('\n', " ");
            if *seq < 0 {
                out.push_str(&format!(
                    "  - title: {snippet}\n    ref: ronda://session/{}\n",
                    s.key
                ));
            } else {
                out.push_str(&format!(
                    "  - seq {seq}: {snippet}\n    ref: ronda://session/{}#{seq}\n",
                    s.key
                ));
            }
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
    get_session_for(store, args, Surface::Mcp)
}

/// Single-quotes `value` for a shell unless it is made of safe characters only.
fn shell_arg(value: &str) -> String {
    let safe = !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_-.:/#@".contains(c));
    if safe {
        value.into()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

pub fn get_session_for(store: &Store, args: &ShowArgs, surface: Surface) -> Result<String> {
    let (key, from_ref) = resolve_key(store, &args.key)?;
    let main = store
        .get_session(&key)?
        .ok_or_else(|| anyhow!("unknown session `{key}`"))?;
    let children = store.session_children(&main)?;
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
                "unknown subagent for `{}`; use {} to list available IDs",
                main.key,
                match surface {
                    Surface::Cli => "`--subagent '*'`",
                    Surface::Mcp => "subagent \"*\"",
                }
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
    let max_messages = args
        .max_messages
        .unwrap_or(60)
        .clamp(SHOW_MESSAGES.0, SHOW_MESSAGES.1);
    let max_chars = args
        .max_chars
        .unwrap_or(20_000)
        .clamp(SHOW_CHARS.0, SHOW_CHARS.1);
    let per_message = args
        .max_message_chars
        .unwrap_or(4_000)
        .clamp(SHOW_MESSAGE_CHARS.0, SHOW_MESSAGE_CHARS.1);
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
    out.push_str(&session_timing(&meta, &messages));
    out.push_str("\n\n");
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
            if tool.is_error {
                body.push_str(" (failed)");
            }
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
        let total = body.chars().count();
        let mut body: String = body.chars().take(per_message).collect();
        if total > per_message {
            let raise = match surface {
                Surface::Cli => "--message-chars",
                Surface::Mcp => "max_message_chars",
            };
            body.push_str(&format!(
                "… [clipped: {} more characters; raise {raise}]",
                total - per_message
            ));
        }
        out.push_str(&format!("### [seq {}] {role}{time}\n{body}\n\n", m.seq));
        shown += 1;
    }
    if hidden_meta > 0 {
        out.push_str(&format!(
            "{hidden_meta} injected context messages omitted.\n"
        ));
    }
    if let Some(next) = next {
        let subagent = args.subagent.as_deref();
        match surface {
            Surface::Cli => {
                let extra = subagent
                    .map(|id| format!(" --subagent {}", shell_arg(id)))
                    .unwrap_or_default();
                out.push_str(&format!(
                    "Showing {shown} messages; continue with `ronda-cli show {} --from {next}{extra}`.\n",
                    shell_arg(&main.key)
                ));
            }
            Surface::Mcp => {
                let extra = subagent
                    .map(|id| format!(" and subagent=\"{id}\""))
                    .unwrap_or_default();
                out.push_str(&format!(
                    "Showing {shown} messages; continue with from_seq={next}{extra}.\n"
                ));
            }
        }
    } else {
        out.push_str("End of transcript.\n");
        if args.subagent.is_none() && !children.is_empty() {
            out.push_str(&format!("\nSubagents ({}):\n", children.len()));
            append_child_refs(&mut out, &main, &children, 30);
            if children.len() > 30 {
                out.push_str(match surface {
                    Surface::Cli => "Use `--subagent '*'` for the full list.\n",
                    Surface::Mcp => "Use subagent \"*\" for the full list.\n",
                });
            }
        }
    }
    Ok(out)
}

/// The `Started`/`Updated` header lines of `show`. Messages counts those the body shows;
/// injected context (`Meta`) is counted apart. Unknown start times and token counts are left out.
fn session_timing(meta: &SessionMeta, messages: &[crate::TranscriptMessage]) -> String {
    let injected = messages
        .iter()
        .filter(|m| matches!(m.kind, MessageKind::Meta))
        .count();
    let mut out = String::new();
    if meta.created_at > 0 {
        out.push_str(&format!("\nStarted: {}", date(meta.created_at)));
    }
    out.push_str(&format!(
        "\nUpdated: {} · {}",
        date(meta.updated_at),
        plural(messages.len() - injected, "message")
    ));
    if injected > 0 {
        out.push_str(&format!(" (+{injected} injected)"));
    }
    if let Some(tokens) = meta.tokens.filter(|t| *t > 0) {
        out.push_str(&format!(" · {}", plural(tokens, "token")));
    }
    if meta.starred {
        out.push_str(" · ★ starred");
    }
    if meta.archived {
        out.push_str(" · archived");
    }
    out
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
    list_projects_ordered(store, since, limit, false)
}

/// Like [`list_projects`]; `reverse` lists the oldest activity first, before the limit applies.
pub fn list_projects_ordered(
    store: &Store,
    since: Option<&str>,
    limit: Option<usize>,
    reverse: bool,
) -> Result<String> {
    let since = since_ms(since)?;
    let mut all = store.projects()?;
    if reverse {
        all.sort_by_key(|p| p.updated_at);
    }
    let mut projects: Vec<_> = all
        .into_iter()
        .filter(|p| since.is_none_or(|s| p.updated_at >= s))
        .collect();
    let total = projects.len();
    projects.truncate(
        limit
            .unwrap_or(50)
            .clamp(PROJECTS_LIMIT.0, PROJECTS_LIMIT.1),
    );
    let mut out = if projects.len() < total {
        format!(
            "Showing {} of {}. Archived sessions are not counted.\n\n",
            projects.len(),
            plural(total, "project")
        )
    } else {
        format!(
            "{}. Archived sessions are not counted.\n\n",
            plural(projects.len(), "project")
        )
    };
    for p in projects {
        out.push_str(&format!(
            "- {} · {} · updated {}\n",
            p.path,
            plural(p.session_count, "session"),
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
        "Session intelligence · {} · {}\n{} · {} active · {} recovering from failing commands · {} of {} tool calls failed · {} recurring errors\n",
        if since.is_some() { format!("since {since_raw}") } else { "all time".into() },
        project.as_deref().unwrap_or("all projects"),
        plural(t.sessions, "session"), hours(t.active_ms), hours(t.recovery_ms), t.tool_errors, t.tool_calls, t.recurring_bugs
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
            "- {}: {} · {}\n",
            row.label,
            hours(row.active_ms),
            plural(row.sessions, "session")
        ));
    }
    out.push_str("\nHow sessions end\n");
    for row in &r.outcomes {
        out.push_str(&format!(
            "- {}: {} · {}\n",
            row.label,
            plural(row.sessions, "session"),
            hours(row.active_ms)
        ));
    }
    if !r.failures.is_empty() {
        out.push_str("\nAgent failures\n");
        for row in &r.failures {
            out.push_str(&format!(
                "- {}: {}\n",
                row.label,
                plural(row.sessions, "session")
            ));
            for e in row.evidence.iter().take(3) {
                out.push_str(&format!("  - {} · {}\n", reference(e), e.title));
            }
        }
    }
    if !r.recurring.is_empty() {
        out.push_str("\nRecurring errors\n");
        for bug in &r.recurring {
            out.push_str(&format!(
                "- {} · {} · {} · last seen {}{}\n",
                bug.message,
                plural(bug.sessions, "session"),
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
                "- {}: {}% · {}{}\n",
                row.tech,
                row.share,
                plural(row.sessions, "session"),
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

/// Which front end renders the text, so follow-up hints name a command that exists there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Surface {
    Cli,
    Mcp,
}

pub fn find_error(store: &Store, args: &FindErrorArgs) -> Result<String> {
    find_error_for(store, args, Surface::Mcp)
}

pub fn find_error_for(store: &Store, args: &FindErrorArgs, surface: Surface) -> Result<String> {
    if args.error.trim().is_empty() {
        return Err(anyhow!("error text is empty"));
    }
    let Some((message, hits)) = store.find_error(&args.error)? else {
        return Ok("No indexed session hit this error. Ronda matches errors after removing paths, line numbers, and other values.\n".into());
    };
    let mut out = format!("Seen in {}: {message}\n\n", plural(hits.len(), "session"));
    for (e, outcome) in hits.iter().take(20) {
        let label = Outcome::parse(outcome)
            .map(Outcome::label)
            .unwrap_or(outcome);
        out.push_str(&format!("- {} · {} · {}\n", reference(e), label, e.title));
    }
    if hits.len() > 20 {
        out.push_str(&format!("… and {} more\n", hits.len() - 20));
    }
    out.push_str(match surface {
        Surface::Mcp => "\nRead one from that message with `ronda_get_session` (key and from_seq), including tools, to see how it was handled.\n",
        Surface::Cli => "\nRead one from that message with `ronda-cli show <ref> --tools`, using a ref above, to see how it was handled.\n",
    });
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
            labels: Vec::new(),
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
    #[test]
    fn starred_search_drops_unstarred_hits_and_blank_text_is_rejected() {
        let path = std::env::temp_dir().join(format!("ronda-starsearch-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut db = Store::open(&path).unwrap();
        seeded(&mut db, "codex:plain", AgentId::Codex, "/tmp/a", 10, false);
        seeded(&mut db, "codex:fav", AgentId::Codex, "/tmp/a", 20, false);
        db.set_flags("codex:fav", true, false).unwrap();
        let run = |starred| {
            search(
                &db,
                &SearchArgs {
                    query: "haystack".into(),
                    filter: ListArgs {
                        starred,
                        ..Default::default()
                    },
                },
            )
            .unwrap()
        };
        let all = run(false);
        assert!(
            all.contains("codex:plain") && all.contains("codex:fav"),
            "{all}"
        );
        let only = run(true);
        assert!(
            only.contains("codex:fav") && !only.contains("codex:plain"),
            "{only}"
        );
        assert!(validate_search_text("  \t\n").is_err());
        assert!(validate_search_text("").is_err());
        assert!(validate_search_text(" x ").is_ok());
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
    #[test]
    fn show_header_has_start_tokens_flags_and_message_counts() {
        let path = std::env::temp_dir().join(format!("ronda-header-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut db = Store::open(&path).unwrap();
        seeded(&mut db, "codex:plain", AgentId::Codex, "/tmp/a", 10, false);
        let show = |db: &Store, key: &str| {
            get_session(
                db,
                &ShowArgs {
                    key: key.into(),
                    ..Default::default()
                },
            )
            .unwrap()
        };
        // created_at is 1 (a real, positive time): Started shows; nothing else is known.
        let plain = show(&db, "codex:plain");
        assert!(plain.contains("\nStarted: "), "{plain}");
        assert!(plain.contains(" · 1 message\n"), "{plain}");
        assert!(
            !plain.contains("token") && !plain.contains("starred"),
            "{plain}"
        );
        assert!(
            !plain.contains("archived") && !plain.contains("injected"),
            "{plain}"
        );

        let mut meta = SessionMeta {
            key: "codex:rich".into(),
            native_id: "rich".into(),
            agent: AgentId::Codex,
            host: None,
            parent_key: None,
            title: "Rich".into(),
            project_path: Some("/tmp/a".into()),
            source_path: "/tmp/x".into(),
            created_at: 0,
            updated_at: 20,
            model: None,
            source: None,
            tokens: Some(1),
            archived: true,
            metadata_only: false,
            can_delete: false,
            starred: false,
            pinned: false,
            labels: Vec::new(),
        };
        let msg = |seq, kind| TranscriptMessage {
            seq,
            role: Role::User,
            kind,
            text: "text".into(),
            timestamp: None,
            model: None,
            thinking: None,
            tool_calls: Vec::new(),
            images: Vec::new(),
        };
        let messages = vec![
            msg(0, MessageKind::Text),
            msg(1, MessageKind::Meta),
            msg(2, MessageKind::Meta),
            msg(3, MessageKind::Text),
        ];
        db.upsert(
            &ParsedSession {
                meta: meta.clone(),
                messages: messages.clone(),
            },
            "fixture",
        )
        .unwrap();
        db.set_flags("codex:rich", true, false).unwrap();
        let rich = show(&db, "codex:rich");
        assert!(!rich.contains("Started"), "{rich}");
        assert!(
            rich.contains(" · 2 messages (+2 injected) · 1 token · ★ starred · archived\n"),
            "{rich}"
        );
        // Zero or unknown tokens never read as zero tokens.
        meta.tokens = Some(0);
        meta.key = "codex:zero".into();
        meta.native_id = "zero".into();
        db.upsert(&ParsedSession { meta, messages }, "fixture")
            .unwrap();
        assert!(!show(&db, "codex:zero").contains("token"));
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
    #[test]
    fn time_ms_rejects_bare_and_oversized_durations() {
        for bad in [
            "d",
            "w",
            " m ",
            "99999999999999999999d",
            "9223372036854775807w",
            "xd",
        ] {
            let err = time_ms(Some(bad), "since").unwrap_err().to_string();
            assert_eq!(err, format!("invalid since value: {}", bad.trim()));
        }
        assert!(time_ms(Some("7d"), "since").unwrap().is_some());
        assert!(time_ms(None, "since").unwrap().is_none());
    }

    #[test]
    fn date_only_until_covers_the_whole_local_day() {
        let start = time_ms(Some("2024-03-05"), "since").unwrap().unwrap();
        let end = time_ms(Some("2024-03-05"), "until").unwrap().unwrap();
        let next = time_ms(Some("2024-03-06"), "since").unwrap().unwrap();
        assert_eq!(end, next - 1);
        assert!(end - start >= 23 * 3_600_000);
        // Other forms are untouched by the date-only rule.
        let minute = time_ms(Some("2024-03-05 10:30"), "until").unwrap().unwrap();
        assert!(start < minute && minute < end);
        let stamp = time_ms(Some("2024-03-05T10:30:00Z"), "until").unwrap();
        assert_eq!(stamp, Some(1_709_634_600_000));
        assert!(validate_window(Some("2024-03-05"), Some("2024-03-05")).is_ok());
        assert!(validate_window(Some("2024-03-06"), Some("2024-03-05")).is_err());
    }
    #[test]
    fn plural_uses_singular_only_for_one() {
        assert_eq!(plural(0usize, "session"), "0 sessions");
        assert_eq!(plural(1usize, "session"), "1 session");
        assert_eq!(plural(1i64, "project"), "1 project");
        assert_eq!(plural(2u32, "project"), "2 projects");
    }
    fn seeded(
        db: &mut Store,
        key: &str,
        agent: AgentId,
        project: &str,
        updated_at: i64,
        archived: bool,
    ) {
        let meta = SessionMeta {
            key: key.into(),
            native_id: key.into(),
            agent,
            host: None,
            parent_key: None,
            title: key.into(),
            project_path: Some(project.into()),
            source_path: "/tmp/x".into(),
            created_at: 1,
            updated_at,
            model: None,
            source: None,
            tokens: None,
            archived,
            metadata_only: false,
            can_delete: false,
            starred: false,
            pinned: false,
            labels: Vec::new(),
        };
        let msg = TranscriptMessage {
            seq: 0,
            role: Role::User,
            kind: MessageKind::Text,
            text: "shared haystack".into(),
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
    }
    #[test]
    fn date_only_until_lists_sessions_from_that_day() {
        let path = std::env::temp_dir().join(format!("ronda-until-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut db = Store::open(&path).unwrap();
        let at = |d: &str| {
            time_ms(Some(&format!("{d} 15:00")), "since")
                .unwrap()
                .unwrap()
        };
        seeded(
            &mut db,
            "codex:day",
            AgentId::Codex,
            "/tmp/p",
            at("2024-03-05"),
            false,
        );
        seeded(
            &mut db,
            "codex:next",
            AgentId::Codex,
            "/tmp/p",
            at("2024-03-06"),
            false,
        );
        let list = |until: &str| {
            list_sessions(
                &db,
                &ListArgs {
                    until: Some(until.into()),
                    ..Default::default()
                },
            )
            .unwrap()
        };
        let out = list("2024-03-05");
        assert!(
            out.contains("codex:day") && !out.contains("codex:next"),
            "{out}"
        );
        let search = |filter: ListArgs| {
            search_capped(
                &db,
                &SearchArgs {
                    query: "haystack".into(),
                    filter,
                },
                10,
            )
            .unwrap()
        };
        let out = search(ListArgs {
            since: Some("2024-03-05".into()),
            until: Some("2024-03-05".into()),
            ..Default::default()
        });
        assert!(
            out.contains("codex:day") && !out.contains("codex:next"),
            "{out}"
        );
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn title_only_hits_are_labelled_and_open_by_plain_reference() {
        let path = std::env::temp_dir().join(format!("ronda-title-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut db = Store::open(&path).unwrap();
        seeded(
            &mut db,
            "codex:zebramigration",
            AgentId::Codex,
            "/tmp/p",
            10,
            false,
        );
        let out = search_capped(
            &db,
            &SearchArgs {
                query: "zebramigration".into(),
                filter: ListArgs::default(),
            },
            10,
        )
        .unwrap();
        assert!(out.contains("1 session matches"), "{out}");
        assert!(out.contains("  - title: "), "{out}");
        assert!(!out.contains("seq -1") && !out.contains("#-1"), "{out}");
        assert!(
            out.contains("ref: ronda://session/codex:zebramigration\n"),
            "{out}"
        );
        assert!(!out.contains("Up to 3 excerpts"), "{out}");
        let shown = get_session(
            &db,
            &ShowArgs {
                key: "ronda://session/codex:zebramigration".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(shown.contains("codex:zebramigration"), "{shown}");
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    fn show_fixture(db: &mut Store, key: &str, texts: &[&str]) {
        seeded(db, key, AgentId::Codex, "/tmp/show", 5, false);
        let mut session = ParsedSession {
            meta: db.get_session(key).unwrap().unwrap(),
            messages: Vec::new(),
        };
        session.messages = texts
            .iter()
            .enumerate()
            .map(|(seq, text)| TranscriptMessage {
                seq: seq as i64,
                role: Role::User,
                kind: MessageKind::Text,
                text: (*text).into(),
                timestamp: None,
                model: None,
                thinking: None,
                tool_calls: Vec::new(),
                images: Vec::new(),
            })
            .collect();
        db.upsert(&session, "fixture").unwrap();
    }
    #[test]
    fn show_marks_failed_tool_calls_on_both_surfaces() {
        let path = std::env::temp_dir().join(format!("ronda-failed-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut db = Store::open(&path).unwrap();
        show_fixture(&mut db, "codex:f", &["run it"]);
        let mut session = ParsedSession {
            meta: db.get_session("codex:f").unwrap().unwrap(),
            messages: Vec::new(),
        };
        let call = |id: &str, name: &str, is_error: bool| crate::ToolCall {
            id: id.into(),
            name: name.into(),
            input: Some("{}".into()),
            output: None,
            is_error,
        };
        session.messages.push(TranscriptMessage {
            seq: 0,
            role: Role::Assistant,
            kind: MessageKind::Text,
            text: "ran".into(),
            timestamp: None,
            model: None,
            thinking: None,
            tool_calls: vec![call("1", "Bash", true), call("2", "Read", false)],
            images: Vec::new(),
        });
        db.upsert(&session, "fixture").unwrap();
        let args = ShowArgs {
            key: "codex:f".into(),
            ..Default::default()
        };
        for out in [
            get_session_for(&db, &args, Surface::Cli).unwrap(),
            get_session(&db, &args).unwrap(),
        ] {
            assert!(out.contains("- 🔧 Bash (failed): {}"), "{out}");
            assert!(out.contains("- 🔧 Read: {}"), "{out}");
            assert!(!out.contains("Read (failed)"), "{out}");
        }
        let _ = std::fs::remove_file(&path);
    }
    #[test]
    fn show_hints_name_the_surface_that_shows_them() {
        let path = std::env::temp_dir().join(format!("ronda-hints-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut db = Store::open(&path).unwrap();
        show_fixture(&mut db, "codex:h", &["one", "two", "three"]);
        let args = ShowArgs {
            key: "codex:h".into(),
            max_messages: Some(1),
            ..Default::default()
        };
        let cli = get_session_for(&db, &args, Surface::Cli).unwrap();
        assert!(
            cli.contains("continue with `ronda-cli show codex:h --from 1`."),
            "{cli}"
        );
        assert!(!cli.contains("from_seq"), "{cli}");
        let mcp = get_session(&db, &args).unwrap();
        assert!(mcp.contains("continue with from_seq=1."), "{mcp}");
        assert!(!mcp.contains("ronda-cli"), "{mcp}");
        let _ = std::fs::remove_file(&path);
    }
    #[test]
    fn show_marks_messages_cut_at_the_per_message_limit() {
        let path = std::env::temp_dir().join(format!("ronda-clip-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut db = Store::open(&path).unwrap();
        show_fixture(&mut db, "codex:long", &[&"x".repeat(500)]);
        show_fixture(&mut db, "codex:short", &["short"]);
        let show = |key: &str, surface| {
            get_session_for(
                &db,
                &ShowArgs {
                    key: key.into(),
                    max_message_chars: Some(100),
                    ..Default::default()
                },
                surface,
            )
            .unwrap()
        };
        let cli = show("codex:long", Surface::Cli);
        assert!(
            cli.contains("clipped: 400 more characters; raise --message-chars"),
            "{cli}"
        );
        let mcp = show("codex:long", Surface::Mcp);
        assert!(
            mcp.contains("400 more") && mcp.contains("raise max_message_chars"),
            "{mcp}"
        );
        assert!(!show("codex:short", Surface::Cli).contains("clipped"));
        let _ = std::fs::remove_file(&path);
    }
    #[test]
    fn archived_only_projects_are_recognised() {
        let path = std::env::temp_dir().join(format!("ronda-archived-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut db = Store::open(&path).unwrap();
        seeded(&mut db, "codex:old", AgentId::Codex, "/tmp/old", 5, true);
        let filter = ListArgs {
            project: Some("old".into()),
            ..Default::default()
        };
        let out = list_sessions(&db, &filter).unwrap();
        assert!(out.contains("0 sessions"), "{out}");
        assert!(!out.contains("No indexed project"), "{out}");
        let out = search(
            &db,
            &SearchArgs {
                query: "haystack".into(),
                filter,
            },
        )
        .unwrap();
        assert!(out.contains("codex:old"), "{out}");
        let out = list_sessions(
            &db,
            &ListArgs {
                project: Some("nope".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(out.contains("- /tmp/old"), "{out}");
        let _ = std::fs::remove_file(&path);
    }
    #[test]
    fn filters_apply_before_the_hit_cap_and_archived_is_marked() {
        let path = std::env::temp_dir().join(format!("ronda-cap-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut db = Store::open(&path).unwrap();
        for n in 0..6 {
            seeded(
                &mut db,
                &format!("claude:o{n}"),
                AgentId::ClaudeCode,
                "/tmp/other",
                1000 + n,
                false,
            );
        }
        seeded(
            &mut db,
            "codex:mine",
            AgentId::Codex,
            "/tmp/mine",
            10,
            false,
        );
        seeded(&mut db, "codex:old", AgentId::Codex, "/tmp/other", 5, true);
        let run = |filter: ListArgs| {
            search_capped(
                &db,
                &SearchArgs {
                    query: "haystack".into(),
                    filter,
                },
                3,
            )
        };
        // The unfiltered cap of 3 only reaches the newer sessions.
        assert!(!run(ListArgs::default()).unwrap().contains("codex:mine"));
        let out = run(ListArgs {
            project: Some("/tmp/mine".into()),
            ..Default::default()
        })
        .unwrap();
        assert!(out.contains("1 session matches"), "{out}");
        assert!(out.contains("codex:mine"), "{out}");
        assert!(!out.contains("archived"), "{out}");
        for filter in [
            ListArgs {
                agents: vec!["codex".into()],
                ..Default::default()
            },
            ListArgs {
                until: Some("1970-01-01T00:00:00.500Z".into()),
                ..Default::default()
            },
        ] {
            let out = run(filter).unwrap();
            assert!(out.contains("2 sessions match"), "{out}");
            assert!(out.contains("codex:mine"), "{out}");
            assert!(
                out.contains(
                    " · archived
"
                ),
                "{out}"
            );
        }
        let err = run(ListArgs {
            since: Some("2000-01-02".into()),
            until: Some("2000-01-01".into()),
            ..Default::default()
        })
        .unwrap_err();
        assert_eq!(err.to_string(), "since must not be later than until");
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
