use ronda_core::{scanner::Scanner, SessionQuery, Store};
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
    let mut store = Store::open(&temp.join("index/ronda.db")).unwrap();
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
    fs::remove_dir_all(temp).unwrap();
}
