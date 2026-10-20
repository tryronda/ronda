use ronda_core::Store;
use std::process::{Command, Output};

fn db() -> std::path::PathBuf {
    // Parallel tests share a process id and can read the same clock tick, so add a counter.
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("ronda-usage-{}-{t}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("ronda.db");
    Store::open(&path).unwrap();
    path
}

fn cli(db: &std::path::Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_ronda-cli"))
        .arg("--db")
        .arg(db)
        .args(args)
        .output()
        .unwrap()
}

fn stderr(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).into_owned()
}

#[test]
fn clamped_limits_note_stderr_and_keep_stdout() {
    let db = db();
    for (args, in_range, note) in [
        (
            vec!["sessions", "--limit", "500"],
            vec!["sessions", "--limit", "100"],
            "ronda-cli: --limit 500 clamped to 100\n",
        ),
        (
            vec!["search", "needle", "--limit", "99"],
            vec!["search", "needle", "--limit", "30"],
            "ronda-cli: --limit 99 clamped to 30\n",
        ),
        (
            vec!["projects", "--limit", "0"],
            vec!["projects", "--limit", "1"],
            "ronda-cli: --limit 0 clamped to 1\n",
        ),
    ] {
        let a = cli(&db, &args);
        let b = cli(&db, &in_range);
        assert!(a.status.success() && b.status.success());
        assert_eq!(a.stdout, b.stdout);
        assert_eq!(stderr(&a), note);
        assert_eq!(stderr(&b), "");
    }
}

#[test]
fn show_size_options_note_when_clamped() {
    let db = db();
    let o = cli(
        &db,
        &[
            "show",
            "missing",
            "--messages",
            "999",
            "--chars",
            "5",
            "--message-chars",
            "60000",
        ],
    );
    let err = stderr(&o);
    assert!(err.contains("ronda-cli: --messages 999 clamped to 200\n"));
    assert!(err.contains("ronda-cli: --chars 5 clamped to 200\n"));
    assert!(err.contains("ronda-cli: --message-chars 60000 clamped to 50000\n"));
}

#[test]
fn unknown_agent_exits_2_and_lists_valid_ids() {
    let db = db();
    for cmd in [vec!["sessions"], vec!["search", "x"]] {
        let mut args = cmd.clone();
        args.extend(["--agent", "bogus"]);
        let o = cli(&db, &args);
        assert_eq!(o.status.code(), Some(2));
        let err = stderr(&o);
        assert!(err.contains("unknown agent: bogus"), "{err}");
        assert!(
            err.contains("claude-code") && err.contains("codex"),
            "{err}"
        );
    }
}

#[test]
fn agent_alias_still_works() {
    let db = db();
    let o = cli(&db, &["sessions", "--agent", "claude"]);
    assert!(o.status.success(), "{}", stderr(&o));
}

#[test]
fn help_flags_after_double_dash_are_search_text() {
    let db = db();
    let o = cli(&db, &["search", "--", "--help"]);
    assert!(o.status.success(), "{}", stderr(&o));
    let out = String::from_utf8_lossy(&o.stdout);
    assert!(out.contains("0 sessions match `--help`"), "{out}");
    let o = cli(&db, &["search", "--", "-V"]);
    assert!(String::from_utf8_lossy(&o.stdout).contains("match `-V`"));
    let o = cli(&db, &["search", "x", "--help"]);
    assert!(String::from_utf8_lossy(&o.stdout).starts_with("ronda-cli search"));
}

#[test]
fn bare_duration_exits_2_with_clear_message() {
    let db = db();
    for bad in ["d", "w"] {
        let o = cli(&db, &["sessions", "--since", bad]);
        assert_eq!(o.status.code(), Some(2));
        assert!(
            stderr(&o).contains(&format!("invalid since value: {bad}")),
            "{}",
            stderr(&o)
        );
    }
}
