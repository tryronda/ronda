use crate::{
    InsightRow, Insights, ParsedSession, ProjectInfo, SearchHit, SessionMeta, SessionQuery,
    TranscriptMessage,
};
use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

pub struct Store {
    conn: Connection,
}

/// Bump when derived tables or the rules that fill them change; opening the index then rebuilds them.
pub const SCHEMA_VERSION: i64 = 1;

const INTEL_SCHEMA: &str = "\
    CREATE TABLE IF NOT EXISTS session_facts (\
        session_key TEXT PRIMARY KEY, parent_key TEXT, agent TEXT NOT NULL, project TEXT, model TEXT,\
        started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, active_ms INTEGER NOT NULL,\
        recovery_ms INTEGER NOT NULL, prompts INTEGER NOT NULL, tool_calls INTEGER NOT NULL,\
        tool_errors INTEGER NOT NULL, category TEXT NOT NULL, outcome TEXT NOT NULL, tokens INTEGER\
    );\
    CREATE TABLE IF NOT EXISTS tool_events (\
        session_key TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, command TEXT, path TEXT,\
        is_error INTEGER NOT NULL, exit_code INTEGER\
    );\
    CREATE TABLE IF NOT EXISTS error_events (\
        session_key TEXT NOT NULL, seq INTEGER NOT NULL, signature TEXT NOT NULL, message TEXT NOT NULL\
    );\
    CREATE TABLE IF NOT EXISTS failure_events (session_key TEXT NOT NULL, seq INTEGER NOT NULL, pattern TEXT NOT NULL);\
    CREATE TABLE IF NOT EXISTS stack_hits (session_key TEXT NOT NULL, tech TEXT NOT NULL, weight INTEGER NOT NULL);\
    CREATE INDEX IF NOT EXISTS session_facts_ended ON session_facts(ended_at);\
    CREATE INDEX IF NOT EXISTS tool_events_session ON tool_events(session_key);\
    CREATE INDEX IF NOT EXISTS error_events_session ON error_events(session_key);\
    CREATE INDEX IF NOT EXISTS error_events_signature ON error_events(signature);\
    CREATE INDEX IF NOT EXISTS failure_events_session ON failure_events(session_key);\
    CREATE INDEX IF NOT EXISTS stack_hits_session ON stack_hits(session_key);\
";

fn clear_facts(tx: &rusqlite::Transaction, key: &str) -> Result<()> {
    for table in [
        "session_facts",
        "tool_events",
        "error_events",
        "failure_events",
        "stack_hits",
    ] {
        tx.execute(&format!("DELETE FROM {table} WHERE session_key=?1"), [key])?;
    }
    Ok(())
}

fn write_facts(
    tx: &rusqlite::Transaction,
    meta: &SessionMeta,
    messages: &[TranscriptMessage],
) -> Result<()> {
    clear_facts(tx, &meta.key)?;
    let derived = crate::intel::derive(meta, messages);
    let f = &derived.facts;
    tx.execute(
        "INSERT INTO session_facts(session_key,parent_key,agent,project,model,started_at,ended_at,active_ms,recovery_ms,prompts,tool_calls,tool_errors,category,outcome,tokens) \
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        params![meta.key, meta.parent_key, meta.agent.as_str(), meta.project_path, meta.model, f.started_at, f.ended_at, f.active_ms,
            f.recovery_ms, f.prompts, f.tool_calls, f.tool_errors, f.category.as_str(), f.outcome.as_str(), meta.tokens],
    )?;
    let mut tool = tx.prepare_cached("INSERT INTO tool_events(session_key,seq,kind,command,path,is_error,exit_code) VALUES(?1,?2,?3,?4,?5,?6,?7)")?;
    for e in &derived.tools {
        let command = e
            .command
            .as_deref()
            .map(|c| c.chars().take(500).collect::<String>());
        tool.execute(params![
            meta.key,
            e.seq,
            e.kind.as_str(),
            command,
            e.path,
            e.is_error,
            e.exit_code
        ])?;
    }
    let mut error = tx.prepare_cached(
        "INSERT INTO error_events(session_key,seq,signature,message) VALUES(?1,?2,?3,?4)",
    )?;
    for e in &derived.errors {
        error.execute(params![meta.key, e.seq, e.signature, e.message])?;
    }
    let mut failure =
        tx.prepare_cached("INSERT INTO failure_events(session_key,seq,pattern) VALUES(?1,?2,?3)")?;
    for (pattern, seq) in &derived.failures {
        failure.execute(params![meta.key, seq, pattern.as_str()])?;
    }
    let mut stack =
        tx.prepare_cached("INSERT INTO stack_hits(session_key,tech,weight) VALUES(?1,?2,?3)")?;
    for (tech, weight) in &derived.stack {
        stack.execute(params![meta.key, tech, weight])?;
    }
    Ok(())
}

pub type RemoteHostRecord = (String, bool, Option<i64>, Option<String>);

impl Store {
    pub fn open_existing_read_only(path: &Path) -> Result<Self> {
        anyhow::ensure!(path.is_file(), "no Ronda index at {}", path.display());
        let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        conn.query_row("SELECT count(*) FROM sessions", [], |row| {
            row.get::<_, i64>(0)
        })?;
        Ok(Self { conn })
    }

    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.execute_batch(
            "\
            CREATE TABLE IF NOT EXISTS sessions (\
                key TEXT PRIMARY KEY, meta TEXT NOT NULL, fingerprint TEXT NOT NULL,\
                source_path TEXT NOT NULL, agent TEXT NOT NULL, updated_at INTEGER NOT NULL\
            );\
            CREATE TABLE IF NOT EXISTS messages (\
                session_key TEXT NOT NULL, seq INTEGER NOT NULL, payload TEXT NOT NULL,\
                PRIMARY KEY(session_key,seq)\
            );\
            CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(\
                session_key UNINDEXED, seq UNINDEXED, text, tokenize='trigram'\
            );\
            CREATE TABLE IF NOT EXISTS user_data (\
                session_key TEXT PRIMARY KEY, starred INTEGER NOT NULL DEFAULT 0,\
                pinned INTEGER NOT NULL DEFAULT 0\
            );\
            CREATE TABLE IF NOT EXISTS tombstones (session_key TEXT PRIMARY KEY);\
            CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL);\
            CREATE TABLE IF NOT EXISTS remote_hosts (\
                host TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1,\
                last_sync_ms INTEGER, last_error TEXT\
            );\
            CREATE INDEX IF NOT EXISTS sessions_updated ON sessions(updated_at DESC);\
            CREATE INDEX IF NOT EXISTS messages_session ON messages(session_key);\
        ",
        )?;
        let mut store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    /// Brings derived tables up to `SCHEMA_VERSION`. Transcripts are kept; derived facts are rebuilt from them.
    fn migrate(&mut self) -> Result<()> {
        let version: i64 = self
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))?;
        self.conn.execute_batch(INTEL_SCHEMA)?;
        if version < SCHEMA_VERSION {
            self.rederive_all()?;
            self.conn
                .pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        Ok(())
    }

    /// Recomputes intelligence facts for every indexed session from its stored transcript.
    pub fn rederive_all(&mut self) -> Result<usize> {
        let keys: Vec<String> = self
            .conn
            .prepare("SELECT key FROM sessions")?
            .query_map([], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        for key in &keys {
            let (Some(meta), transcript) = (self.get_session(key)?, self.get_transcript(key)?)
            else {
                continue;
            };
            let tx = self.conn.transaction()?;
            write_facts(&tx, &meta, &transcript)?;
            tx.commit()?;
        }
        Ok(keys.len())
    }

    pub(crate) fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn default_path() -> PathBuf {
        if let Some(path) = std::env::var_os("RONDA_DB") {
            return PathBuf::from(path);
        }
        #[cfg(target_os = "macos")]
        {
            dirs::data_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join("ronda/ronda.db")
        }
        #[cfg(not(target_os = "macos"))]
        {
            dirs::data_local_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join("ronda/ronda.db")
        }
    }

    pub fn fingerprint(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT fingerprint FROM sessions WHERE key=?1",
                [key],
                |r| r.get(0),
            )
            .optional()?)
    }

    pub fn latest_activity(&self) -> Result<Option<i64>> {
        Ok(self
            .conn
            .query_row("SELECT MAX(updated_at) FROM sessions", [], |row| row.get(0))?)
    }

    pub fn is_tombstoned(&self, key: &str) -> Result<bool> {
        Ok(self
            .conn
            .query_row(
                "SELECT 1 FROM tombstones WHERE session_key=?1",
                [key],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    pub fn upsert(&mut self, parsed: &ParsedSession, fingerprint: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        let meta = &parsed.meta;
        tx.execute("INSERT INTO sessions(key,meta,fingerprint,source_path,agent,updated_at) VALUES(?1,?2,?3,?4,?5,?6) \
            ON CONFLICT(key) DO UPDATE SET meta=excluded.meta,fingerprint=excluded.fingerprint,source_path=excluded.source_path,agent=excluded.agent,updated_at=excluded.updated_at",
            params![meta.key, serde_json::to_string(meta)?, fingerprint, meta.source_path, meta.agent.as_str(), meta.updated_at])?;
        tx.execute("DELETE FROM messages WHERE session_key=?1", [&meta.key])?;
        tx.execute("DELETE FROM search_fts WHERE session_key=?1", [&meta.key])?;
        write_facts(&tx, meta, &parsed.messages)?;
        tx.execute(
            "INSERT INTO search_fts(session_key,seq,text) VALUES(?1,-1,?2)",
            params![meta.key, meta.title],
        )?;
        for message in &parsed.messages {
            tx.execute(
                "INSERT INTO messages(session_key,seq,payload) VALUES(?1,?2,?3)",
                params![meta.key, message.seq, serde_json::to_string(message)?],
            )?;
            let mut searchable = message.text.clone();
            for tool in &message.tool_calls {
                searchable.push(' ');
                searchable.push_str(&tool.name);
                if let Some(input) = &tool.input {
                    searchable.push(' ');
                    searchable.push_str(input);
                }
            }
            if !searchable.trim().is_empty() {
                tx.execute(
                    "INSERT INTO search_fts(session_key,seq,text) VALUES(?1,?2,?3)",
                    params![meta.key, message.seq, searchable],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    fn overlay_flags(&self, mut meta: SessionMeta) -> Result<SessionMeta> {
        if let Some((starred, pinned)) = self
            .conn
            .query_row(
                "SELECT starred,pinned FROM user_data WHERE session_key=?1",
                [&meta.key],
                |r| Ok((r.get::<_, bool>(0)?, r.get::<_, bool>(1)?)),
            )
            .optional()?
        {
            meta.starred = starred;
            meta.pinned = pinned;
        }
        Ok(meta)
    }

    pub fn get_session(&self, key: &str) -> Result<Option<SessionMeta>> {
        let json: Option<String> = self
            .conn
            .query_row("SELECT meta FROM sessions WHERE key=?1", [key], |r| {
                r.get(0)
            })
            .optional()?;
        json.map(|s| self.overlay_flags(serde_json::from_str(&s)?))
            .transpose()
    }

    pub fn get_transcript(&self, key: &str) -> Result<Vec<TranscriptMessage>> {
        let mut stmt = self
            .conn
            .prepare("SELECT payload FROM messages WHERE session_key=?1 ORDER BY seq")?;
        let rows = stmt
            .query_map([key], |r| r.get::<_, String>(0))?
            .map(|row| Ok(serde_json::from_str(&row?)?))
            .collect();
        rows
    }

    pub fn list_sessions(&self, filter: &SessionQuery) -> Result<Vec<SessionMeta>> {
        let mut stmt = self
            .conn
            .prepare("SELECT meta FROM sessions ORDER BY updated_at DESC")?;
        let mut sessions: Vec<SessionMeta> = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .map(|row| -> Result<_> { self.overlay_flags(serde_json::from_str(&row?)?) })
            .collect::<Result<_>>()?;
        sessions.retain(|m| {
            (filter.include_archived || !m.archived)
                && filter.agent.is_none_or(|agent| m.agent == agent)
                && filter
                    .project_path
                    .as_ref()
                    .is_none_or(|path| m.project_path.as_ref() == Some(path))
                && filter
                    .host
                    .as_ref()
                    .is_none_or(|host| m.host.as_ref() == Some(host))
                && (!filter.starred_only || m.starred)
        });
        sessions.sort_by(|a, b| {
            b.pinned
                .cmp(&a.pinned)
                .then(b.updated_at.cmp(&a.updated_at))
        });
        if let Some(limit) = filter.limit {
            sessions.truncate(limit);
        }
        Ok(sessions)
    }

    pub fn set_flags(&self, key: &str, starred: bool, pinned: bool) -> Result<()> {
        anyhow::ensure!(self.get_session(key)?.is_some(), "unknown session");
        self.conn.execute(
            "INSERT INTO user_data(session_key,starred,pinned) VALUES(?1,?2,?3) \
            ON CONFLICT(session_key) DO UPDATE SET starred=excluded.starred,pinned=excluded.pinned",
            params![key, starred, pinned],
        )?;
        Ok(())
    }

    pub fn tombstone(&mut self, key: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT OR IGNORE INTO tombstones(session_key) VALUES(?1)",
            [key],
        )?;
        tx.execute("DELETE FROM sessions WHERE key=?1", [key])?;
        tx.execute("DELETE FROM messages WHERE session_key=?1", [key])?;
        tx.execute("DELETE FROM search_fts WHERE session_key=?1", [key])?;
        clear_facts(&tx, key)?;
        tx.commit()?;
        Ok(())
    }

    pub fn prune_missing(&mut self, host: Option<&str>, seen: &HashSet<String>) -> Result<()> {
        let rows: Vec<(String, String)> = self
            .conn
            .prepare("SELECT key,meta FROM sessions")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let tx = self.conn.transaction()?;
        for (key, json) in rows {
            let meta: SessionMeta = serde_json::from_str(&json)?;
            if meta.host.as_deref() != host || seen.contains(&key) {
                continue;
            }
            tx.execute("DELETE FROM sessions WHERE key=?1", [&key])?;
            tx.execute("DELETE FROM messages WHERE session_key=?1", [&key])?;
            tx.execute("DELETE FROM search_fts WHERE session_key=?1", [&key])?;
            clear_facts(&tx, &key)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn search(
        &self,
        query: &str,
        filter: &SessionQuery,
        limit: usize,
    ) -> Result<Vec<SearchHit>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let terms: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
        let first = query.split_whitespace().next().unwrap_or(query);
        let indexed: Vec<&str> = query
            .split_whitespace()
            .filter(|term| term.chars().count() >= 3)
            .collect();
        let mut results = Vec::new();
        let mut stmt = if !indexed.is_empty() {
            self.conn.prepare("SELECT f.session_key,f.seq,f.text FROM search_fts f JOIN sessions s ON s.key=f.session_key WHERE search_fts MATCH ?1 ORDER BY s.updated_at DESC")?
        } else {
            self.conn.prepare("SELECT f.session_key,f.seq,f.text FROM search_fts f JOIN sessions s ON s.key=f.session_key WHERE instr(lower(f.text),lower(?1))>0 ORDER BY s.updated_at DESC")?
        };
        let match_query = if !indexed.is_empty() {
            indexed
                .iter()
                .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
                .collect::<Vec<_>>()
                .join(" AND ")
        } else {
            first.to_string()
        };
        let rows = stmt.query_map([match_query], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        for row in rows {
            let (key, seq, full) = row?;
            let haystack = full.to_lowercase();
            if !terms.iter().all(|term| haystack.contains(term)) {
                continue;
            }
            let Some(session) = self.get_session(&key)? else {
                continue;
            };
            if (!filter.include_archived && session.archived)
                || filter.agent.is_some_and(|a| session.agent != a)
                || filter
                    .project_path
                    .as_ref()
                    .is_some_and(|p| session.project_path.as_ref() != Some(p))
                || filter
                    .host
                    .as_ref()
                    .is_some_and(|h| session.host.as_ref() != Some(h))
                || (filter.starred_only && !session.starred)
            {
                continue;
            }
            let start = full.find(first).unwrap_or(0).saturating_sub(60);
            let start = full.floor_char_boundary(start);
            let end = full.ceil_char_boundary((start + 260).min(full.len()));
            let snippet = full[start..end].replace('\n', " ");
            results.push(SearchHit {
                session,
                seq,
                snippet,
            });
            if results.len() >= limit {
                break;
            }
        }
        results.sort_by_key(|hit| std::cmp::Reverse(hit.session.updated_at));
        Ok(results)
    }

    pub fn projects(&self) -> Result<Vec<ProjectInfo>> {
        let mut map: HashMap<String, ProjectInfo> = HashMap::new();
        for session in self.list_sessions(&SessionQuery::default())? {
            if session.parent_key.is_some() {
                continue;
            }
            if let Some(path) = session.project_path {
                let entry = map.entry(path.clone()).or_insert(ProjectInfo {
                    path,
                    session_count: 0,
                    updated_at: 0,
                });
                entry.session_count += 1;
                entry.updated_at = entry.updated_at.max(session.updated_at);
            }
        }
        let mut values: Vec<_> = map.into_values().collect();
        values.sort_by_key(|project| std::cmp::Reverse(project.updated_at));
        Ok(values)
    }

    pub fn insights(&self) -> Result<Insights> {
        let mut sessions = self.list_sessions(&SessionQuery {
            include_archived: true,
            ..Default::default()
        })?;
        sessions.retain(|session| session.parent_key.is_none());
        let mut agents = HashMap::<String, InsightRow>::new();
        let mut projects = HashMap::<String, InsightRow>::new();
        let mut models = HashMap::<String, InsightRow>::new();
        let mut activity = HashMap::<String, usize>::new();
        let mut hours = [0usize; 24];
        let mut prompts = 0;
        let mut tokens = 0;
        for session in &sessions {
            let messages = self.get_transcript(&session.key)?;
            let count = messages
                .iter()
                .filter(|m| matches!(m.role, crate::Role::User))
                .count();
            for message in messages
                .iter()
                .filter(|m| matches!(m.role, crate::Role::User))
            {
                let time = message
                    .timestamp
                    .and_then(chrono::DateTime::from_timestamp_millis)
                    .or_else(|| chrono::DateTime::from_timestamp_millis(session.updated_at));
                if let Some(time) = time {
                    let local = time.with_timezone(&chrono::Local);
                    *activity
                        .entry(local.format("%Y-%m-%d").to_string())
                        .or_default() += 1;
                    if message.timestamp.is_some() {
                        hours[local.format("%H").to_string().parse::<usize>()?] += 1;
                    }
                }
            }
            prompts += count;
            tokens += session.tokens.unwrap_or(0);
            for (map, label) in [
                (&mut agents, session.agent.as_str().to_string()),
                (
                    &mut projects,
                    session
                        .project_path
                        .clone()
                        .unwrap_or_else(|| "Unknown project".into()),
                ),
                (
                    &mut models,
                    session
                        .model
                        .clone()
                        .unwrap_or_else(|| "Unknown model".into()),
                ),
            ] {
                let row = map.entry(label.clone()).or_insert(InsightRow {
                    label,
                    sessions: 0,
                    prompts: 0,
                    tokens: 0,
                });
                row.sessions += 1;
                row.prompts += count;
                row.tokens += session.tokens.unwrap_or(0);
            }
        }
        let sorted = |map: HashMap<String, InsightRow>| {
            let mut rows: Vec<_> = map.into_values().collect();
            rows.sort_by_key(|row| std::cmp::Reverse(row.sessions));
            rows
        };
        let mut activity: Vec<_> = activity.into_iter().collect();
        activity.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(Insights {
            sessions: sessions.len(),
            prompts,
            tokens,
            activity,
            hours: hours
                .into_iter()
                .enumerate()
                .map(|(h, n)| (h as u8, n))
                .collect(),
            agents: sorted(agents),
            projects: sorted(projects),
            models: sorted(models),
        })
    }

    pub fn pref_get(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT value FROM prefs WHERE key=?1", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn pref_set(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute("INSERT INTO prefs(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,value])?;
        Ok(())
    }

    pub fn remote_hosts(&self) -> Result<Vec<RemoteHostRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT host,enabled,last_sync_ms,last_error FROM remote_hosts ORDER BY host",
        )?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    pub fn set_remote_host(&self, host: &str, enabled: bool) -> Result<()> {
        anyhow::ensure!(
            !host.is_empty()
                && !host.starts_with('-')
                && host
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "@._-".contains(c)),
            "invalid SSH host"
        );
        self.conn.execute("INSERT INTO remote_hosts(host,enabled) VALUES(?1,?2) ON CONFLICT(host) DO UPDATE SET enabled=excluded.enabled", params![host,enabled])?;
        Ok(())
    }

    pub fn remove_remote_host(&self, host: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM remote_hosts WHERE host=?1", [host])?;
        Ok(())
    }

    pub fn record_remote_sync(&self, host: &str, error: Option<&str>) -> Result<()> {
        self.conn.execute(
            "UPDATE remote_hosts SET last_sync_ms=?2,last_error=?3 WHERE host=?1",
            params![host, chrono::Utc::now().timestamp_millis(), error],
        )?;
        Ok(())
    }

    pub fn open_read_only(path: &Path) -> Result<Connection> {
        Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .with_context(|| format!("opening {} read-only", path.display()))
    }
}
