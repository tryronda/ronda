use ronda_core::{
    AgentId, MessageKind, ParsedSession, Role, SessionMeta, Store, ToolCall, TranscriptMessage,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{
    io::Write,
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

const MIN: i64 = 60_000;
const DAY: i64 = 24 * 60 * MIN;

fn session(
    agent: AgentId,
    id: &str,
    start: i64,
    prompt: &str,
    tools: &[(&str, &str, &str, bool)],
) -> ParsedSession {
    let key = format!("{}:{id}", agent.as_str());
    let mut messages = vec![TranscriptMessage {
        seq: 0,
        role: Role::User,
        kind: MessageKind::Text,
        text: prompt.into(),
        timestamp: Some(start),
        model: None,
        thinking: None,
        tool_calls: vec![],
        images: vec![],
    }];
    for (i, (name, input, output, is_error)) in tools.iter().enumerate() {
        let seq = i as i64 + 1;
        messages.push(TranscriptMessage {
            seq,
            role: Role::Assistant,
            kind: MessageKind::Text,
            text: String::new(),
            timestamp: Some(start + seq * MIN),
            model: None,
            thinking: None,
            tool_calls: vec![ToolCall {
                id: seq.to_string(),
                name: (*name).into(),
                input: Some((*input).into()),
                output: Some((*output).into()),
                is_error: *is_error,
            }],
            images: vec![],
        });
    }
    let end = start + tools.len() as i64 * MIN;
    ParsedSession {
        meta: SessionMeta {
            key,
            native_id: id.into(),
            agent,
            host: None,
            parent_key: None,
            title: format!("{prompt} ({id})"),
            project_path: Some("/repo".into()),
            source_path: format!("/sources/{id}"),
            created_at: start,
            updated_at: end,
            model: None,
            source: None,
            tokens: Some(100),
            archived: false,
            metadata_only: false,
            can_delete: true,
            starred: false,
            pinned: false,
        },
        messages,
    }
}

const LOCKED: &str = "Error: SQLITE_BUSY: database is locked";

fn library(dir: &std::path::Path) -> std::path::PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let path = dir.join("ronda.db");
    let mut store = Store::open(&path).unwrap();
    // Claude Code hits the lock error, fixes it, and commits.
    store
        .upsert(
            &session(
                AgentId::ClaudeCode,
                "a",
                now - 3 * DAY,
                "Fix the reindex crash",
                &[
                    (
                        "Bash",
                        r#"{"command":"bun test"}"#,
                        &format!("Exit code 1\n{LOCKED} at /Users/me/repo/src/store.ts:41:7"),
                        true,
                    ),
                    ("Edit", r#"{"file_path":"/repo/src/store.ts"}"#, "ok", false),
                    (
                        "Bash",
                        r#"{"command":"bun test"}"#,
                        "Exit code 0\n12 pass",
                        false,
                    ),
                    (
                        "Bash",
                        r#"{"command":"git commit -am 'Retry busy writes'"}"#,
                        "[main 1a2b] Retry busy writes",
                        false,
                    ),
                ],
            ),
            "f1",
        )
        .unwrap();
    // Two days later Codex hits the same error from another path and line, and ends failing.
    store.upsert(&session(AgentId::Codex, "b", now - DAY, "Add bulk import", &[
        ("apply_patch", "*** Begin Patch\n*** Add File: /repo/src/import.ts\n*** End Patch", "Success.", false),
        ("exec_command", r#"{"cmd":"bun test"}"#, &format!("Process exited with code 1\nOutput:\n{LOCKED} at /home/ci/repo/src/store.ts:88:13"), false),
    ]), "f2").unwrap();
    store
        .upsert(
            &session(
                AgentId::Codex,
                "c",
                now - 40 * DAY,
                "How does sync work?",
                &[],
            ),
            "f3",
        )
        .unwrap();
    path
}

#[test]
fn recurring_error_across_agents() {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("ronda-intel-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = library(&dir);
    let store = Store::open(&path).unwrap();
    let week = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
        - 7 * DAY;
    let report = store.intelligence(Some(week), None).unwrap();

    assert_eq!(report.totals.sessions, 2);
    assert_eq!(report.recurring.len(), 1);
    let bug = &report.recurring[0];
    assert_eq!(
        bug.message,
        format!("{LOCKED} at /home/ci/repo/src/store.ts:88:13")
    );
    assert_eq!((bug.sessions, bug.came_back), (2, true));
    assert_eq!(bug.agents, ["claude-code", "codex"]);
    assert_eq!(bug.evidence[0].session_key, "codex:b");
    let outcomes: Vec<(&str, usize)> = report
        .outcomes
        .iter()
        .map(|o| (o.outcome.as_str(), o.sessions))
        .collect();
    assert_eq!(outcomes, [("committed", 1), ("failed", 1)]);
    let categories: Vec<&str> = report.time.iter().map(|t| t.category.as_str()).collect();
    assert_eq!(categories, ["features", "bugs"]);
    assert_eq!(
        report
            .failures
            .iter()
            .map(|f| f.pattern.as_str())
            .collect::<Vec<_>>(),
        ["tests_failing_at_end"]
    );
    assert!(report
        .stack
        .iter()
        .any(|s| s.tech == "Bun" && s.sessions == 2 && s.share == 100 && s.new));
    assert!(report.callouts.iter().any(|c| c.contains("came back")));
    assert_eq!(store.intelligence(None, None).unwrap().totals.sessions, 3);
    assert_eq!(
        store
            .intelligence(Some(week), Some("/elsewhere"))
            .unwrap()
            .totals
            .sessions,
        0
    );

    let (message, hits) = store
        .find_error("Error: SQLITE_BUSY: database is locked at /tmp/x/store.ts:1:1")
        .unwrap()
        .unwrap();
    assert!(message.contains("database is locked"));
    assert_eq!(
        hits.iter()
            .map(|(e, outcome)| (e.session_key.as_str(), outcome.as_str()))
            .collect::<Vec<_>>(),
        [("codex:b", "failed"), ("claude-code:a", "committed")]
    );

    // Deleting a session removes its facts.
    let mut store = store;
    store.tombstone("codex:b").unwrap();
    assert!(store
        .intelligence(Some(week), None)
        .unwrap()
        .recurring
        .is_empty());
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn existing_index_is_backfilled_on_open() {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("ronda-intel-migrate-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = library(&dir);
    // Simulate an index written before intelligence existed.
    let db = Connection::open(&path).unwrap();
    db.execute_batch("DROP TABLE session_facts; DROP TABLE error_events; PRAGMA user_version=0;")
        .unwrap();
    drop(db);
    let store = Store::open(&path).unwrap();
    assert_eq!(store.intelligence(None, None).unwrap().recurring.len(), 1);
    assert!(store
        .search("bulk", &Default::default(), 10)
        .unwrap()
        .iter()
        .all(|h| h.session.key == "codex:b"));
    std::fs::remove_dir_all(dir).unwrap();
}

fn cli(db: &std::path::Path, args: &[&str]) -> String {
    let output = Command::new(env!("CARGO_BIN_EXE_ronda-cli"))
        .arg("--db")
        .arg(db)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn mcp(db: &std::path::Path, name: &str, arguments: Value) -> String {
    let mut child = Command::new(env!("CARGO_BIN_EXE_ronda-mcp"))
        .arg("--db")
        .arg(db)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    writeln!(child.stdin.take().unwrap(), "{}", json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":name,"arguments":arguments}})).unwrap();
    let output = child.wait_with_output().unwrap();
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["result"]["isError"], Value::Null, "{response}");
    response["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn insights_and_find_error_match_across_cli_and_mcp() {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("ronda-intel-parity-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = library(&dir);
    let insights = cli(&path, &["insights", "--since", "7d"]);
    assert_eq!(
        insights,
        mcp(&path, "ronda_insights", json!({"since":"7d"}))
    );
    assert!(
        insights.contains("Recurring errors")
            && insights.contains("came back after a committed fix"),
        "{insights}"
    );
    assert_eq!(
        cli(&path, &["insights", "--since", "all"]),
        mcp(&path, "ronda_insights", json!({"since":"all"}))
    );
    let found = cli(&path, &["errors", LOCKED]);
    assert_eq!(
        found,
        mcp(&path, "ronda_find_error", json!({"error": LOCKED}))
    );
    assert!(found.starts_with("Seen in 2 sessions"), "{found}");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn project_overview_scopes_every_section_and_keeps_library_on_missing_facts() {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("ronda-overview-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut store = Store::open(&dir.join("overview.db")).unwrap();
    for i in 0..224 {
        let mut item = session(
            AgentId::ClaudeCode,
            &format!("overview-{i}"),
            1000 + i * MIN,
            "Synthetic overview",
            &[("Bash", "test", LOCKED, true)],
        );
        item.meta.project_path = Some(if i == 223 { "/other/repo" } else { "/repo" }.into());
        if i % 2 == 1 {
            item.meta.host = Some("local".into());
        }
        if i == 223 {
            for message in &mut item.messages {
                message.timestamp = None;
                message.tool_calls.clear();
            }
        }
        store.upsert(&item, &format!("fixture-{i}")).unwrap();
    }
    let mut child = session(
        AgentId::Codex,
        "overview-child",
        1000,
        "Synthetic child",
        &[],
    );
    child.meta.parent_key = Some("claude-code:overview-0".into());
    store.upsert(&child, "child-fixture").unwrap();
    let incomplete = store
        .project_overview("/other/repo", None, false, 225 * MIN)
        .unwrap();
    assert_eq!(
        incomplete.intelligence.as_ref().unwrap().coverage[0].with_tools,
        0
    );
    assert_eq!(
        incomplete.intelligence.as_ref().unwrap().coverage[0].with_time,
        0
    );
    store
        .save_bookmark("claude-code:overview-0", 0, "Local decision", false, None)
        .unwrap();
    store
        .save_bookmark("claude-code:overview-1", 0, "Remote decision", false, None)
        .unwrap();
    let all = store
        .project_overview("/repo", None, false, 225 * MIN)
        .unwrap();
    assert_eq!(all.total_sessions, 223);
    assert_eq!(all.sessions.len(), 10);
    assert_eq!(all.total_bookmarks, 2);
    assert!(all
        .sessions
        .windows(2)
        .all(|p| p[0].updated_at >= p[1].updated_at));
    let local = store
        .project_overview("/repo", None, true, 225 * MIN)
        .unwrap();
    assert_eq!(local.total_sessions, 112);
    assert_eq!(local.total_bookmarks, 1);
    assert_eq!(local.bookmarks[0].bookmark.note, "Local decision");
    assert_eq!(local.intelligence.as_ref().unwrap().totals.sessions, 112);
    assert_eq!(local.errors[0].sessions, 112);
    assert!(local.errors[0].evidence.iter().all(|e| store
        .get_session(&e.session_key)
        .unwrap()
        .unwrap()
        .host
        .is_none()));
    let remote = store
        .project_overview("/repo", Some("local"), false, 225 * MIN)
        .unwrap();
    assert_eq!(remote.total_sessions, 111);
    assert_eq!(remote.total_bookmarks, 1);
    assert_eq!(remote.bookmarks[0].bookmark.note, "Remote decision");
    assert_eq!(remote.intelligence.as_ref().unwrap().totals.sessions, 111);
    assert_eq!(remote.errors[0].sessions, 111);
    assert!(remote
        .sessions
        .iter()
        .all(|s| s.host.as_deref() == Some("local")));
    assert_eq!(
        store
            .project_overview("/other/repo", None, false, 225 * MIN)
            .unwrap()
            .total_sessions,
        1
    );
    assert_eq!(
        store
            .project_overview("/missing/repo", None, false, 225 * MIN)
            .unwrap()
            .total_sessions,
        0
    );
    assert!(store.project_overview("", None, false, 225 * MIN).is_err());
    assert!(store
        .project_overview("/repo", Some("local"), true, 225 * MIN)
        .is_err());
    store.tombstone("claude-code:overview-0").unwrap();
    let unavailable = store
        .project_overview("/repo", None, false, 225 * MIN)
        .unwrap();
    assert_eq!(unavailable.total_bookmarks, 2);
    assert!(unavailable
        .bookmarks
        .iter()
        .any(|b| b.status == ronda_core::bookmarks::BookmarkStatus::Unavailable));
    assert_eq!(
        store
            .project_overview("/repo", None, true, 225 * MIN)
            .unwrap()
            .total_bookmarks,
        0
    );
    Connection::open(dir.join("overview.db"))
        .unwrap()
        .execute("DROP TABLE session_facts", [])
        .unwrap();
    let without = store
        .project_overview("/repo", None, true, 225 * MIN)
        .unwrap();
    assert_eq!(without.total_sessions, 111);
    assert!(without.intelligence.is_none());
    assert!(without.intelligence_error.is_some());
    drop(store);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn error_lookup_scopes_before_matching_and_keeps_cli_mcp_parity() {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("ronda-errors-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut store = Store::open(&dir.join("errors.db")).unwrap();
    for i in 0..25 {
        let mut item = session(
            AgentId::ClaudeCode,
            &format!("error-{i}"),
            i * MIN,
            "Scoped errors",
            &[
                ("Bash", "test", LOCKED, true),
                ("Bash", "test", LOCKED, true),
            ],
        );
        if i == 24 {
            item.meta.project_path = Some("/other/repo".into());
        }
        if i % 2 == 1 {
            item.meta.host = Some("local".into());
        }
        store.upsert(&item, &format!("fixture-{i}")).unwrap();
    }
    let first = store.error_history(LOCKED, None, None, false, 0).unwrap();
    let second = store.error_history(LOCKED, None, None, false, 20).unwrap();
    assert_eq!(
        (
            first.total,
            first.hits.len(),
            second.total,
            second.hits.len()
        ),
        (25, 20, 25, 5)
    );
    assert_eq!((first.indexed_sessions, first.with_tools), (25, 25));
    assert_eq!(first.canonical, second.canonical);
    assert!(!first
        .hits
        .iter()
        .any(|a| second.hits.iter().any(|b| a.session.key == b.session.key)));
    assert!(store
        .error_history(LOCKED, None, None, false, usize::MAX)
        .unwrap()
        .hits
        .is_empty());
    let no_tools = session(
        AgentId::Codex,
        "unsupported-tools",
        MIN,
        "No tool recording",
        &[],
    );
    store.upsert(&no_tools, "no-tools-fixture").unwrap();
    let unknown = store
        .error_history("Error: never recorded", None, None, false, 0)
        .unwrap();
    assert_eq!(
        (unknown.indexed_sessions, unknown.with_tools, unknown.total),
        (26, 25, 0)
    );
    assert!(store
        .error_history(&"🙂".repeat(20_000), None, None, false, 0)
        .is_ok());
    let global = store.find_error(LOCKED).unwrap().unwrap();
    assert_eq!(global.1.len(), 25); // repeated events count each session once, beyond a desktop page
    let partial = store
        .find_error_scoped("Error: SQLITE_BUSY", Some("/other/repo"), None, false)
        .unwrap()
        .unwrap();
    assert_eq!(partial.1.len(), 1);
    assert_eq!(partial.1[0].0.session_key, "claude-code:error-24");
    let local = store
        .find_error_scoped(LOCKED, Some("/repo"), None, true)
        .unwrap()
        .unwrap();
    let remote = store
        .find_error_scoped(LOCKED, Some("/repo"), Some("local"), false)
        .unwrap()
        .unwrap();
    assert_eq!((local.1.len(), remote.1.len()), (12, 12));
    assert!(remote.1.iter().all(|(e, _)| store
        .get_session(&e.session_key)
        .unwrap()
        .unwrap()
        .host
        .as_deref()
        == Some("local")));
    assert!(local.1.iter().all(|(e, _)| e.seq == 1));
    assert_eq!(local.1[0].0.session_key, "claude-code:error-22");
    assert_eq!(
        store
            .find_error_scoped(LOCKED, Some("/other/repo"), None, false)
            .unwrap()
            .unwrap()
            .1
            .len(),
        1
    );
    assert!(store
        .find_error_scoped(LOCKED, Some("/missing/repo"), None, false)
        .unwrap()
        .is_none());
    assert!(store
        .find_error_scoped("Error: never recorded", None, None, false)
        .unwrap()
        .is_none());
    assert!(store.find_error_scoped(" ", None, None, false).is_err());
    assert!(store
        .find_error_scoped(&"🙂".repeat(20_001), None, None, false)
        .is_err());
    assert!(store
        .find_error_scoped(LOCKED, None, Some("local"), true)
        .is_err());
    store.tombstone("claude-code:error-22").unwrap();
    assert_eq!(
        store
            .find_error_scoped(LOCKED, Some("/repo"), None, true)
            .unwrap()
            .unwrap()
            .1
            .len(),
        11
    );
}
