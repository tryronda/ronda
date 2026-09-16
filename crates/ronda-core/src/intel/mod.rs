//! Session intelligence: facts derived from each transcript when it is indexed, so reports never re-read transcripts.
//! Everything here is deterministic and local; each fact keeps the message it came from.
pub mod errors;
pub mod patterns;
pub mod report;
pub mod stack;
pub mod tools;

use crate::{MessageKind, Role, SessionMeta, TranscriptMessage};
use patterns::{Pattern, TEST_COMMAND};
use regex::Regex;
use std::collections::BTreeMap;
use std::sync::LazyLock;
use tools::{ToolEvent, ToolKind};

/// Gaps longer than this count as time away, not time working.
pub const IDLE_GAP_MS: i64 = 15 * 60 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Category {
    Features,
    Bugs,
    Refactoring,
    Tests,
    Setup,
    Exploring,
}

impl Category {
    pub const ALL: [Self; 6] = [
        Self::Features,
        Self::Bugs,
        Self::Refactoring,
        Self::Tests,
        Self::Setup,
        Self::Exploring,
    ];
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Features => "features",
            Self::Bugs => "bugs",
            Self::Refactoring => "refactoring",
            Self::Tests => "tests",
            Self::Setup => "setup",
            Self::Exploring => "exploring",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|c| c.as_str() == s)
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::Features => "Building features",
            Self::Bugs => "Fixing bugs",
            Self::Refactoring => "Refactoring",
            Self::Tests => "Writing tests",
            Self::Setup => "Setup and config",
            Self::Exploring => "Exploring and questions",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Outcome {
    Committed,
    Uncommitted,
    Failed,
    NoChanges,
}

impl Outcome {
    pub const ALL: [Self; 4] = [
        Self::Committed,
        Self::Uncommitted,
        Self::Failed,
        Self::NoChanges,
    ];
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Committed => "committed",
            Self::Uncommitted => "uncommitted",
            Self::Failed => "failed",
            Self::NoChanges => "no_changes",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|o| o.as_str() == s)
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::Committed => "committed",
            Self::Uncommitted => "edited, not committed",
            Self::Failed => "ended failing",
            Self::NoChanges => "no file changes",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionFacts {
    pub started_at: i64,
    pub ended_at: i64,
    pub active_ms: i64,
    pub recovery_ms: i64,
    pub prompts: i64,
    pub tool_calls: i64,
    pub tool_errors: i64,
    pub category: Category,
    pub outcome: Outcome,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ErrorEvent {
    pub seq: i64,
    pub signature: String,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct Derived {
    pub facts: SessionFacts,
    pub tools: Vec<ToolEvent>,
    pub errors: Vec<ErrorEvent>,
    pub failures: Vec<(Pattern, i64)>,
    pub stack: BTreeMap<String, u32>,
}

static BUG_WORDS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(fix|fixes|bug|bugs|broken|breaks|error|errors|failing|fails|failed|crash|crashes|debug|regression|not working|doesn't work|isn't working|stack trace|exception)\b").unwrap()
});
static REFACTOR_WORDS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(refactor|refactoring|rename|clean ?up|simplify|restructure|reorganize|dedupe|extract .* into|split .* into)\b").unwrap()
});
static TEST_WORDS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(add|write|cover|increase)\b.{0,30}\b(tests?|coverage|specs?)\b").unwrap()
});
static SETUP_WORDS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(set ?up|install|configure|config|upgrade|bump|dependenc(y|ies)|ci|deploy|docker|lint(er|ing)?)\b").unwrap()
});
static TEST_PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(^|[/\\._-])(tests?|specs?|__tests__|e2e)([/\\._-]|$)").unwrap()
});
static CONFIG_PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(\.(json|ya?ml|toml|lock|ini|env|cfg|conf)$|dockerfile|makefile|\.github[/\\]|\.gitignore$|\.config\.[cm]?[jt]s$|^[^/\\]*rc$)").unwrap()
});
static COMMIT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\bgit\s+(-C\s+\S+\s+)?(commit|push)\b|\bgh\s+pr\s+(create|merge)\b").unwrap()
});

fn first_prompt(messages: &[TranscriptMessage]) -> String {
    messages
        .iter()
        .find(|m| {
            matches!(m.role, Role::User)
                && matches!(m.kind, MessageKind::Text)
                && !m.text.trim().is_empty()
        })
        .map(|m| m.text.chars().take(600).collect())
        .unwrap_or_default()
}

fn category(prompt: &str, tools: &[ToolEvent], early_errors: bool) -> Category {
    let edited: Vec<&str> = tools
        .iter()
        .filter(|e| e.kind == ToolKind::Edit)
        .filter_map(|e| e.path.as_deref())
        .collect();
    let file_name = |p: &str| p.rsplit(['/', '\\']).next().unwrap_or(p).to_owned();
    if BUG_WORDS.is_match(prompt) {
        return Category::Bugs;
    }
    if REFACTOR_WORDS.is_match(prompt) {
        return Category::Refactoring;
    }
    if TEST_WORDS.is_match(prompt)
        || (!edited.is_empty() && edited.iter().all(|p| TEST_PATH.is_match(p)))
    {
        return Category::Tests;
    }
    if !edited.is_empty()
        && edited
            .iter()
            .all(|p| CONFIG_PATH.is_match(p) || CONFIG_PATH.is_match(&file_name(p)))
    {
        return Category::Setup;
    }
    if edited.is_empty() {
        return if early_errors {
            Category::Bugs
        } else if SETUP_WORDS.is_match(prompt) && tools.iter().any(|e| e.kind == ToolKind::Shell) {
            Category::Setup
        } else {
            Category::Exploring
        };
    }
    if early_errors {
        return Category::Bugs;
    }
    Category::Features
}

fn outcome(tools: &[ToolEvent], failures: &[(Pattern, i64)]) -> Outcome {
    let committed = tools.iter().any(|e| {
        e.kind == ToolKind::Shell
            && !e.is_error
            && e.command.as_deref().is_some_and(|c| COMMIT.is_match(c))
    });
    if committed {
        return Outcome::Committed;
    }
    let edited = tools
        .iter()
        .any(|e| e.kind == ToolKind::Edit && !e.is_error);
    let last_shell = tools.iter().rev().find(|e| e.kind == ToolKind::Shell);
    let tests_failing = failures
        .iter()
        .any(|(p, _)| *p == Pattern::TestsFailingAtEnd);
    if tests_failing || last_shell.is_some_and(|e| e.is_error) {
        return Outcome::Failed;
    }
    if edited {
        Outcome::Uncommitted
    } else {
        Outcome::NoChanges
    }
}

pub fn derive(meta: &SessionMeta, messages: &[TranscriptMessage]) -> Derived {
    let mut tool_events = Vec::new();
    let mut errors = Vec::new();
    let mut tool_calls = 0;
    let mut tool_errors = 0;
    for message in messages {
        for call in &message.tool_calls {
            tool_calls += 1;
            let events = tools::events(message.seq, call);
            let failed = events.iter().any(|e| e.is_error);
            if failed {
                tool_errors += 1;
                let shell = events.iter().any(|e| e.kind == ToolKind::Shell);
                if let Some(line) = call
                    .output
                    .as_deref()
                    .filter(|_| shell)
                    .and_then(errors::extract)
                {
                    errors.push(ErrorEvent {
                        seq: message.seq,
                        signature: line.signature,
                        message: line.message,
                    });
                }
            }
            tool_events.extend(events);
        }
    }
    let failures = patterns::detect(messages, &tool_events);

    // Active time, and the part of it spent after a failing command until a command succeeds again.
    let stamped: Vec<(i64, &TranscriptMessage)> = messages
        .iter()
        .filter_map(|m| m.timestamp.map(|t| (t, m)))
        .collect();
    let mut shell_status = std::collections::HashMap::<i64, bool>::new();
    for e in tool_events.iter().filter(|e| e.kind == ToolKind::Shell) {
        *shell_status.entry(e.seq).or_default() |= e.is_error;
    }
    let (mut active_ms, mut recovery_ms, mut recovering) = (0, 0, false);
    for pair in stamped.windows(2) {
        let (t, message) = pair[0];
        if let Some(failed) = shell_status.get(&message.seq) {
            recovering = *failed;
        }
        let gap = pair[1].0 - t;
        if gap > 0 && gap <= IDLE_GAP_MS {
            active_ms += gap;
            if recovering {
                recovery_ms += gap;
            }
        }
    }
    let first_edit = tool_events
        .iter()
        .find(|e| e.kind == ToolKind::Edit)
        .map(|e| e.seq)
        .unwrap_or(i64::MAX);
    let early_errors = tool_events.iter().any(|e| {
        e.is_error
            && e.kind == ToolKind::Shell
            && e.seq < first_edit
            && !e
                .command
                .as_deref()
                .is_some_and(|c| TEST_COMMAND.is_match(c))
    });
    let facts = SessionFacts {
        started_at: stamped.first().map(|s| s.0).unwrap_or(meta.created_at),
        ended_at: stamped.last().map(|s| s.0).unwrap_or(meta.updated_at),
        active_ms,
        recovery_ms,
        prompts: messages
            .iter()
            .filter(|m| matches!(m.role, Role::User) && matches!(m.kind, MessageKind::Text))
            .count() as i64,
        tool_calls,
        tool_errors,
        category: category(&first_prompt(messages), &tool_events, early_errors),
        outcome: outcome(&tool_events, &failures),
    };
    Derived {
        stack: stack::detect(&tool_events),
        facts,
        tools: tool_events,
        errors,
        failures,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AgentId, ToolCall};

    fn meta() -> SessionMeta {
        SessionMeta {
            key: "claude-code:s".into(),
            native_id: "s".into(),
            agent: AgentId::ClaudeCode,
            host: None,
            parent_key: None,
            title: "t".into(),
            project_path: Some("/repo".into()),
            source_path: "/x".into(),
            created_at: 0,
            updated_at: 0,
            model: None,
            source: None,
            tokens: None,
            archived: false,
            metadata_only: false,
            can_delete: true,
            starred: false,
            pinned: false,
        }
    }
    fn user(seq: i64, t: i64, text: &str) -> TranscriptMessage {
        TranscriptMessage {
            seq,
            role: Role::User,
            kind: MessageKind::Text,
            text: text.into(),
            timestamp: Some(t),
            model: None,
            thinking: None,
            tool_calls: vec![],
            images: vec![],
        }
    }
    fn tool(
        seq: i64,
        t: i64,
        name: &str,
        input: &str,
        output: &str,
        is_error: bool,
    ) -> TranscriptMessage {
        let call = ToolCall {
            id: seq.to_string(),
            name: name.into(),
            input: Some(input.into()),
            output: Some(output.into()),
            is_error,
        };
        TranscriptMessage {
            tool_calls: vec![call],
            role: Role::Assistant,
            ..user(seq, t, "")
        }
    }
    const MIN: i64 = 60_000;

    #[test]
    fn bug_fix_that_gets_committed() {
        let messages = vec![
            user(0, 0, "Fix the crash when saving"),
            tool(
                1,
                MIN,
                "Bash",
                r#"{"command":"cargo test"}"#,
                "Exit code 101\nerror[E0425]: cannot find value `store` in this scope",
                true,
            ),
            tool(
                2,
                3 * MIN,
                "Edit",
                r#"{"file_path":"/repo/src/lib.rs"}"#,
                "ok",
                false,
            ),
            tool(
                3,
                4 * MIN,
                "Bash",
                r#"{"command":"cargo test"}"#,
                "test result: ok",
                false,
            ),
            tool(
                4,
                5 * MIN,
                "Bash",
                r#"{"command":"git commit -m fix"}"#,
                "[main abc] fix",
                false,
            ),
            user(5, 5 * MIN + IDLE_GAP_MS + 1, "thanks"),
        ];
        let d = derive(&meta(), &messages);
        assert_eq!(d.facts.category, Category::Bugs);
        assert_eq!(d.facts.outcome, Outcome::Committed);
        assert_eq!((d.facts.active_ms, d.facts.recovery_ms), (5 * MIN, 3 * MIN));
        assert_eq!((d.facts.tool_calls, d.facts.tool_errors), (4, 1));
        assert_eq!(d.errors.len(), 1);
        assert!(d.failures.is_empty());
        assert_eq!(d.stack.get("Rust"), Some(&3));
    }

    #[test]
    fn edit_loop_and_failing_tests_at_end() {
        let mut messages = vec![user(0, 0, "Add a settings page")];
        for i in 0..5 {
            messages.push(tool(
                1 + i * 2,
                i * MIN,
                "Edit",
                r#"{"file_path":"/repo/src/Settings.tsx"}"#,
                "ok",
                false,
            ));
            messages.push(tool(
                2 + i * 2,
                i * MIN + 1000,
                "exec_command",
                r#"{"cmd":"bun test"}"#,
                "Process exited with code 1\nOutput:\nTypeError: x is not a function",
                false,
            ));
        }
        let d = derive(&meta(), &messages);
        let patterns: Vec<_> = d.failures.iter().map(|f| f.0).collect();
        assert_eq!(
            patterns,
            [
                Pattern::EditLoop,
                Pattern::TestsFailingAtEnd,
                Pattern::UnknownApi
            ]
        );
        assert_eq!(d.failures[0].1, 9);
        assert_eq!(d.facts.outcome, Outcome::Failed);
        assert_eq!(d.facts.category, Category::Features);
        assert!(d.stack.contains_key("React") && d.stack.contains_key("Bun"));
    }

    #[test]
    fn compaction_denial_and_categories() {
        let compact = TranscriptMessage {
            kind: MessageKind::CompactSummary,
            role: Role::System,
            ..user(1, MIN, "Context compacted")
        };
        let messages = vec![
            user(0, 0, "What does the scanner do?"),
            compact,
            tool(
                2,
                2 * MIN,
                "Bash",
                r#"{"command":"rm -rf build"}"#,
                "Permission for this action was denied by the user",
                true,
            ),
        ];
        let d = derive(&meta(), &messages);
        assert_eq!(
            d.failures.iter().map(|f| f.0).collect::<Vec<_>>(),
            [Pattern::ContextExhausted, Pattern::PermissionStall]
        );
        assert_eq!(d.facts.outcome, Outcome::Failed);
        assert!(d.errors.is_empty(), "a denial is not a bug");

        let setup = derive(
            &meta(),
            &[
                user(0, 0, "Add the lint step"),
                tool(
                    1,
                    MIN,
                    "Write",
                    r#"{"file_path":"/repo/.github/workflows/ci.yml"}"#,
                    "ok",
                    false,
                ),
            ],
        );
        assert_eq!(
            (setup.facts.category, setup.facts.outcome),
            (Category::Setup, Outcome::Uncommitted)
        );
        let tests = derive(
            &meta(),
            &[
                user(0, 0, "Please write tests for the parser"),
                tool(
                    1,
                    MIN,
                    "Write",
                    r#"{"file_path":"/repo/src/parser.test.ts"}"#,
                    "ok",
                    false,
                ),
            ],
        );
        assert_eq!(tests.facts.category, Category::Tests);
        let refactor = derive(
            &meta(),
            &[
                user(0, 0, "Rename Store to Index"),
                tool(
                    1,
                    MIN,
                    "Edit",
                    r#"{"file_path":"/repo/src/store.rs"}"#,
                    "ok",
                    false,
                ),
            ],
        );
        assert_eq!(refactor.facts.category, Category::Refactoring);
        let explore = derive(&meta(), &[user(0, 0, "How does search work?")]);
        assert_eq!(
            (explore.facts.category, explore.facts.outcome),
            (Category::Exploring, Outcome::NoChanges)
        );
    }
}
