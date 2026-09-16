//! Normalizes each agent's tool calls into shell, edit, read, search, and web events with the commands and paths they carry.
use crate::ToolCall;
use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolKind {
    Shell,
    Edit,
    Read,
    Search,
    Web,
    Other,
}

impl ToolKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shell => "shell",
            Self::Edit => "edit",
            Self::Read => "read",
            Self::Search => "search",
            Self::Web => "web",
            Self::Other => "other",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolEvent {
    pub seq: i64,
    pub kind: ToolKind,
    pub command: Option<String>,
    pub path: Option<String>,
    pub is_error: bool,
    pub exit_code: Option<i32>,
}

static EXIT_CODE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:Exit code:?|Process exited with code|exit status:?)\s+(-?\d+)\s*$")
        .unwrap()
});
// Codex runs commands and patches from small scripts: `tools.exec_command({cmd: "..."})`.
static SCRIPT_CMD: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"exec_command\(\s*\{\s*"?cmd"?\s*:\s*("(?:[^"\\]|\\.)*")"#).unwrap()
});
static PATCH_FILE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\*\*\* (?:Update|Add|Delete) File: ([^\n\\]+)").unwrap());

/// Reads the exit code a shell tool printed, as Claude Code (`Exit code 1`) and Codex (`Process exited with code 1`) do.
/// With several commands in one call, a failing code wins.
pub fn exit_code(output: &str) -> Option<i32> {
    let codes: Vec<i32> = EXIT_CODE
        .captures_iter(output)
        .filter_map(|c| c[1].parse().ok())
        .collect();
    codes
        .iter()
        .copied()
        .find(|c| *c != 0)
        .or(codes.first().copied())
}

fn kind(name: &str) -> ToolKind {
    let n = name.to_ascii_lowercase();
    let n = n.rsplit("__").next().unwrap_or(&n);
    match n {
        "bash" | "shell" | "exec" | "exec_command" | "shell_command" | "local_shell"
        | "run_terminal_cmd" | "run_command" | "run_shell_command" | "execute_command"
        | "terminal" | "powershell" => ToolKind::Shell,
        "edit" | "write" | "multiedit" | "apply_patch" | "str_replace" | "str_replace_editor"
        | "create_file" | "write_file" | "edit_file" | "replace" | "search_replace"
        | "notebookedit" | "fs_write" => ToolKind::Edit,
        "read" | "read_file" | "view" | "cat" | "fs_read" | "read_many_files" => ToolKind::Read,
        "grep" | "glob" | "ls" | "list_dir" | "codebase_search" | "file_search" | "grep_search"
        | "search" | "find" => ToolKind::Search,
        "webfetch" | "websearch" | "web_search" | "fetch" | "web_fetch" => ToolKind::Web,
        _ => ToolKind::Other,
    }
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| match &value[key] {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_owned()),
        Value::Array(parts) if !parts.is_empty() => {
            let words: Vec<&str> = parts.iter().filter_map(Value::as_str).collect();
            // `["bash", "-lc", "cargo test"]` carries the command in its last part.
            match words.as_slice() {
                [shell, flag, command] if shell.ends_with("sh") && flag.starts_with('-') => {
                    Some((*command).to_owned())
                }
                _ if !words.is_empty() => Some(words.join(" ")),
                _ => None,
            }
        }
        _ => None,
    })
}

/// Splits one tool call into events: one per command and per file it names, or a single bare event.
pub fn events(seq: i64, call: &ToolCall) -> Vec<ToolEvent> {
    let mut kind = kind(&call.name);
    let input = call.input.as_deref().unwrap_or("");
    let json: Value = serde_json::from_str(input).unwrap_or(Value::Null);
    let mut commands = Vec::new();
    let mut paths = Vec::new();
    if let Some(command) = string_field(&json, &["command", "cmd", "commandLine", "script"]) {
        commands.push(command);
    }
    if let Some(path) = string_field(
        &json,
        &[
            "file_path",
            "filePath",
            "path",
            "target_file",
            "notebook_path",
            "absolute_path",
        ],
    ) {
        paths.push(path);
    }
    for capture in SCRIPT_CMD.captures_iter(input) {
        if let Ok(command) = serde_json::from_str::<String>(&capture[1]) {
            commands.push(command);
        }
    }
    let patch = json.as_str().unwrap_or(input);
    for capture in PATCH_FILE.captures_iter(patch) {
        paths.push(capture[1].trim().to_owned());
        if kind == ToolKind::Other || (kind == ToolKind::Shell && commands.is_empty()) {
            kind = ToolKind::Edit;
        }
    }
    if kind == ToolKind::Other && !commands.is_empty() {
        kind = ToolKind::Shell;
    }
    let output = call.output.as_deref().unwrap_or("");
    let exit_code = exit_code(output);
    let is_error = call.is_error || exit_code.is_some_and(|c| c != 0);
    let event = |command: Option<String>, path: Option<String>| ToolEvent {
        seq,
        kind,
        command,
        path,
        is_error,
        exit_code,
    };
    let mut out: Vec<ToolEvent> = commands.into_iter().map(|c| event(Some(c), None)).collect();
    out.extend(paths.into_iter().map(|p| event(None, Some(p))));
    if out.is_empty() {
        out.push(event(None, None));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(name: &str, input: &str, output: &str, is_error: bool) -> ToolCall {
        ToolCall {
            id: "1".into(),
            name: name.into(),
            input: Some(input.into()),
            output: Some(output.into()),
            is_error,
        }
    }

    #[test]
    fn claude_bash_and_edit() {
        let bash = events(
            3,
            &call(
                "Bash",
                r#"{"command":"cargo test"}"#,
                "Exit code 101\nerror",
                true,
            ),
        );
        assert_eq!(
            (
                bash[0].kind,
                bash[0].command.as_deref(),
                bash[0].exit_code,
                bash[0].is_error
            ),
            (ToolKind::Shell, Some("cargo test"), Some(101), true)
        );
        let edit = events(
            4,
            &call(
                "Edit",
                r#"{"file_path":"/repo/src/a.rs","old_string":"x"}"#,
                "ok",
                false,
            ),
        );
        assert_eq!(
            (edit[0].kind, edit[0].path.as_deref()),
            (ToolKind::Edit, Some("/repo/src/a.rs"))
        );
    }

    #[test]
    fn codex_exec_command_and_script() {
        let direct = events(
            1,
            &call(
                "exec_command",
                r#"{"cmd":"bun test"}"#,
                "Wall time: 1 seconds\nProcess exited with code 1\nOutput:\nfail",
                false,
            ),
        );
        assert_eq!(
            (direct[0].command.as_deref(), direct[0].is_error),
            (Some("bun test"), true)
        );
        let script = events(2, &call("exec", "const r = await Promise.all([tools.exec_command({cmd: \"git status\"}), tools.exec_command({\"cmd\": \"cargo build\"})]);", "Script completed\nProcess exited with code 0\nProcess exited with code 0", false));
        let commands: Vec<_> = script.iter().filter_map(|e| e.command.as_deref()).collect();
        assert_eq!(commands, ["git status", "cargo build"]);
        assert!(!script[0].is_error);
    }

    #[test]
    fn codex_apply_patch_names_files() {
        let patch = events(5, &call("apply_patch", "*** Begin Patch\n*** Update File: /repo/src/main.ts\n@@\n*** Add File: /repo/src/new.ts\n*** End Patch", "Success. Updated the following files:", false));
        assert!(patch.iter().all(|e| e.kind == ToolKind::Edit));
        assert_eq!(
            patch
                .iter()
                .filter_map(|e| e.path.as_deref())
                .collect::<Vec<_>>(),
            ["/repo/src/main.ts", "/repo/src/new.ts"]
        );
    }

    #[test]
    fn shell_arrays_and_mcp_names() {
        let shell = events(
            1,
            &call(
                "shell",
                r#"{"command":["bash","-lc","pytest -q"]}"#,
                "",
                false,
            ),
        );
        assert_eq!(shell[0].command.as_deref(), Some("pytest -q"));
        assert_eq!(
            events(
                1,
                &call("mcp__fs__read_file", r#"{"path":"a.py"}"#, "", false)
            )[0]
            .kind,
            ToolKind::Read
        );
    }
}
