use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

pub const PREF_KEY: &str = "local_source_refresh_health_v1";
const VERSION: u8 = 1;
const MAX_BYTES: usize = 256 * 1024;
pub const MAX_ROOTS: usize = 512;
pub const MAX_COUNT: u64 = 1_000_000_000;
const MIN_TIMESTAMP_MS: i64 = 946_684_800_000;
const FUTURE_TOLERANCE_MS: i64 = 5 * 60 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RootStatus {
    Disabled,
    Unavailable,
    Checked,
    Partial,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RootHealth {
    pub id: String,
    pub status: RootStatus,
    pub source_records: u64,
    pub issues: u64,
    pub counts_truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalRefreshHealth {
    pub version: u8,
    pub completed_at_ms: i64,
    pub roots_truncated: bool,
    pub roots: Vec<RootHealth>,
}

impl LocalRefreshHealth {
    pub fn new(completed_at_ms: i64, roots: Vec<RootHealth>, roots_truncated: bool) -> Self {
        Self {
            version: VERSION,
            completed_at_ms,
            roots_truncated,
            roots,
        }
    }

    pub fn encode(&self) -> Result<String> {
        self.validate(std::time::SystemTime::now())?;
        let value = serde_json::to_string(self)?;
        if value.len() > MAX_BYTES {
            bail!("source refresh health is too large");
        }
        Ok(value)
    }

    pub fn decode(value: &str, now_ms: i64) -> Result<Self> {
        if value.len() > MAX_BYTES {
            bail!("source refresh health is too large");
        }
        let health: Self = serde_json::from_str(value)?;
        health.validate_at(now_ms)?;
        Ok(health)
    }

    pub fn retain_current_roots(&mut self, current: &HashSet<String>) {
        self.roots.retain(|root| current.contains(&root.id));
    }

    fn validate(&self, now: std::time::SystemTime) -> Result<()> {
        let now_ms = now
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| anyhow::anyhow!("system clock is before the Unix epoch"))?
            .as_millis()
            .try_into()?;
        self.validate_at(now_ms)
    }

    fn validate_at(&self, now_ms: i64) -> Result<()> {
        if self.version != VERSION
            || self.completed_at_ms < MIN_TIMESTAMP_MS
            || self.completed_at_ms > now_ms.saturating_add(FUTURE_TOLERANCE_MS)
            || self.roots.len() > MAX_ROOTS
        {
            bail!("invalid source refresh health metadata");
        }
        let mut ids = HashSet::with_capacity(self.roots.len());
        for root in &self.roots {
            if !is_sha256(&root.id)
                || !ids.insert(&root.id)
                || root.source_records > MAX_COUNT
                || root.issues > MAX_COUNT
                || (root.counts_truncated
                    && root.source_records != MAX_COUNT
                    && root.issues != MAX_COUNT)
                || match root.status {
                    RootStatus::Disabled | RootStatus::Unavailable => {
                        root.source_records != 0 || root.issues != 0 || root.counts_truncated
                    }
                    RootStatus::Checked => root.issues != 0,
                    RootStatus::Partial => root.issues == 0,
                }
            {
                bail!("invalid source refresh health root");
            }
        }
        Ok(())
    }
}

pub fn bound_roots(mut roots: Vec<RootHealth>) -> (Vec<RootHealth>, bool) {
    roots.sort_by(|a, b| a.id.cmp(&b.id));
    let truncated = roots.len() > MAX_ROOTS;
    roots.truncate(MAX_ROOTS);
    (roots, truncated)
}

pub fn root_id(agent: &str, path: &std::path::Path) -> String {
    let mut hash = Sha256::new();
    hash.update(b"ronda-local-source-root-v1\0");
    hash.update((agent.len() as u64).to_be_bytes());
    hash.update(agent.as_bytes());
    let path = path.as_os_str().as_encoded_bytes();
    hash.update((path.len() as u64).to_be_bytes());
    hash.update(path);
    format!("{:x}", hash.finalize())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn health() -> LocalRefreshHealth {
        LocalRefreshHealth::new(
            1_750_000_000_000,
            vec![RootHealth {
                id: ID.into(),
                status: RootStatus::Checked,
                source_records: 0,
                issues: 0,
                counts_truncated: false,
            }],
            false,
        )
    }

    #[test]
    fn health_roundtrips_and_rejects_unknown_or_invalid_data() {
        let valid = health();
        let encoded = serde_json::to_string(&valid).unwrap();
        assert_eq!(
            LocalRefreshHealth::decode(&encoded, 1_750_000_000_000).unwrap(),
            valid
        );
        assert!(LocalRefreshHealth::decode(
            &encoded.replace("\"version\":1", "\"version\":1,\"path\":\"/private\""),
            1_750_000_000_000,
        )
        .is_err());
        assert!(LocalRefreshHealth::decode(&encoded, 1_749_699_999_999).is_err());
        assert!(LocalRefreshHealth::decode(
            &encoded.replace("1750000000000", "1"),
            1_750_000_000_000,
        )
        .is_err());
        assert!(LocalRefreshHealth::decode(
            &encoded.replace("\"issues\":0", "\"issues\":1"),
            1_750_000_000_000,
        )
        .is_err());
    }

    #[test]
    fn root_ids_are_opaque_and_scoped_by_agent_and_path() {
        let id = root_id("codex", std::path::Path::new("/home/alice/.codex/sessions"));
        assert_eq!(id.len(), 64);
        assert!(!id.contains("codex") && !id.contains("alice"));
        assert_ne!(
            id,
            root_id(
                "claude",
                std::path::Path::new("/home/alice/.codex/sessions")
            )
        );
        assert_ne!(
            id,
            root_id("codex", std::path::Path::new("/home/alice/.codex/other"))
        );
    }

    #[test]
    fn root_limit_is_deterministic_and_reported() {
        let roots = (0..MAX_ROOTS + 1)
            .map(|index| RootHealth {
                id: format!("{index:064x}"),
                status: RootStatus::Checked,
                source_records: 0,
                issues: 0,
                counts_truncated: false,
            })
            .collect();
        let (roots, truncated) = bound_roots(roots);
        assert!(truncated);
        assert_eq!(roots.len(), MAX_ROOTS);
        assert!(roots.windows(2).all(|pair| pair[0].id < pair[1].id));
    }

    #[test]
    fn saturated_counts_are_marked_and_unbounded_values_are_rejected() {
        let mut value = health();
        value.roots[0].source_records = MAX_COUNT;
        value.roots[0].counts_truncated = true;
        let encoded = value.encode().unwrap();
        assert_eq!(
            LocalRefreshHealth::decode(&encoded, chrono::Utc::now().timestamp_millis()).unwrap(),
            value
        );
        assert!(LocalRefreshHealth::decode(
            &encoded.replace("1000000000", "1000000001"),
            chrono::Utc::now().timestamp_millis(),
        )
        .is_err());
    }
}
