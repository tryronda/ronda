use crate::{AgentId, ParsedSession, ResumeSpec, SessionMeta};
use anyhow::Result;
use std::path::{Path, PathBuf};

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
