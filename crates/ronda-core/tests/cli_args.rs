use serde_json::{json, Value};
use std::{
    io::Write,
    process::{Command, Output, Stdio},
};

fn db() -> std::path::PathBuf {
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("ronda-args-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("ronda.db");
    drop(ronda_core::Store::open(&path).unwrap());
    path
}

fn cli(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_ronda-cli"))
        .arg("--db")
        .arg(db())
        .args(args)
        .output()
        .unwrap()
}

fn mcp(name: &str, arguments: Value) -> Value {
    let mut child = Command::new(env!("CARGO_BIN_EXE_ronda-mcp"))
        .arg("--db")
        .arg(db())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    writeln!(child.stdin.take().unwrap(), "{}", json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":name,"arguments":arguments}})).unwrap();
    let output = child.wait_with_output().unwrap();
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn errors_rejects_unknown_options() {
    let out = cli(&["errors", "--project", "/x", "boom"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("unknown option"));
}

#[test]
fn errors_double_dash_ends_options() {
    let out = cli(&["errors", "--", "--weird", "flag"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn show_rejects_negative_from() {
    let out = cli(&["show", "k", "--from", "-1"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("nonnegative integer"));
}

#[test]
fn mcp_get_session_rejects_bad_key_and_from_seq() {
    for args in [
        json!({}),
        json!({"key":"  "}),
        json!({"key":"k","from_seq":-1}),
    ] {
        let r = mcp("ronda_get_session", args.clone());
        assert_eq!(r["error"]["code"], -32602, "{args} -> {r}");
    }
}
