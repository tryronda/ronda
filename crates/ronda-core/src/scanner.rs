use crate::{
    adapters,
    source_health::{
        bound_roots, root_id, LocalRefreshHealth, RootHealth, RootStatus, MAX_COUNT, PREF_KEY,
    },
    AgentAdapter, SourceRef, Store,
};
use anyhow::Result;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

pub struct Scanner {
    adapters: Vec<Box<dyn AgentAdapter>>,
    home: PathBuf,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ScanReport {
    pub discovered: usize,
    pub indexed: usize,
    pub unchanged: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct Location {
    pub agent: String,
    pub path: String,
    pub health_id: String,
    pub enabled: bool,
    pub custom: bool,
}

#[derive(Default)]
struct RootScanState {
    id: String,
    source_records: u64,
    issues: u64,
    counts_truncated: bool,
    status: Option<RootStatus>,
}

fn bump_count(count: &mut u64, truncated: &mut bool) {
    if *count == MAX_COUNT {
        *truncated = true;
    } else {
        *count += 1;
    }
}

impl Scanner {
    pub fn new(home: PathBuf) -> Self {
        Self {
            adapters: adapters::all(),
            home,
        }
    }
    pub fn default_home() -> PathBuf {
        std::env::var_os("RONDA_HOME")
            .map(PathBuf::from)
            .or_else(dirs::home_dir)
            .unwrap_or_else(std::env::temp_dir)
    }

    pub fn locations(&self, store: &Store) -> Result<Vec<Location>> {
        let custom: HashMap<String, Vec<PathBuf>> = store
            .pref_get("custom_roots")?
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default();
        let disabled: HashSet<String> = store
            .pref_get("disabled_roots")?
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default();
        let mut locations = Vec::new();
        for adapter in &self.adapters {
            let defaults = adapter.roots(&self.home);
            let extra: Vec<PathBuf> = custom
                .get(adapter.agent().as_str())
                .into_iter()
                .flatten()
                .filter(|root| !defaults.contains(root))
                .cloned()
                .collect();
            let mut seen = HashSet::new();
            for (root, is_custom) in defaults
                .iter()
                .cloned()
                .map(|root| (root, false))
                .chain(extra.into_iter().map(|root| (root, true)))
            {
                if !seen.insert(root.clone()) {
                    continue;
                }
                let path = root.to_string_lossy().into_owned();
                locations.push(Location {
                    agent: adapter.agent().as_str().into(),
                    health_id: root_id(adapter.agent().as_str(), &root),
                    enabled: !disabled.contains(&path),
                    path,
                    custom: is_custom,
                });
            }
        }
        Ok(locations)
    }

    pub fn scan(&self, store: &mut Store, force: bool) -> Result<ScanReport> {
        self.scan_host(store, &self.home, None, force)
    }

    pub fn scan_host(
        &self,
        store: &mut Store,
        home: &Path,
        host: Option<&str>,
        force: bool,
    ) -> Result<ScanReport> {
        let outcome = self.scan_host_with_health(store, home, host, force)?;
        if host.is_none() {
            store.pref_set(PREF_KEY, &outcome.health.encode()?)?;
        }
        Ok(outcome.report)
    }

    fn scan_host_with_health(
        &self,
        store: &mut Store,
        home: &Path,
        host: Option<&str>,
        force: bool,
    ) -> Result<ScanOutcome> {
        let mut report = ScanReport::default();
        let mut refs: HashMap<String, Vec<(usize, SourceRef, String)>> = HashMap::new();
        let mut root_states = HashMap::<String, RootScanState>::new();
        let mut local_paths_by_agent = HashMap::<String, Vec<PathBuf>>::new();
        let mut complete = true;
        let custom: HashMap<String, Vec<PathBuf>> = store
            .pref_get("custom_roots")?
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default();
        let disabled: HashSet<String> = store
            .pref_get("disabled_roots")?
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default();
        for (index, adapter) in self.adapters.iter().enumerate() {
            let mut roots = adapter.roots(home);
            if host.is_none() {
                if let Some(extra) = custom.get(adapter.agent().as_str()) {
                    roots.extend(extra.iter().cloned());
                }
            }
            roots.sort();
            roots.dedup();
            for root in roots {
                if host.is_none() && disabled.contains(&root.to_string_lossy().to_string()) {
                    let id = root_id(adapter.agent().as_str(), &root);
                    root_states.insert(
                        id.clone(),
                        RootScanState {
                            id,
                            status: Some(RootStatus::Disabled),
                            ..RootScanState::default()
                        },
                    );
                    continue;
                }
                let id = root_id(adapter.agent().as_str(), &root);
                let state = root_states
                    .entry(id.clone())
                    .or_insert_with(|| RootScanState {
                        id: id.clone(),
                        ..RootScanState::default()
                    });
                if std::fs::metadata(&root).is_err() {
                    state.status = Some(RootStatus::Unavailable);
                    if host.is_none() {
                        let agent = adapter.agent().as_str();
                        if !local_paths_by_agent.contains_key(agent) {
                            local_paths_by_agent.insert(
                                agent.to_string(),
                                store.local_source_paths_for_agent(agent)?,
                            );
                        }
                        if local_paths_by_agent
                            .get(agent)
                            .is_some_and(|paths| paths.iter().any(|path| path.starts_with(&root)))
                        {
                            complete = false;
                        }
                    }
                    continue;
                }
                match adapter.discover(&root) {
                    Ok(found) => {
                        for source in found {
                            let key = session_key(source.agent.as_str(), host, &source.native_id);
                            refs.entry(key)
                                .or_default()
                                .push((index, source, id.clone()));
                            report.discovered += 1;
                            bump_count(&mut state.source_records, &mut state.counts_truncated);
                        }
                    }
                    Err(e) => {
                        complete = false;
                        bump_count(&mut state.issues, &mut state.counts_truncated);
                        report.errors.push(format!("{}: {e}", root.display()));
                    }
                }
            }
        }
        let mut seen = HashSet::new();
        for (key, mut candidates) in refs {
            seen.insert(key.clone());
            if store.is_tombstoned(&key)? {
                continue;
            }
            candidates.sort_by(|a, b| {
                self.adapters[a.0]
                    .rank()
                    .cmp(&self.adapters[b.0].rank())
                    .then(b.1.modified_ms.cmp(&a.1.modified_ms))
            });
            let mut parsed = None;
            let mut errored = false;
            let mut skipped = false;
            for (index, source, id) in candidates {
                let adapter = &self.adapters[index];
                let fingerprint = adapter.fingerprint(&source);
                let unchanged = !force
                    && store
                        .fingerprint_and_source(&key)?
                        .is_some_and(|(stored, path)| {
                            path == source.path.to_string_lossy() && stored == fingerprint
                        });
                if unchanged {
                    report.unchanged += 1;
                    parsed = Some(());
                    break;
                }
                match adapter.parse(&source) {
                    Ok(Some(mut session)) => {
                        session.meta.key = key.clone();
                        session.meta.host = host.map(str::to_string);
                        if let Some(host) = host {
                            session.meta.parent_key =
                                session.meta.parent_key.as_deref().map(|parent| {
                                    parent
                                        .split_once(':')
                                        .map(|(agent, id)| session_key(agent, Some(host), id))
                                        .unwrap_or_else(|| parent.to_string())
                                });
                        }
                        session.meta.source_path = source.path.to_string_lossy().into_owned();
                        if host.is_some() {
                            session.meta.can_delete = false;
                        }
                        if !store.is_tombstoned(&key)? {
                            store.upsert(&session, &fingerprint)?;
                            report.indexed += 1;
                        }
                        parsed = Some(());
                        break;
                    }
                    // An intentional skip (e.g. an empty transcript) is handled; the key
                    // stays in `seen`, so an existing source's session is never pruned.
                    Ok(None) => skipped = true,
                    Err(e) => {
                        errored = true;
                        if let Some(root) = root_states.get_mut(&id) {
                            bump_count(&mut root.issues, &mut root.counts_truncated);
                        }
                        report
                            .errors
                            .push(format!("{}: {e}", source.path.display()));
                    }
                }
            }
            if parsed.is_none() && (errored || !skipped) {
                complete = false;
            }
        }
        if complete {
            store.prune_missing(host, &seen)?;
        }
        report.errors.sort();
        let roots = root_states
            .into_values()
            .map(|root| {
                let status = root.status.unwrap_or(if root.issues == 0 {
                    RootStatus::Checked
                } else {
                    RootStatus::Partial
                });
                RootHealth {
                    id: root.id,
                    status,
                    source_records: root.source_records,
                    issues: root.issues,
                    counts_truncated: root.counts_truncated,
                }
            })
            .collect::<Vec<_>>();
        let (roots, roots_truncated) = bound_roots(roots);
        Ok(ScanOutcome {
            report,
            health: LocalRefreshHealth::new(
                chrono::Utc::now().timestamp_millis(),
                roots,
                roots_truncated,
            ),
        })
    }

    pub fn adapter(&self, agent: crate::AgentId) -> Option<&dyn AgentAdapter> {
        self.adapters
            .iter()
            .find(|a| a.agent() == agent)
            .map(|a| a.as_ref())
    }
}

struct ScanOutcome {
    report: ScanReport,
    health: LocalRefreshHealth,
}

pub fn session_key(agent: &str, host: Option<&str>, id: &str) -> String {
    match host {
        Some(host) => format!("{agent}:{host}:{id}"),
        None => format!("{agent}:{id}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_root_matching_a_default_is_listed_once() {
        let home = std::env::temp_dir().join(format!("ronda-loc-{}", std::process::id()));
        let scanner = Scanner::new(home.clone());
        let store = Store::open(Path::new(":memory:")).unwrap();
        let adapter = &scanner.adapters[0];
        let agent = adapter.agent().as_str().to_owned();
        let default = adapter.roots(&home).remove(0);
        let extra = home.join("elsewhere");
        let prefs = HashMap::from([(agent.clone(), vec![default.clone(), extra.clone(), extra])]);
        store
            .pref_set("custom_roots", &serde_json::to_string(&prefs).unwrap())
            .unwrap();
        let path = default.to_string_lossy();
        let locations: Vec<_> = scanner
            .locations(&store)
            .unwrap()
            .into_iter()
            .filter(|l| l.agent == agent && l.path == path)
            .collect();
        assert_eq!(locations.len(), 1);
        assert!(!locations[0].custom);
        let custom_count = scanner
            .locations(&store)
            .unwrap()
            .iter()
            .filter(|l| l.agent == agent && l.custom)
            .count();
        assert_eq!(custom_count, 1);
    }

    struct BrokenAdapter {
        root: PathBuf,
    }

    impl AgentAdapter for BrokenAdapter {
        fn agent(&self) -> crate::AgentId {
            crate::AgentId::ClaudeCode
        }
        fn roots(&self, _home: &Path) -> Vec<PathBuf> {
            vec![self.root.clone()]
        }
        fn discover(&self, _root: &Path) -> Result<Vec<SourceRef>> {
            Ok(["q", "c", "x", "a", "m", "f"]
                .into_iter()
                .map(|id| SourceRef {
                    agent: crate::AgentId::ClaudeCode,
                    native_id: id.into(),
                    path: self.root.join(format!("{id}.jsonl")),
                    modified_ms: 1,
                    size: 1,
                })
                .collect())
        }
        fn parse(&self, source: &SourceRef) -> Result<Option<crate::ParsedSession>> {
            anyhow::bail!("unparsable {}", source.native_id)
        }
    }

    #[test]
    fn scan_errors_are_sorted_and_repeat_across_scans() {
        let root = std::env::temp_dir().join(format!("ronda-errs-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let scanner = Scanner {
            adapters: vec![Box::new(BrokenAdapter { root: root.clone() })],
            home: root.clone(),
        };
        let mut store = Store::open(Path::new(":memory:")).unwrap();
        let first = scanner.scan(&mut store, true).unwrap().errors;
        let second = scanner.scan(&mut store, true).unwrap().errors;
        std::fs::remove_dir_all(&root).ok();
        assert_eq!(first.len(), 6);
        let mut sorted = first.clone();
        sorted.sort();
        assert_eq!(first, sorted);
        assert_eq!(first, second);
    }

    struct CountingAdapter {
        root: PathBuf,
        parses: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    }

    impl AgentAdapter for CountingAdapter {
        fn agent(&self) -> crate::AgentId {
            crate::AgentId::ClaudeCode
        }
        fn roots(&self, _home: &Path) -> Vec<PathBuf> {
            vec![self.root.clone()]
        }
        fn discover(&self, _root: &Path) -> Result<Vec<SourceRef>> {
            Ok(vec![SourceRef {
                agent: crate::AgentId::ClaudeCode,
                native_id: "gone".into(),
                path: self.root.join("gone.jsonl"),
                modified_ms: 1,
                size: 1,
            }])
        }
        fn parse(&self, _source: &SourceRef) -> Result<Option<crate::ParsedSession>> {
            self.parses
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(None)
        }
    }

    #[test]
    fn tombstoned_sessions_are_not_parsed() {
        let root = std::env::temp_dir().join(format!("ronda-tomb-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let parses = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let scanner = Scanner {
            adapters: vec![Box::new(CountingAdapter {
                root: root.clone(),
                parses: parses.clone(),
            })],
            home: root.clone(),
        };
        let mut store = Store::open(Path::new(":memory:")).unwrap();
        store
            .tombstone(&session_key("claude-code", None, "gone"))
            .unwrap();
        scanner.scan(&mut store, true).unwrap();
        scanner.scan(&mut store, true).unwrap();
        std::fs::remove_dir_all(&root).ok();
        assert_eq!(parses.load(std::sync::atomic::Ordering::SeqCst), 0);
    }
}
