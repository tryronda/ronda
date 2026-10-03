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
            for (root, is_custom) in adapter
                .roots(&self.home)
                .into_iter()
                .map(|root| (root, false))
                .chain(
                    custom
                        .get(adapter.agent().as_str())
                        .into_iter()
                        .flatten()
                        .cloned()
                        .map(|root| (root, true)),
                )
            {
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
            candidates.sort_by(|a, b| {
                self.adapters[a.0]
                    .rank()
                    .cmp(&self.adapters[b.0].rank())
                    .then(b.1.modified_ms.cmp(&a.1.modified_ms))
            });
            let mut parsed = None;
            for (index, source, id) in candidates {
                let adapter = &self.adapters[index];
                let fingerprint = adapter.fingerprint(&source);
                let same_source = store
                    .get_session(&key)?
                    .is_some_and(|m| m.source_path == source.path.to_string_lossy());
                if !force
                    && same_source
                    && store.fingerprint(&key)?.as_deref() == Some(&fingerprint)
                {
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
                    Ok(None) => {}
                    Err(e) => {
                        if let Some(root) = root_states.get_mut(&id) {
                            bump_count(&mut root.issues, &mut root.counts_truncated);
                        }
                        report
                            .errors
                            .push(format!("{}: {e}", source.path.display()));
                    }
                }
            }
            if parsed.is_none() {
                complete = false;
            }
        }
        if complete {
            store.prune_missing(host, &seen)?;
        }
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
