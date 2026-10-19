use crate::Store;
use anyhow::{bail, ensure, Result};
use rusqlite::params;
use serde::Serialize;

pub const MAX_LABELS: usize = 12;
pub const MAX_LABELS_PER_SESSION: usize = 4;
const MAX_NAME_CHARS: usize = 40;
const MAX_NAME_BYTES: usize = 160;

// User annotations must never cascade from the rebuildable session index.
pub(crate) const SCHEMA: &str = "\
CREATE TABLE IF NOT EXISTS session_label_defs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS session_label_map (
    session_key TEXT NOT NULL, label_id TEXT NOT NULL,
    PRIMARY KEY(session_key, label_id)
);";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SessionLabel {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Label ids are 32 lowercase hex characters, matching the generated ids.
pub fn valid_label_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn clean_name(name: &str) -> Result<String> {
    let name = name.trim();
    ensure!(!name.is_empty(), "Enter a label name");
    ensure!(
        name.chars().count() <= MAX_NAME_CHARS && name.len() <= MAX_NAME_BYTES,
        "Label names are limited to 40 characters"
    );
    ensure!(
        !name.chars().any(char::is_control),
        "Label names cannot contain control characters"
    );
    Ok(name.to_string())
}

impl Store {
    /// Fails closed on malformed rows instead of silently dropping them.
    pub fn list_labels(&self) -> Result<Vec<SessionLabel>> {
        let mut stmt = self.conn().prepare(
            "SELECT id,name,created_at,updated_at FROM session_label_defs ORDER BY created_at,id",
        )?;
        let labels = stmt
            .query_map([], |row| {
                Ok(SessionLabel {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for label in &labels {
            ensure!(
                valid_label_id(&label.id) && clean_name(&label.name).is_ok_and(|n| n == label.name),
                "The label catalog contains an invalid entry"
            );
        }
        Ok(labels)
    }

    fn name_taken(&self, name: &str, except: Option<&str>) -> Result<bool> {
        let folded = name.to_lowercase();
        Ok(self
            .list_labels()?
            .iter()
            .any(|label| Some(label.id.as_str()) != except && label.name.to_lowercase() == folded))
    }

    pub fn create_label(&self, name: &str) -> Result<SessionLabel> {
        let name = clean_name(name)?;
        ensure!(
            self.list_labels()?.len() < MAX_LABELS,
            "You can have at most 12 labels"
        );
        ensure!(
            !self.name_taken(&name, None)?,
            "A label with that name already exists"
        );
        let now = chrono::Utc::now().timestamp_millis();
        let id: String = self
            .conn()
            .query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))?;
        self.conn().execute(
            "INSERT INTO session_label_defs(id,name,created_at,updated_at) VALUES(?1,?2,?3,?3)",
            params![id, name, now],
        )?;
        Ok(SessionLabel {
            id,
            name,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn rename_label(&self, id: &str, name: &str) -> Result<SessionLabel> {
        let name = clean_name(name)?;
        let Some(existing) = self.list_labels()?.into_iter().find(|label| label.id == id) else {
            bail!("That label no longer exists");
        };
        ensure!(
            !self.name_taken(&name, Some(id))?,
            "A label with that name already exists"
        );
        let now = chrono::Utc::now()
            .timestamp_millis()
            .max(existing.created_at);
        self.conn().execute(
            "UPDATE session_label_defs SET name=?2,updated_at=?3 WHERE id=?1",
            params![id, name, now],
        )?;
        Ok(SessionLabel {
            name,
            updated_at: now,
            ..existing
        })
    }

    /// Removes the label and unassigns it from every session.
    pub fn delete_label(&self, id: &str) -> Result<()> {
        let tx = self.conn().unchecked_transaction()?;
        tx.execute("DELETE FROM session_label_map WHERE label_id=?1", [id])?;
        tx.execute("DELETE FROM session_label_defs WHERE id=?1", [id])?;
        tx.commit()?;
        Ok(())
    }

    pub fn set_session_label(&self, key: &str, label_id: &str, assigned: bool) -> Result<()> {
        if !assigned {
            self.conn().execute(
                "DELETE FROM session_label_map WHERE session_key=?1 AND label_id=?2",
                params![key, label_id],
            )?;
            return Ok(());
        }
        ensure!(self.get_session(key)?.is_some(), "unknown session");
        ensure!(
            self.list_labels()?.iter().any(|label| label.id == label_id),
            "That label no longer exists"
        );
        let assigned_already: bool = self.conn().query_row(
            "SELECT EXISTS(SELECT 1 FROM session_label_map WHERE session_key=?1 AND label_id=?2)",
            params![key, label_id],
            |row| row.get(0),
        )?;
        if assigned_already {
            return Ok(());
        }
        ensure!(
            self.session_labels(key)?.len() < MAX_LABELS_PER_SESSION,
            "A session can have at most 4 labels"
        );
        self.conn().execute(
            "INSERT INTO session_label_map(session_key,label_id) VALUES(?1,?2)",
            params![key, label_id],
        )?;
        Ok(())
    }

    /// Assigned label ids in catalog order. Map rows without a definition are ignored.
    pub(crate) fn session_labels(&self, key: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn().prepare_cached(
            "SELECT d.id FROM session_label_map m JOIN session_label_defs d ON d.id=m.label_id \
             WHERE m.session_key=?1 ORDER BY d.created_at,d.id",
        )?;
        let ids = stmt
            .query_map([key], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(ids)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ParsedSession, SearchSort, SessionQuery};
    use std::collections::HashSet;
    use std::path::Path;

    fn parsed(key: &str, project: &str, text: &str) -> ParsedSession {
        serde_json::from_value(serde_json::json!({
            "meta":{"key":key,"native_id":key,"agent":"claude-code","host":null,"parent_key":null,
                "title":"Label sample","project_path":project,"source_path":"/missing-fixture","created_at":0,"updated_at":1,
                "model":null,"source":null,"tokens":null,"archived":false,"metadata_only":false,"can_delete":true},
            "messages":[{"seq":0,"role":"assistant","kind":"text","text":text,"timestamp":null,"model":null,"thinking":null,"tool_calls":[],"images":[]}]
        })).unwrap()
    }

    fn store() -> Store {
        Store::open(Path::new(":memory:")).unwrap()
    }

    fn keys(store: &Store, filter: &SessionQuery) -> Vec<String> {
        let mut keys: Vec<_> = store
            .list_sessions(filter)
            .unwrap()
            .into_iter()
            .map(|s| s.key)
            .collect();
        keys.sort();
        keys
    }

    #[test]
    fn catalog_crud_enforces_names_and_caps() {
        let store = store();
        let first = store.create_label("  Needs review  ").unwrap();
        assert_eq!(first.name, "Needs review");
        assert!(valid_label_id(&first.id));
        for bad in ["", "   ", &"x".repeat(41), &"🙂".repeat(41), "tab\there"] {
            assert!(store.create_label(bad).is_err(), "{bad:?}");
        }
        assert!(store.create_label(&"é".repeat(40)).is_ok());
        assert!(store.create_label("NEEDS REVIEW").is_err());
        let other = store.create_label("Keep").unwrap();
        assert!(store.rename_label(&other.id, "needs review").is_err());
        assert!(store.rename_label(&other.id, "").is_err());
        let renamed = store.rename_label(&first.id, "NEEDS review").unwrap();
        assert_eq!(
            (renamed.name.as_str(), renamed.id.as_str()),
            ("NEEDS review", first.id.as_str())
        );
        assert!(store.rename_label(&"0".repeat(32), "Ghost").is_err());
        for index in store.list_labels().unwrap().len()..MAX_LABELS {
            store.create_label(&format!("Label {index}")).unwrap();
        }
        assert!(store.create_label("One too many").is_err());
        assert_eq!(store.list_labels().unwrap().len(), MAX_LABELS);
        store.delete_label(&other.id).unwrap();
        assert_eq!(store.list_labels().unwrap().len(), MAX_LABELS - 1);
        assert!(store.create_label("Keep").is_ok());
    }

    #[test]
    fn assignment_caps_filters_and_deletes_unassign() {
        let mut store = store();
        store
            .upsert(&parsed("a", "/one", "alpha needle"), "1")
            .unwrap();
        store
            .upsert(&parsed("b", "/two", "beta needle"), "1")
            .unwrap();
        let labels: Vec<_> = (0..5)
            .map(|index| store.create_label(&format!("L{index}")).unwrap())
            .collect();
        assert!(store
            .set_session_label("missing", &labels[0].id, true)
            .is_err());
        assert!(store.set_session_label("a", &"f".repeat(32), true).is_err());
        for label in &labels[..4] {
            store.set_session_label("a", &label.id, true).unwrap();
        }
        store.set_session_label("a", &labels[0].id, true).unwrap(); // idempotent at the cap
        assert!(store.set_session_label("a", &labels[4].id, true).is_err());
        assert_eq!(store.get_session("a").unwrap().unwrap().labels.len(), 4);
        store.set_session_label("b", &labels[0].id, true).unwrap();
        store.set_flags("b", true, false).unwrap();

        let by = |id: &str| SessionQuery {
            label_id: Some(id.into()),
            ..Default::default()
        };
        assert_eq!(keys(&store, &by(&labels[0].id)), ["a", "b"]);
        assert_eq!(keys(&store, &by(&labels[1].id)), ["a"]);
        assert!(keys(&store, &by(&labels[4].id)).is_empty());
        assert!(keys(&store, &by(&"9".repeat(32))).is_empty());
        assert_eq!(keys(&store, &SessionQuery::default()), ["a", "b"]);
        let combined = SessionQuery {
            starred_only: true,
            ..by(&labels[0].id)
        };
        assert_eq!(keys(&store, &combined), ["b"]);
        let combined = SessionQuery {
            project_path: Some("/one".into()),
            ..by(&labels[0].id)
        };
        assert_eq!(keys(&store, &combined), ["a"]);
        let page = store.session_page(&by(&labels[1].id), 0, 10).unwrap();
        assert_eq!((page.total, page.items[0].labels.len()), (1, 4));

        let grouped = store
            .search_grouped("needle", &by(&labels[0].id), SearchSort::Recent, 0, 10)
            .unwrap();
        assert_eq!(grouped.total_sessions, 2);
        let grouped = store
            .search_grouped(
                "needle",
                &SessionQuery {
                    starred_only: true,
                    ..by(&labels[0].id)
                },
                SearchSort::Recent,
                0,
                10,
            )
            .unwrap();
        assert_eq!(grouped.groups[0].session.key, "b");
        assert_eq!(grouped.groups[0].session.labels, vec![labels[0].id.clone()]);
        assert_eq!(
            store
                .search("needle", &by(&labels[1].id), 10)
                .unwrap()
                .len(),
            1
        );
        assert!(store
            .search_grouped("needle", &by(&labels[4].id), SearchSort::Recent, 0, 10)
            .unwrap()
            .groups
            .is_empty());

        store.set_session_label("a", &labels[1].id, false).unwrap();
        assert!(keys(&store, &by(&labels[1].id)).is_empty());
        store.delete_label(&labels[0].id).unwrap();
        assert!(keys(&store, &by(&labels[0].id)).is_empty());
        assert_eq!(store.get_session("b").unwrap().unwrap().labels.len(), 0);
        let count: i64 = store
            .conn()
            .query_row(
                "SELECT count(*) FROM session_label_map WHERE label_id=?1",
                [&labels[0].id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn query_without_label_id_deserializes_and_matches_as_before() {
        let old: SessionQuery =
            serde_json::from_str(r#"{"agent":null,"starred_only":false}"#).unwrap();
        assert!(old.label_id.is_none());
        let with: SessionQuery = serde_json::from_str(r#"{"label_id":"abc"}"#).unwrap();
        assert_eq!(with.label_id.as_deref(), Some("abc"));
    }

    #[test]
    fn labels_persist_across_reindex_rebuild_prune_and_session_delete_without_cascade() {
        let path = std::env::temp_dir().join(format!(
            "ronda-labels-{}-{}.db",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        let label_id;
        {
            let mut store = Store::open(&path).unwrap();
            store.upsert(&parsed("a", "/one", "first"), "1").unwrap();
            store.upsert(&parsed("gone", "/one", "first"), "1").unwrap();
            label_id = store.create_label("Keeper").unwrap().id;
            store.set_session_label("a", &label_id, true).unwrap();
            store.set_session_label("gone", &label_id, true).unwrap();
        }
        let mut store = Store::open(&path).unwrap();
        store
            .upsert(&parsed("a", "/one", "rescanned"), "2")
            .unwrap();
        assert_eq!(
            store.get_session("a").unwrap().unwrap().labels,
            vec![label_id.clone()]
        );
        assert_eq!(store.rederive_all().unwrap(), 2);
        assert_eq!(
            store.get_session("a").unwrap().unwrap().labels,
            vec![label_id.clone()]
        );
        store
            .prune_missing(None, &HashSet::from(["a".to_string()]))
            .unwrap();
        assert!(store.get_session("gone").unwrap().is_none());
        store.tombstone("a").unwrap();
        let orphans: i64 = store
            .conn()
            .query_row("SELECT count(*) FROM session_label_map", [], |r| r.get(0))
            .unwrap();
        assert_eq!(orphans, 2);
        assert_eq!(store.list_labels().unwrap().len(), 1);
        drop(store);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn bookmark_rows_follow_session_labels() {
        let mut store = store();
        store.upsert(&parsed("a", "/one", "alpha"), "1").unwrap();
        store.upsert(&parsed("b", "/one", "beta"), "1").unwrap();
        for key in ["a", "b"] {
            store.save_bookmark(key, 0, "note", false, None).unwrap();
        }
        let label = store.create_label("Pick").unwrap();
        store.set_session_label("a", &label.id, true).unwrap();
        let filter = SessionQuery {
            label_id: Some(label.id.clone()),
            ..Default::default()
        };
        let views = store.list_bookmarks("", &filter).unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].bookmark.session_key, "a");
        assert_eq!(
            store
                .list_bookmarks("", &SessionQuery::default())
                .unwrap()
                .len(),
            2
        );
        let backup = serde_json::to_string(&store.export_bookmarks().unwrap()).unwrap();
        assert!(!backup.contains("Pick") && !backup.contains(&label.id));
    }

    #[test]
    fn malformed_rows_fail_closed() {
        let store = store();
        store
            .conn()
            .execute(
                "INSERT INTO session_label_defs VALUES('not-an-id','x',1,1)",
                [],
            )
            .unwrap();
        assert!(store.list_labels().is_err());
        assert!(store.create_label("Fresh").is_err());
        store
            .conn()
            .execute("DELETE FROM session_label_defs", [])
            .unwrap();
        store
            .conn()
            .execute(
                "INSERT INTO session_label_defs VALUES(?1,'   ',1,1)",
                [&"a".repeat(32)],
            )
            .unwrap();
        assert!(store.list_labels().is_err());
    }
}
