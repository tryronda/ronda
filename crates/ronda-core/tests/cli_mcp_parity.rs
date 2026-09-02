use ronda_core::{
    AgentId, MessageKind, ParsedSession, Role, SessionMeta, Store, TranscriptMessage,
};
use serde_json::{json, Value};
use std::{
    io::Write,
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

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
    assert!(output.status.success());
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["result"]["isError"], Value::Null);
    response["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn four_query_surfaces_have_identical_cli_and_mcp_text() {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("ronda-parity-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("ronda.db");
    let mut db = Store::open(&db_path).unwrap();
    let meta = SessionMeta {
        key: "codex:parity".into(),
        native_id: "parity".into(),
        agent: AgentId::Codex,
        host: None,
        parent_key: None,
        title: "Parity test".into(),
        project_path: Some("/tmp/ronda-parity-project".into()),
        source_path: dir.join("missing.jsonl").to_string_lossy().into_owned(),
        created_at: 1_760_000_000_000,
        updated_at: 1_760_000_001_000,
        model: Some("test-model".into()),
        source: None,
        tokens: None,
        archived: false,
        metadata_only: false,
        can_delete: false,
        starred: false,
        pinned: false,
    };
    let msg = TranscriptMessage {
        seq: 0,
        role: Role::User,
        kind: MessageKind::Text,
        text: "unique parity needle".into(),
        timestamp: None,
        model: None,
        thinking: None,
        tool_calls: Vec::new(),
        images: Vec::new(),
    };
    let mut child = meta.clone();
    child.key = "codex:parity:agent-1".into();
    child.native_id = "parity:agent-1".into();
    child.parent_key = Some(meta.key.clone());
    child.title = "Child task".into();
    db.upsert(
        &ParsedSession {
            meta,
            messages: vec![msg],
        },
        "fixture",
    )
    .unwrap();
    db.upsert(
        &ParsedSession {
            meta: child,
            messages: vec![
                TranscriptMessage {
                    seq: 0,
                    role: Role::User,
                    kind: MessageKind::Text,
                    text: "child first".into(),
                    timestamp: None,
                    model: None,
                    thinking: None,
                    tool_calls: Vec::new(),
                    images: Vec::new(),
                },
                TranscriptMessage {
                    seq: 1,
                    role: Role::Assistant,
                    kind: MessageKind::Text,
                    text: "child second".into(),
                    timestamp: None,
                    model: None,
                    thinking: None,
                    tool_calls: Vec::new(),
                    images: Vec::new(),
                },
            ],
        },
        "child",
    )
    .unwrap();
    drop(db);

    assert_eq!(
        cli(&db_path, &["search", "needle"]),
        mcp(&db_path, "ronda_search", json!({"query":"needle"}))
    );
    assert_eq!(
        cli(&db_path, &["sessions"]),
        mcp(&db_path, "ronda_list_sessions", json!({}))
    );
    assert_eq!(
        cli(&db_path, &["show", "codex:parity"]),
        mcp(&db_path, "ronda_get_session", json!({"key":"codex:parity"}))
    );
    assert!(
        cli(&db_path, &["show", "codex:parity"]).contains("ronda://session/codex:parity:agent-1#0")
    );
    assert_eq!(
        cli(&db_path, &["show", "codex:parity", "--subagent", "*"]),
        mcp(
            &db_path,
            "ronda_get_session",
            json!({"key":"codex:parity","subagent":"*"})
        )
    );
    let selected = cli(
        &db_path,
        &[
            "show",
            "codex:parity",
            "--subagent",
            "agent-1",
            "--from",
            "1",
            "--messages",
            "1",
        ],
    );
    assert_eq!(
        selected,
        mcp(
            &db_path,
            "ronda_get_session",
            json!({"key":"codex:parity","subagent":"agent-1","from_seq":1,"max_messages":1})
        )
    );
    assert!(selected.contains("[seq 1] Assistant"));
    assert!(!selected.contains("[seq 0] User"));
    assert_eq!(
        cli(&db_path, &["projects"]),
        mcp(&db_path, "ronda_list_projects", json!({}))
    );
    std::fs::remove_dir_all(dir).unwrap();
}
