//! Named rules for the ways agent sessions go wrong. Each rule reports the message where it fired.
use super::tools::{ToolEvent, ToolKind};
use crate::{MessageKind, TranscriptMessage};
use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Pattern {
    EditLoop,
    ContextExhausted,
    TestsFailingAtEnd,
    PermissionStall,
    UnknownApi,
}

impl Pattern {
    pub const ALL: [Self; 5] = [
        Self::EditLoop,
        Self::ContextExhausted,
        Self::TestsFailingAtEnd,
        Self::PermissionStall,
        Self::UnknownApi,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::EditLoop => "edit_loop",
            Self::ContextExhausted => "context_exhausted",
            Self::TestsFailingAtEnd => "tests_failing_at_end",
            Self::PermissionStall => "permission_stall",
            Self::UnknownApi => "unknown_api",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.as_str() == s)
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::EditLoop => "Edit loop: the same file edited five or more times around errors",
            Self::ContextExhausted => "Context filled up and was compacted",
            Self::TestsFailingAtEnd => "Session ended with tests still failing",
            Self::PermissionStall => "Blocked by a denied or rejected tool call",
            Self::UnknownApi => "Called an API that does not exist",
        }
    }
}

pub static TEST_COMMAND: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)\b(?:pytest|vitest|jest|mocha|rspec|phpunit|go test|cargo (?:test|nextest)|(?:bun|npm|pnpm|yarn|deno) (?:run )?test|playwright test|swift test|dotnet test|mix test|gradle test|mvn test|bun run check|make (?:test|check)|flutter test)\b|(?:^|[;&|])\s*(?:tox|nox|ctest|bats)\b").unwrap()
});
static DENIED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(permission (for this action )?(was )?denied|doesn't want to proceed|user (rejected|denied|declined)|rejected by (the )?user|requires approval|not allowed by|sandbox (denied|blocked))").unwrap()
});
static UNKNOWN_API: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(is not a function|has no attribute|cannot find name|no method named|unresolved import|has no exported member|is not exported from|does not provide an export named|undefined method|no such function|cannot find module|module not found|no field .* on type|property '.*' does not exist on type)").unwrap()
});

const EDIT_LOOP_EDITS: usize = 5;

pub fn detect(messages: &[TranscriptMessage], events: &[ToolEvent]) -> Vec<(Pattern, i64)> {
    let mut found = Vec::new();
    // Edit loop: one file edited five or more times with a failing tool call in between.
    let mut edits: HashMap<&str, Vec<i64>> = HashMap::new();
    for event in events.iter().filter(|e| e.kind == ToolKind::Edit) {
        if let Some(path) = &event.path {
            edits.entry(path).or_default().push(event.seq);
        }
    }
    let mut loops: Vec<i64> = edits
        .values()
        .filter(|seqs| seqs.len() >= EDIT_LOOP_EDITS)
        .filter(|seqs| {
            let (first, last) = (seqs[0], seqs[seqs.len() - 1]);
            events
                .iter()
                .any(|e| e.is_error && e.seq >= first && e.seq <= last)
        })
        .map(|seqs| seqs[EDIT_LOOP_EDITS - 1])
        .collect();
    loops.sort();
    if let Some(seq) = loops.first() {
        found.push((Pattern::EditLoop, *seq));
    }
    if let Some(m) = messages
        .iter()
        .find(|m| matches!(m.kind, MessageKind::CompactSummary))
    {
        found.push((Pattern::ContextExhausted, m.seq));
    }
    let last_test = events.iter().rev().find(|e| {
        e.kind == ToolKind::Shell
            && e.command
                .as_deref()
                .is_some_and(|c| TEST_COMMAND.is_match(c))
    });
    if let Some(test) = last_test.filter(|e| e.is_error) {
        found.push((Pattern::TestsFailingAtEnd, test.seq));
    }
    let tool_outputs = messages
        .iter()
        .flat_map(|m| m.tool_calls.iter().map(move |c| (m.seq, c)));
    let mut denied = None;
    let mut unknown_api = None;
    for (seq, call) in tool_outputs {
        let Some(output) = call.output.as_deref() else {
            continue;
        };
        let head = &output[..output.floor_char_boundary(output.len().min(2000))];
        let failed = call.is_error || super::tools::exit_code(output).is_some_and(|c| c != 0);
        if denied.is_none() && failed && DENIED.is_match(head) {
            denied = Some(seq);
        }
        if unknown_api.is_none() && failed && UNKNOWN_API.is_match(head) {
            unknown_api = Some(seq);
        }
    }
    if let Some(seq) = denied {
        found.push((Pattern::PermissionStall, seq));
    }
    if let Some(seq) = unknown_api {
        found.push((Pattern::UnknownApi, seq));
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shell(command: &str, exit_code: i32) -> ToolEvent {
        ToolEvent {
            seq: 3,
            kind: ToolKind::Shell,
            command: Some(command.to_string()),
            path: None,
            is_error: exit_code != 0,
            exit_code: Some(exit_code),
        }
    }

    fn fires(command: &str) -> bool {
        detect(&[], &[shell(command, 1)])
            .iter()
            .any(|(p, _)| *p == Pattern::TestsFailingAtEnd)
    }

    #[test]
    fn recognises_more_test_runners() {
        for command in [
            "make test",
            "make test-unit",
            "make check",
            "cd x && tox -e py",
            "nox -s tests",
            "ctest --output-on-failure",
            "bats tests/",
            "flutter test",
            "pytest -q",
        ] {
            assert!(fires(command), "{command} should count as a test run");
        }
    }

    #[test]
    fn ignores_words_that_only_start_with_a_runner() {
        for command in [
            "pip install tox",
            "make testdata",
            "go testing",
            "echo mochaccino",
            "ls batsman",
        ] {
            assert!(!fires(command), "{command} should not count as a test run");
        }
    }

    #[test]
    fn passing_runs_do_not_fire() {
        assert!(!detect(&[], &[shell("make test", 0)])
            .iter()
            .any(|(p, _)| *p == Pattern::TestsFailingAtEnd));
    }
}
