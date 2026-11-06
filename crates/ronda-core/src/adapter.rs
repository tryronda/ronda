use crate::{AgentId, ParsedSession, ResumeSpec, SessionMeta};
use anyhow::Result;
use std::path::{Path, PathBuf};

/// Title for a session without an explicit one: the first non-blank line of the prompt,
/// trimmed, with inner whitespace collapsed, at most 100 characters.
pub(crate) fn fallback_title(text: &str) -> String {
    let line = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let collapsed = line.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(100).collect()
}

/// Title for a session with a stored one: trimmed, or only its first line when it spans several.
pub(crate) fn tidy_title(title: &str) -> String {
    if title.contains(['\n', '\r']) {
        fallback_title(title)
    } else {
        title.trim().to_owned()
    }
}

#[derive(Debug, Clone)]
pub struct SourceRef {
    pub agent: AgentId,
    pub native_id: String,
    pub path: PathBuf,
    pub modified_ms: i64,
    pub size: u64,
}

pub trait AgentAdapter: Send + Sync {
    fn agent(&self) -> AgentId;
    fn rank(&self) -> u8 {
        0
    }
    fn fingerprint(&self, source: &SourceRef) -> String {
        let wal = std::path::PathBuf::from(format!("{}-wal", source.path.display()));
        let wal_stamp = wal
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok().map(|time| (time, m.len())));
        format!("{}:{}:{wal_stamp:?}", source.modified_ms, source.size)
    }
    fn roots(&self, home: &Path) -> Vec<PathBuf>;
    fn discover(&self, root: &Path) -> Result<Vec<SourceRef>>;
    fn parse(&self, source: &SourceRef) -> Result<Option<ParsedSession>>;
    fn resume(&self, _meta: &SessionMeta) -> Option<ResumeSpec> {
        None
    }
    fn owned_paths(&self, meta: &SessionMeta) -> Vec<PathBuf> {
        vec![PathBuf::from(&meta.source_path)]
    }
}

#[cfg(test)]
mod title_tests {
    use super::{fallback_title, tidy_title};

    #[test]
    fn fallback_title_uses_first_nonblank_line_collapsed_and_clipped() {
        assert_eq!(
            fallback_title("\n\n  Fix  the build\nmore"),
            "Fix the build"
        );
        assert_eq!(fallback_title("   \n "), "");
        assert_eq!(tidy_title("  One  "), "One");
        assert_eq!(tidy_title("Line one\r\nLine two"), "Line one");
        assert_eq!(fallback_title(&"x".repeat(150)).chars().count(), 100);
    }
}
