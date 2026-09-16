//! Turns failing command output into a stable signature, so the same bug groups together across sessions and agents.
use regex::Regex;
use std::sync::LazyLock;

static ANSI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x1b\[[0-9;]*[A-Za-z]").unwrap());
// Lines shaped like an error report, not prose that happens to say "error".
static ERROR_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?ix)
        ^[\w.$]*(error|exception|exit)(\[\w+\])?:\s     # TypeError: ..., error[E0425]: ..., java.io.IOException: ...
        | \berror(\[\w+\])?:\s | \berror\s+TS\d+:        # path: error: ..., error TS2304:
        | ^(fatal|panic|FAIL|FAILED|ERR!?)\b[:!\s] | panicked\sat
        | \bsegmentation\sfault | command\snot\sfound
        | cannot\sfind\smodule | module\snot\sfound | is\snot\sa\sfunction | has\sno\sattribute
        | database\sis\slocked | address\salready\sin\suse | permission\sdenied
    ").unwrap()
});
// A Python traceback names the exception on its last line.
static EXCEPTION_LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[\w.]*(Error|Exception|Interrupt|Exit)\b(:|$)").unwrap());
// Harness chatter printed around a command's real output.
static NOISE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(\(eval\):|(cat|sed|u?grep|rg|ls|cd|head|tail|find|wc|stat|du|diff|mkdir|rm|cp|mv|open|file):\s|<tool_use_error>|exit code|process exited|wall time|output:|chunk id|original token count|command:|script (completed|failed|running)|warning: truncated|\d+ (passed|failed)|test result:|error: process didn't exit successfully|error: could not compile|error: aborting due to|error: script .* exited|npm err! (code|path|errno|a complete log)|\s*at\s|make: \*\*\*|elifecycle|error: command failed with exit code)").unwrap()
});
static PATH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:[A-Za-z]:)?(?:[\w.@~+-]*[/\\])+([\w.@+-]+)").unwrap());
static LOCATION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r":\d+(?::\d+)?").unwrap());
static UUID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b").unwrap()
});
static HEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b0x[0-9a-f]+\b|\b[0-9a-f]{12,}\b").unwrap());
static NUMBER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d+").unwrap());
// Quoted text with spaces is usually a value; a short quoted name (a module, a symbol) identifies the bug, so it stays.
static LONG_QUOTE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#""[^"]*\s[^"]*"|'[^']*\s[^']*'|`[^`]*\s[^`]*`"#).unwrap());
static SPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

#[derive(Debug, Clone, PartialEq)]
pub struct ErrorLine {
    pub signature: String,
    pub message: String,
}

/// Picks the first line that reads like an error, skipping harness chatter, and returns it with its signature.
pub fn extract(output: &str) -> Option<ErrorLine> {
    let clean = ANSI.replace_all(output, "");
    let lines: Vec<&str> = clean
        .lines()
        .map(str::trim)
        .filter(|l| l.len() >= 6 && !NOISE.is_match(l))
        .collect();
    let line = match lines
        .iter()
        .position(|l| l.starts_with("Traceback (most recent call last)"))
    {
        Some(start) => *lines[start..]
            .iter()
            .rev()
            .find(|l| EXCEPTION_LINE.is_match(l))?,
        None => *lines.iter().find(|l| ERROR_LINE.is_match(l))?,
    };
    let message: String = line.chars().take(200).collect();
    Some(ErrorLine {
        signature: signature(&message),
        message,
    })
}

pub fn normalize(line: &str) -> String {
    let s = ANSI.replace_all(line, "");
    let s = PATH.replace_all(&s, "$1");
    let s = LOCATION.replace_all(&s, "");
    let s = UUID.replace_all(&s, "#");
    let s = HEX.replace_all(&s, "#");
    let s = LONG_QUOTE.replace_all(&s, "…");
    let s = NUMBER.replace_all(&s, "#");
    let s = SPACE.replace_all(s.trim(), " ");
    s.to_lowercase().chars().take(160).collect()
}

/// FNV-1a over the normalized line: stable across runs and platforms.
pub fn signature(line: &str) -> String {
    let hash = normalize(line).bytes().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ b as u64).wrapping_mul(0x100000001b3)
    });
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variants_of_one_bug_share_a_signature() {
        let a = extract("Exit code 1\nerror[E0425]: cannot find value `store` in this scope\n --> /Users/a/repo/src/lib.rs:12:5").unwrap();
        let b = extract("Process exited with code 101\nOutput:\nerror[E0425]: cannot find value `store` in this scope\n --> C:\\work\\repo\\src\\lib.rs:80:9").unwrap();
        assert_eq!(a.signature, b.signature);
        assert_eq!(
            a.message,
            "error[E0425]: cannot find value `store` in this scope"
        );
        let other = extract("error[E0425]: cannot find value `config` in this scope").unwrap();
        assert_ne!(a.signature, other.signature);
    }

    #[test]
    fn paths_lines_and_numbers_collapse() {
        assert_eq!(
            signature("TypeError: Cannot read properties of undefined (reading 'id') at /app/src/user.ts:41:7"),
            signature("TypeError: Cannot read properties of undefined (reading 'id') at /home/ci/app/src/user.ts:88:13")
        );
        assert_eq!(
            signature("database is locked after 5000ms (0x1f)"),
            signature("database is locked after 250ms (0xff)")
        );
    }

    #[test]
    fn tracebacks_use_their_exception() {
        let output = "Traceback (most recent call last):\n  File \"/app/main.py\", line 3, in <module>\n    import requests\nModuleNotFoundError: No module named 'requests'";
        assert_eq!(
            extract(output).unwrap().message,
            "ModuleNotFoundError: No module named 'requests'"
        );
    }

    #[test]
    fn prose_and_harness_errors_are_not_bugs() {
        assert!(extract(
            "The only exception is the welcome pull request below, which nothing else records."
        )
        .is_none());
        assert!(extract("(eval):1: == not found").is_none());
        // An agent mistyping a path while exploring is not a bug in the project.
        assert!(extract("(eval):cd:1: no such file or directory: apps/web\ncat: package.json: No such file or directory").is_none());
        assert!(extract(
            "<tool_use_error>InputValidationError: [ { path: 'x' } ]</tool_use_error>"
        )
        .is_none());
        assert_eq!(
            extract("src/app.ts(4,10): error TS2304: Cannot find name 'foo'.")
                .unwrap()
                .message,
            "src/app.ts(4,10): error TS2304: Cannot find name 'foo'."
        );
        assert!(
            extract("fatal: not a git repository (or any of the parent directories): .git")
                .is_some()
        );
    }

    #[test]
    fn skips_noise_and_success() {
        assert!(
            extract("Wall time: 2 seconds\nProcess exited with code 0\nOutput:\nall good")
                .is_none()
        );
        assert_eq!(
            extract("npm ERR! code ELIFECYCLE\nError: Cannot find module 'vite'")
                .unwrap()
                .message,
            "Error: Cannot find module 'vite'"
        );
    }
}
