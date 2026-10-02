use crate::{SessionMeta, Store};
use anyhow::{ensure, Result};
use rusqlite::params;
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};

#[derive(Debug, Serialize)]
pub struct RelatedSession {
    pub session: SessionMeta,
    pub shared_errors: usize,
    pub shared_files: usize,
    pub explanation: &'static str,
}

#[derive(Debug, Serialize)]
pub struct SessionRelationships {
    pub parent: Option<SessionMeta>,
    pub children: Vec<SessionMeta>,
    pub related: Vec<RelatedSession>,
    pub candidate_limit: usize,
}

/// Compare recorded paths lexically, including remote Windows paths, without filesystem access.
fn relative_file(path: &str, project: &str) -> Option<String> {
    let path = path.replace('\\', "/");
    let project = project.replace('\\', "/");
    let project = project.trim_end_matches('/');
    let relative = if path.starts_with('/') || path.as_bytes().get(1) == Some(&b':') {
        path.strip_prefix(&format!("{project}/"))?
    } else {
        &path
    };
    let mut parts = Vec::new();
    for part in relative.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            _ => parts.push(part),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

impl Store {
    /// Includes indexed children hidden by the normal root-session library, using the CLI's legacy keys.
    pub fn session_children(&self, main: &SessionMeta) -> Result<Vec<SessionMeta>> {
        let legacy = format!("{}:{}", main.agent.as_str(), main.native_id);
        let mut stmt = self.conn().prepare(
            "SELECT key FROM sessions WHERE json_extract(meta,'$.host') IS ?1 AND \
             json_extract(meta,'$.parent_key') IN (?2,?3) AND key<>?2 ORDER BY json_extract(meta,'$.native_id'),key",
        )?;
        let keys = stmt
            .query_map(params![main.host, main.key, legacy], |r| {
                r.get::<_, String>(0)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        keys.into_iter()
            .map(|key| self.get_session(&key))
            .collect::<Result<Vec<_>>>()
            .map(|rows| rows.into_iter().flatten().collect())
    }

    pub fn session_relationships(&self, key: &str) -> Result<SessionRelationships> {
        ensure!(
            !key.is_empty() && key.chars().count() <= 4096,
            "Choose a valid session key"
        );
        let main = self
            .get_session(key)?
            .ok_or_else(|| anyhow::anyhow!("Unknown session"))?;
        let parent = if let Some(parent_key) = main.parent_key.as_ref().filter(|p| *p != key) {
            let mut stmt = self.conn().prepare(
                "SELECT key FROM sessions WHERE json_extract(meta,'$.host') IS ?1 AND \
                 (key=?2 OR json_extract(meta,'$.agent') || ':' || json_extract(meta,'$.native_id')=?2) \
                 ORDER BY (key=?2) DESC,key LIMIT 2",
            )?;
            let keys = stmt
                .query_map(params![main.host, parent_key], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            match keys.as_slice() {
                [one] => self.get_session(one)?,
                [first, _] if first == parent_key => self.get_session(first)?,
                _ => None,
            }
        } else {
            None
        };
        let children = self.session_children(&main)?;
        let candidate_limit = 512;
        let mut related = Vec::new();
        if let Some(project) = main.project_path.as_deref().filter(|p| !p.is_empty()) {
            let errors = self.related_errors(key)?;
            let files = self.related_files(key, project)?;
            let files_json = serde_json::to_string(&files)?;
            let root = format!("{}/", project.replace('\\', "/").trim_end_matches('/'));
            // ponytail: rank at most 512 indexed project/host candidates; move lexical path normalization into an indexed column if measured recall or latency needs more.
            let mut stmt = self.conn().prepare(
                "WITH error_scores AS (SELECT e.session_key,count(DISTINCT e.signature) n FROM error_events e \
                 JOIN sessions s ON s.key=e.session_key WHERE e.signature IN (SELECT signature FROM error_events WHERE session_key=?1) \
                 AND json_extract(s.meta,'$.project_path')=?2 AND json_extract(s.meta,'$.host') IS ?3 GROUP BY e.session_key), \
                 file_scores AS (SELECT t.session_key,count(DISTINCT replace(t.path,char(92),'/')) n FROM tool_events t \
                 JOIN sessions s ON s.key=t.session_key WHERE t.kind IN ('read','edit') \
                 AND json_extract(s.meta,'$.project_path')=?2 AND json_extract(s.meta,'$.host') IS ?3 \
                 AND (replace(t.path,char(92),'/') IN (SELECT value FROM json_each(?4)) \
                   OR replace(t.path,char(92),'/') IN (SELECT ?5 || value FROM json_each(?4))) GROUP BY t.session_key) \
                 SELECT s.meta FROM sessions s LEFT JOIN error_scores e ON e.session_key=s.key LEFT JOIN file_scores f ON f.session_key=s.key \
                 WHERE s.key<>?1 AND json_extract(s.meta,'$.project_path')=?2 AND json_extract(s.meta,'$.host') IS ?3 \
                 AND json_extract(s.meta,'$.parent_key') IS NULL \
                 ORDER BY coalesce(e.n,0) DESC,coalesce(f.n,0) DESC,s.updated_at DESC,s.key LIMIT ?6",
            )?;
            let candidates = stmt
                .query_map(
                    params![
                        key,
                        project,
                        main.host,
                        files_json,
                        root,
                        candidate_limit as i64
                    ],
                    |r| r.get::<_, String>(0),
                )?
                .collect::<rusqlite::Result<Vec<_>>>()?
                .into_iter()
                .map(|json| serde_json::from_str::<SessionMeta>(&json))
                .collect::<serde_json::Result<Vec<_>>>()?;
            let keys_json =
                serde_json::to_string(&candidates.iter().map(|s| &s.key).collect::<Vec<_>>())?;
            let mut signals: HashMap<String, (BTreeSet<String>, BTreeSet<String>)> = HashMap::new();
            let mut stmt = self.conn().prepare("SELECT session_key,'error',signature FROM error_events WHERE session_key IN (SELECT value FROM json_each(?1)) UNION ALL SELECT session_key,'file',path FROM tool_events WHERE session_key IN (SELECT value FROM json_each(?1)) AND kind IN ('read','edit') AND path IS NOT NULL")?;
            let rows = stmt.query_map([keys_json], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?;
            for row in rows {
                let (key, kind, value) = row?;
                let (other_errors, other_files) = signals.entry(key).or_default();
                if kind == "error" {
                    other_errors.insert(value);
                } else if let Some(path) = relative_file(&value, project) {
                    other_files.insert(path);
                }
            }
            for session in candidates {
                let (other_errors, other_files) = signals.remove(&session.key).unwrap_or_default();
                let shared_errors = errors.intersection(&other_errors).count();
                let shared_files = files.intersection(&other_files).count();
                related.push(RelatedSession {
                    session,
                    shared_errors,
                    shared_files,
                    explanation: if shared_errors > 0 {
                        "Shared error"
                    } else if shared_files > 0 {
                        "Shared files"
                    } else {
                        "Same project"
                    },
                });
            }
            related.sort_by(|a, b| {
                b.shared_errors
                    .cmp(&a.shared_errors)
                    .then(b.shared_files.cmp(&a.shared_files))
                    .then(b.session.updated_at.cmp(&a.session.updated_at))
                    .then(a.session.key.cmp(&b.session.key))
            });
            related.truncate(5);
            for row in &mut related {
                if let Some(current) = self.get_session(&row.session.key)? {
                    row.session = current;
                }
            }
        }
        Ok(SessionRelationships {
            parent,
            children,
            related,
            candidate_limit,
        })
    }

    fn related_errors(&self, key: &str) -> Result<BTreeSet<String>> {
        let mut stmt = self
            .conn()
            .prepare("SELECT DISTINCT signature FROM error_events WHERE session_key=?1")?;
        let rows = stmt
            .query_map([key], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    fn related_files(&self, key: &str, project: &str) -> Result<BTreeSet<String>> {
        let mut stmt = self.conn().prepare("SELECT DISTINCT path FROM tool_events WHERE session_key=?1 AND kind IN ('read','edit') AND path IS NOT NULL")?;
        let paths = stmt
            .query_map([key], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(paths
            .iter()
            .filter_map(|p| relative_file(p, project))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AgentId;
    use std::time::Instant;

    #[test]
    fn relationships_scope_rank_paths_and_large_project() {
        assert_eq!(
            relative_file(r"C:\repo\src\a.rs", r"C:\repo"),
            Some("src/a.rs".into())
        );
        assert_eq!(
            relative_file("./src/../src/a.rs", "/repo"),
            Some("src/a.rs".into())
        );
        assert_eq!(relative_file("../outside", "/repo"), None);
        assert_eq!(relative_file("/repo-other/src/a.rs", "/repo"), None);
        assert_eq!(
            relative_file(r"\\server\share\repo\a", r"\\server\share\repo"),
            Some("a".into())
        );
        let path = std::env::temp_dir().join(format!("ronda-related-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut db = Store::open(&path).unwrap();
        let base = SessionMeta {
            key: "codex:parent".into(),
            native_id: "parent".into(),
            agent: AgentId::Codex,
            host: None,
            parent_key: None,
            title: "Parent".into(),
            project_path: Some("/repo".into()),
            source_path: "synthetic".into(),
            created_at: 1,
            updated_at: 1,
            model: None,
            source: None,
            tokens: None,
            archived: false,
            metadata_only: false,
            can_delete: false,
            starred: false,
            pinned: false,
        };
        db.conn().execute_batch("BEGIN").unwrap();
        let insert = |meta: &SessionMeta| {
            db.conn().execute("INSERT INTO sessions(key,meta,updated_at,fingerprint,source_path,agent) VALUES(?1,?2,?3,'fixture','synthetic','codex')",
                params![meta.key, serde_json::to_string(meta).unwrap(), meta.updated_at]).unwrap();
        };
        insert(&base);
        for i in 0..5000 {
            let mut meta = base.clone();
            meta.key = format!("codex:recent-{i:04}");
            meta.native_id = format!("recent-{i}");
            meta.updated_at = i + 2;
            insert(&meta);
        }
        for (key, parent, host, project) in [
            ("codex:child-a", Some("codex:parent"), None, "/repo"),
            ("codex:child-b", Some("codex:parent"), None, "/repo"),
            ("remote:codex:parent", None, Some("local"), "/repo"),
            (
                "remote:codex:child",
                Some("codex:parent"),
                Some("local"),
                "/repo",
            ),
            ("codex:orphan", Some("codex:absent"), None, "/repo"),
            ("codex:error", None, None, "/repo"),
            ("codex:files", None, None, "/repo"),
            ("codex:outside", None, None, "/elsewhere"),
        ] {
            let mut meta = base.clone();
            meta.key = key.into();
            meta.native_id = key.rsplit(':').next().unwrap().into();
            meta.title = String::new();
            meta.parent_key = parent.map(str::to_owned);
            meta.host = host.map(str::to_owned);
            meta.project_path = Some(project.into());
            insert(&meta);
        }
        for key in [
            "codex:parent",
            "codex:error",
            "remote:codex:parent",
            "codex:outside",
        ] {
            db.conn()
                .execute(
                    "INSERT INTO error_events VALUES(?1,7,'same','Error: synthetic')",
                    [key],
                )
                .unwrap();
        }
        for (key, file) in [
            ("codex:parent", "/repo/src/a.rs"),
            ("codex:files", r"src\a.rs"),
            ("codex:error", "./src/a.rs"),
            ("codex:outside", "/repo/src/a.rs"),
        ] {
            db.conn()
                .execute(
                    "INSERT INTO tool_events VALUES(?1,1,'read',NULL,?2,0,NULL)",
                    params![key, file],
                )
                .unwrap();
        }
        db.conn().execute_batch("COMMIT").unwrap();
        let result = db.session_relationships(&base.key).unwrap();
        assert_eq!(result.children.len(), 2);
        assert!(result.parent.is_none());
        assert_eq!(result.related.len(), 5);
        assert_eq!(result.related[0].session.key, "codex:error");
        assert_eq!(result.related[0].shared_errors, 1);
        assert_eq!(result.related[0].shared_files, 1);
        assert_eq!(result.related[1].session.key, "codex:files");
        assert_eq!(result.related[1].explanation, "Shared files");
        assert_eq!(result.related[2].session.key, "codex:recent-4999");
        assert_eq!(result.related[2].explanation, "Same project");
        assert_eq!(
            db.session_relationships("codex:child-a")
                .unwrap()
                .parent
                .unwrap()
                .key,
            base.key
        );
        assert_eq!(
            db.session_relationships("remote:codex:child")
                .unwrap()
                .parent
                .unwrap()
                .key,
            "remote:codex:parent"
        );
        assert!(db
            .session_relationships("codex:orphan")
            .unwrap()
            .parent
            .is_none());
        assert!(db.session_relationships("missing").is_err());
        let mut timings = Vec::new();
        for _ in 0..20 {
            let start = Instant::now();
            db.session_relationships(&base.key).unwrap();
            timings.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        timings.sort_by(f64::total_cmp);
        eprintln!(
            "Related sessions, 5,000 project roots: p95 {:.2} ms",
            timings[18]
        );
        assert!(timings[18] < 100.0, "tighten candidate SQL before release");
        db.tombstone("codex:error").unwrap();
        db.tombstone("codex:child-b").unwrap();
        let refreshed = db.session_relationships(&base.key).unwrap();
        assert_eq!(refreshed.children.len(), 1);
        assert!(refreshed
            .related
            .iter()
            .all(|r| r.session.key != "codex:error"));
        drop(db);
        let _ = std::fs::remove_file(path);
    }
}
