use crate::{adapters, AgentAdapter, SourceRef, Store};
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
    pub enabled: bool,
    pub custom: bool,
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
        let mut report = ScanReport::default();
        let mut refs: HashMap<String, Vec<(usize, SourceRef)>> = HashMap::new();
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
                    continue;
                }
                if !root.exists() {
                    continue;
                }
                match adapter.discover(&root) {
                    Ok(found) => {
                        for source in found {
                            let key = session_key(source.agent.as_str(), host, &source.native_id);
                            refs.entry(key).or_default().push((index, source));
                            report.discovered += 1;
                        }
                    }
                    Err(e) => {
                        complete = false;
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
            for (index, source) in candidates {
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
                    Err(e) => report
                        .errors
                        .push(format!("{}: {e}", source.path.display())),
                }
            }
            if parsed.is_none() {
                complete = false;
            }
        }
        if complete {
            store.prune_missing(host, &seen)?;
        }
        Ok(report)
    }

    pub fn adapter(&self, agent: crate::AgentId) -> Option<&dyn AgentAdapter> {
        self.adapters
            .iter()
            .find(|a| a.agent() == agent)
            .map(|a| a.as_ref())
    }
}

pub fn session_key(agent: &str, host: Option<&str>, id: &str) -> String {
    match host {
        Some(host) => format!("{agent}:{host}:{id}"),
        None => format!("{agent}:{id}"),
    }
}
