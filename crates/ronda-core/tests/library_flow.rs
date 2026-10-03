use ronda_core::{
    scanner::Scanner,
    source_health::{root_id, LocalRefreshHealth, RootStatus, PREF_KEY},
    AgentId, ParsedSession, SessionMeta, SessionQuery, Store,
};
use std::fs;

#[test]
fn scan_search_refresh_and_flags_keep_sources_untouched() {
    let temp = std::env::temp_dir().join(format!(
        "ronda-flow-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let home = temp.join("home");
    let source = home.join(".claude/projects/project/session-1.jsonl");
    fs::create_dir_all(source.parent().unwrap()).unwrap();
    let first = concat!(
        "{\"type\":\"user\",\"cwd\":\"/repo\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"message\":{\"content\":\"你好 useEffect(\"}}\n",
        "{\"type\":\"assistant\",\"timestamp\":\"2026-01-01T00:00:01Z\",\"message\":{\"id\":\"m1\",\"content\":[{\"type\":\"text\",\"text\":\"Done\"}]}}\n"
    );
    fs::write(&source, first).unwrap();
    let database = temp.join("index/ronda.db");
    let mut store = Store::open(&database).unwrap();
    let scanner = Scanner::new(home);
    assert_eq!(scanner.scan(&mut store, true).unwrap().indexed, 1);
    assert_eq!(fs::read_to_string(&source).unwrap(), first);
    let sessions = store.list_sessions(&SessionQuery::default()).unwrap();
    let key = &sessions[0].key;
    let hit = store
        .search("useEffect(", &SessionQuery::default(), 10)
        .unwrap();
    assert!(hit
        .iter()
        .any(|hit| hit.seq == store.get_transcript(key).unwrap()[0].seq));
    assert!(!store
        .search("你好", &SessionQuery::default(), 10)
        .unwrap()
        .is_empty());
    assert!(store
        .search(
            "useEffect(\" OR DROP TABLE sessions --",
            &SessionQuery::default(),
            10
        )
        .unwrap()
        .is_empty());
    store.set_flags(key, true, false).unwrap();
    assert_eq!(scanner.scan(&mut store, false).unwrap().unchanged, 1);
    assert!(store.get_session(key).unwrap().unwrap().starred);
    fs::write(
        &source,
        format!("{first}{{\"type\":\"user\",\"message\":{{\"content\":\"New prompt\"}}}}\n"),
    )
    .unwrap();
    assert_eq!(scanner.scan(&mut store, false).unwrap().indexed, 1);
    assert_eq!(store.get_transcript(key).unwrap().len(), 3);
    assert!(store.get_session(key).unwrap().unwrap().starred);
    store.tombstone(key).unwrap();
    scanner.scan(&mut store, true).unwrap();
    assert!(store.get_session(key).unwrap().is_none());
    drop(store);
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn source_health_tracks_roots_and_missing_indexed_sources_guard_pruning() {
    let temp = std::env::temp_dir().join(format!(
        "ronda-source-health-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let home = temp.join("home");
    let custom = temp.join("custom-root");
    fs::create_dir_all(home.join(".claude/projects")).unwrap();
    let database = temp.join("index/ronda.db");
    let mut store = Store::open(&database).unwrap();
    store
        .upsert(
            &synthetic_session("unrelated", "/gone/not-configured/session.jsonl"),
            "stale",
        )
        .unwrap();
    let scanner = Scanner::new(home);

    // Numerous absent default roots are normal and must not disable unrelated pruning.
    scanner.scan(&mut store, true).unwrap();
    assert!(store.get_session("unrelated").unwrap().is_none());

    store
        .pref_set(
            "custom_roots",
            &serde_json::json!({"claude-code":[custom]}).to_string(),
        )
        .unwrap();
    fs::create_dir_all(&custom).unwrap();
    let source = custom.join("project/session.jsonl");
    let fixture = concat!(
        "{\"type\":\"user\",\"cwd\":\"/repo\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"message\":{\"content\":\"Question\"}}\n",
        "{\"type\":\"assistant\",\"timestamp\":\"2026-01-01T00:00:01Z\",\"message\":{\"id\":\"reply\",\"content\":[{\"type\":\"text\",\"text\":\"Answer\"}]}}\n"
    );
    fs::create_dir_all(source.parent().unwrap()).unwrap();
    fs::write(&source, fixture).unwrap();
    assert_eq!(scanner.scan(&mut store, true).unwrap().indexed, 1);
    let health = LocalRefreshHealth::decode(
        &store.pref_get(PREF_KEY).unwrap().unwrap(),
        chrono::Utc::now().timestamp_millis(),
    )
    .unwrap();
    let stored = store.pref_get(PREF_KEY).unwrap().unwrap();
    assert!(!stored.contains(custom.to_str().unwrap()));
    let root = health
        .roots
        .iter()
        .find(|root| root.id == root_id("claude-code", &custom))
        .unwrap();
    assert_eq!(root.status, RootStatus::Checked);
    assert_eq!(root.source_records, 1);

    drop(store);
    let mut store = Store::open(&database).unwrap();
    let reopened = store.pref_get(PREF_KEY).unwrap().unwrap();
    assert!(LocalRefreshHealth::decode(&reopened, chrono::Utc::now().timestamp_millis()).is_ok());

    store
        .pref_set("disabled_roots", &serde_json::json!([custom]).to_string())
        .unwrap();
    scanner.scan(&mut store, true).unwrap();
    let health = LocalRefreshHealth::decode(
        &store.pref_get(PREF_KEY).unwrap().unwrap(),
        chrono::Utc::now().timestamp_millis(),
    )
    .unwrap();
    assert_eq!(
        health
            .roots
            .iter()
            .find(|root| root.id == root_id("claude-code", &custom))
            .unwrap()
            .status,
        RootStatus::Disabled
    );
    store.pref_set("disabled_roots", "[]").unwrap();
    scanner.scan(&mut store, true).unwrap();

    fs::remove_dir_all(&custom).unwrap();
    store
        .upsert(
            &synthetic_session("unrelated", "/gone/not-configured/session.jsonl"),
            "stale",
        )
        .unwrap();
    scanner.scan(&mut store, true).unwrap();
    assert!(store.get_session("claude-code:session").unwrap().is_some());
    assert!(store.get_session("unrelated").unwrap().is_some());
    let health = LocalRefreshHealth::decode(
        &store.pref_get(PREF_KEY).unwrap().unwrap(),
        chrono::Utc::now().timestamp_millis(),
    )
    .unwrap();
    assert_eq!(
        health
            .roots
            .iter()
            .find(|root| root.id == root_id("claude-code", &custom))
            .unwrap()
            .status,
        RootStatus::Unavailable
    );

    fs::create_dir_all(source.parent().unwrap()).unwrap();
    fs::write(&source, fixture).unwrap();
    scanner.scan(&mut store, true).unwrap();
    assert!(store.get_session("claude-code:session").unwrap().is_some());
    assert!(store.get_session("unrelated").unwrap().is_none());
    drop(store);
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn source_health_marks_reported_discovery_errors_as_partial() {
    let temp = std::env::temp_dir().join(format!(
        "ronda-source-health-error-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let home = temp.join("home");
    let broken_db = temp.join("copilot/session-store.db");
    fs::create_dir_all(broken_db.parent().unwrap()).unwrap();
    rusqlite::Connection::open(&broken_db)
        .unwrap()
        .execute_batch("CREATE TABLE sessions (not_the_id TEXT);")
        .unwrap();
    let mut store = Store::open(&temp.join("index/ronda.db")).unwrap();
    store
        .pref_set(
            "custom_roots",
            &serde_json::json!({"copilot":[broken_db]}).to_string(),
        )
        .unwrap();
    let report = Scanner::new(home).scan(&mut store, true).unwrap();
    assert_eq!(report.errors.len(), 1);
    let health = LocalRefreshHealth::decode(
        &store.pref_get(PREF_KEY).unwrap().unwrap(),
        chrono::Utc::now().timestamp_millis(),
    )
    .unwrap();
    let stored = store.pref_get(PREF_KEY).unwrap().unwrap();
    assert!(!stored.contains(broken_db.to_str().unwrap()));
    assert!(!stored.contains("unable to open database file"));
    let root = health
        .roots
        .iter()
        .find(|root| root.id == root_id("copilot", &broken_db))
        .unwrap();
    assert_eq!(root.status, RootStatus::Partial);
    assert_eq!(root.issues, 1);
    assert_eq!(root.source_records, 0);
    drop(store);
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn source_health_retains_sessions_owned_by_a_missing_database_file_root() {
    let temp = std::env::temp_dir().join(format!(
        "ronda-source-health-file-root-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let home = temp.join("home");
    let root = temp.join("copilot/session-store.db");
    let mut store = Store::open(&temp.join("index/ronda.db")).unwrap();
    store
        .pref_set(
            "custom_roots",
            &serde_json::json!({"copilot":[root]}).to_string(),
        )
        .unwrap();
    let mut indexed = synthetic_session("copilot:owned", root.to_str().unwrap());
    indexed.meta.agent = AgentId::Copilot;
    store
        .upsert(&indexed, "copilot-source-fingerprint")
        .unwrap();

    let scanner = Scanner::new(home);
    scanner.scan(&mut store, true).unwrap();
    assert!(store.get_session("copilot:owned").unwrap().is_some());
    let health = LocalRefreshHealth::decode(
        &store.pref_get(PREF_KEY).unwrap().unwrap(),
        chrono::Utc::now().timestamp_millis(),
    )
    .unwrap();
    let root_health = health
        .roots
        .iter()
        .find(|item| item.id == root_id("copilot", &root))
        .unwrap();
    assert_eq!(root_health.status, RootStatus::Unavailable);
    assert_eq!(root_health.source_records, 0);
    drop(store);
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn remote_host_scans_do_not_read_or_write_local_source_health() {
    let temp = std::env::temp_dir().join(format!(
        "ronda-source-health-remote-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut store = Store::open(&temp.join("index/ronda.db")).unwrap();
    store.pref_set(PREF_KEY, "local-snapshot-sentinel").unwrap();
    Scanner::new(temp.join("home"))
        .scan_host(&mut store, &temp.join("home"), Some("buildbox"), true)
        .unwrap();
    assert_eq!(
        store.pref_get(PREF_KEY).unwrap().as_deref(),
        Some("local-snapshot-sentinel")
    );
    drop(store);
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn source_health_counts_duplicate_source_refs_before_session_grouping() {
    let temp = std::env::temp_dir().join(format!(
        "ronda-source-health-duplicates-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let home = temp.join("home");
    let roots = [temp.join("root-a"), temp.join("root-b")];
    let fixture = concat!(
        "{\"type\":\"user\",\"cwd\":\"/repo\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"message\":{\"content\":\"Question\"}}\n",
        "{\"type\":\"assistant\",\"timestamp\":\"2026-01-01T00:00:01Z\",\"message\":{\"id\":\"reply\",\"content\":[{\"type\":\"text\",\"text\":\"Answer\"}]}}\n"
    );
    for root in &roots {
        let source = root.join("project/shared.jsonl");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(source, fixture).unwrap();
    }
    let mut store = Store::open(&temp.join("index/ronda.db")).unwrap();
    store
        .pref_set(
            "custom_roots",
            &serde_json::json!({"claude-code":roots}).to_string(),
        )
        .unwrap();
    let report = Scanner::new(home).scan(&mut store, true).unwrap();
    assert_eq!(report.discovered, 2);
    assert_eq!(report.indexed, 1);
    let health = LocalRefreshHealth::decode(
        &store.pref_get(PREF_KEY).unwrap().unwrap(),
        chrono::Utc::now().timestamp_millis(),
    )
    .unwrap();
    for root in roots {
        let id = root_id("claude-code", &root);
        let status = health.roots.iter().find(|status| status.id == id).unwrap();
        assert_eq!(status.source_records, 1);
        assert_eq!(status.status, RootStatus::Checked);
    }
    drop(store);
    fs::remove_dir_all(temp).unwrap();
}

fn synthetic_session(key: &str, source_path: &str) -> ParsedSession {
    ParsedSession {
        meta: SessionMeta {
            key: key.into(),
            native_id: key.into(),
            agent: AgentId::ClaudeCode,
            host: None,
            parent_key: None,
            title: key.into(),
            project_path: None,
            source_path: source_path.into(),
            created_at: 0,
            updated_at: 1,
            model: None,
            source: None,
            tokens: None,
            archived: false,
            metadata_only: false,
            can_delete: false,
            starred: false,
            pinned: false,
        },
        messages: Vec::new(),
    }
}
