use crate::{AgentId, SessionMeta, SessionQuery, Store, TranscriptMessage};
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

// User annotations must never cascade from the rebuildable session index.
pub(crate) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS message_bookmarks (
    session_key TEXT NOT NULL, seq INTEGER NOT NULL CHECK(seq >= 0),
    note TEXT NOT NULL, excerpt TEXT NOT NULL, text_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    title TEXT NOT NULL, agent TEXT NOT NULL, project_path TEXT,
    PRIMARY KEY(session_key, seq)
);";
const COLUMNS: &str =
    "session_key,seq,note,excerpt,text_hash,created_at,updated_at,title,agent,project_path";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MessageBookmark {
    pub session_key: String,
    pub seq: i64,
    pub note: String,
    pub excerpt: String,
    pub text_hash: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub title: String,
    pub agent: AgentId,
    pub project_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BookmarkStatus {
    Current,
    Changed,
    Unavailable,
}

#[derive(Debug, Serialize)]
pub struct BookmarkView {
    pub bookmark: MessageBookmark,
    pub session: Option<SessionMeta>,
    pub status: BookmarkStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BookmarkBackup {
    pub version: u32,
    pub bookmarks: Vec<MessageBookmark>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BookmarkReplacement {
    pub session_key: String,
    pub seq: i64,
    pub expected_updated_at: i64,
}

#[derive(Debug, Serialize)]
pub struct BookmarkConflict {
    pub existing: MessageBookmark,
    pub incoming: MessageBookmark,
}

#[derive(Debug, Default, Serialize)]
pub struct BookmarkImport {
    pub imported: usize,
    pub unchanged: usize,
    pub conflicts: Vec<BookmarkConflict>,
}

fn same_content(left: &MessageBookmark, right: &MessageBookmark) -> bool {
    left.session_key == right.session_key
        && left.seq == right.seq
        && left.note == right.note
        && left.excerpt == right.excerpt
        && left.text_hash == right.text_hash
        && left.title == right.title
        && left.agent == right.agent
        && left.project_path == right.project_path
}

fn hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

fn row(row: &Row<'_>) -> rusqlite::Result<MessageBookmark> {
    let agent: String = row.get(8)?;
    let agent = serde_json::from_value(serde_json::Value::String(agent)).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(8, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(MessageBookmark {
        session_key: row.get(0)?,
        seq: row.get(1)?,
        note: row.get(2)?,
        excerpt: row.get(3)?,
        text_hash: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        title: row.get(7)?,
        agent,
        project_path: row.get(9)?,
    })
}

fn get(conn: &Connection, key: &str, seq: i64) -> Result<Option<MessageBookmark>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM message_bookmarks WHERE session_key=?1 AND seq=?2"),
            params![key, seq],
            row,
        )
        .optional()?)
}
fn write(conn: &Connection, bookmark: &MessageBookmark) -> Result<()> {
    conn.execute(&format!("INSERT INTO message_bookmarks ({COLUMNS}) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
        ON CONFLICT(session_key,seq) DO UPDATE SET note=excluded.note,excerpt=excluded.excerpt,text_hash=excluded.text_hash,
        created_at=excluded.created_at,updated_at=excluded.updated_at,title=excluded.title,agent=excluded.agent,project_path=excluded.project_path"),
        params![bookmark.session_key,bookmark.seq,bookmark.note,bookmark.excerpt,bookmark.text_hash,bookmark.created_at,
            bookmark.updated_at,bookmark.title,bookmark.agent.as_str(),bookmark.project_path])?;
    Ok(())
}

impl BookmarkBackup {
    pub fn parse(json: &str) -> Result<Self> {
        let backup: Self = serde_json::from_str(json).context("Invalid bookmark backup JSON")?;
        backup.validate()?;
        Ok(backup)
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(self.version == 1, "Unsupported bookmark backup version");
        let mut keys = HashSet::new();
        for bookmark in &self.bookmarks {
            ensure!(
                !bookmark.session_key.is_empty()
                    && bookmark.session_key.len() <= 512
                    && bookmark.seq >= 0,
                "Invalid bookmark identity"
            );
            ensure!(
                keys.insert((&bookmark.session_key, bookmark.seq)),
                "Duplicate bookmark identity"
            );
            ensure!(
                bookmark.note.chars().count() <= 4000 && bookmark.excerpt.chars().count() <= 500,
                "Bookmark note or excerpt exceeds its limit"
            );
            ensure!(
                bookmark.text_hash.len() == 64
                    && bookmark
                        .text_hash
                        .bytes()
                        .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
                "Invalid message SHA-256"
            );
            ensure!(
                bookmark.created_at >= 0
                    && bookmark.updated_at >= bookmark.created_at
                    && chrono::DateTime::from_timestamp_millis(bookmark.updated_at).is_some(),
                "Invalid bookmark timestamps"
            );
            ensure!(
                bookmark.title.chars().count() <= 1000
                    && bookmark
                        .project_path
                        .as_ref()
                        .is_none_or(|path| path.len() <= 4096),
                "Bookmark session snapshot exceeds its limit"
            );
        }
        Ok(())
    }
}

impl Store {
    fn bookmark_message(&self, key: &str, seq: i64) -> Result<Option<TranscriptMessage>> {
        let json: Option<String> = self
            .conn()
            .query_row(
                "SELECT payload FROM messages WHERE session_key=?1 AND seq=?2",
                params![key, seq],
                |row| row.get(0),
            )
            .optional()?;
        json.map(|json| serde_json::from_str(&json).map_err(Into::into))
            .transpose()
    }
    pub fn save_bookmark(
        &self,
        key: &str,
        seq: i64,
        note: &str,
        refresh_snapshot: bool,
        expected_updated_at: Option<i64>,
    ) -> Result<MessageBookmark> {
        ensure!(
            seq >= 0 && note.chars().count() <= 4000,
            "Notes are limited to 4,000 characters"
        );
        let tx = self.conn().unchecked_transaction()?;
        let existing = get(&tx, key, seq)?;
        if let Some(existing) = &existing {
            // A repeated bookmark click must not erase an existing note.
            if expected_updated_at.is_none() && note.is_empty() && !refresh_snapshot {
                return Ok(existing.clone());
            }
            ensure!(
                expected_updated_at == Some(existing.updated_at),
                "Bookmark changed; reload it before saving"
            );
        } else {
            ensure!(expected_updated_at.is_none(), "Bookmark no longer exists");
        }
        let now = chrono::Utc::now().timestamp_millis().max(
            existing
                .as_ref()
                .map_or(0, |bookmark| bookmark.updated_at.saturating_add(1)),
        );
        let mut bookmark = match &existing {
            Some(bookmark) => bookmark.clone(),
            None => MessageBookmark {
                session_key: key.into(),
                seq,
                note: String::new(),
                excerpt: String::new(),
                text_hash: String::new(),
                created_at: now,
                updated_at: now,
                title: String::new(),
                agent: AgentId::ClaudeCode,
                project_path: None,
            },
        };
        if existing.is_none() || refresh_snapshot {
            let meta = self.get_session(key)?.context("Session is unavailable")?;
            let message = self
                .bookmark_message(key, seq)?
                .context("Message is unavailable")?;
            bookmark.excerpt = message.text.chars().take(500).collect();
            bookmark.text_hash = hash(&message.text);
            bookmark.title = meta.title.chars().take(1000).collect();
            bookmark.agent = meta.agent;
            bookmark.project_path = meta.project_path;
        }
        bookmark.note = note.into();
        bookmark.updated_at = now;
        BookmarkBackup {
            version: 1,
            bookmarks: vec![bookmark.clone()],
        }
        .validate()?;
        write(&tx, &bookmark)?;
        tx.commit()?;
        Ok(bookmark)
    }
    pub fn delete_bookmark(&self, key: &str, seq: i64) -> Result<()> {
        self.conn().execute(
            "DELETE FROM message_bookmarks WHERE session_key=?1 AND seq=?2",
            params![key, seq],
        )?;
        Ok(())
    }
    pub fn export_bookmarks(&self) -> Result<BookmarkBackup> {
        let bookmarks = self
            .conn()
            .prepare(&format!(
                "SELECT {COLUMNS} FROM message_bookmarks ORDER BY updated_at DESC,session_key,seq"
            ))?
            .query_map([], row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(BookmarkBackup {
            version: 1,
            bookmarks,
        })
    }
    pub fn list_bookmarks(&self, query: &str, filter: &SessionQuery) -> Result<Vec<BookmarkView>> {
        let terms: Vec<_> = query.split_whitespace().map(str::to_lowercase).collect();
        let mut views = Vec::new();
        // ponytail: scan small annotation collections; add indexed paging when measured bookmark browsing needs it.
        for bookmark in self.export_bookmarks()?.bookmarks {
            let session = self.get_session(&bookmark.session_key)?;
            let agent = session.as_ref().map_or(bookmark.agent, |meta| meta.agent);
            let project = session
                .as_ref()
                .and_then(|meta| meta.project_path.as_ref())
                .or(bookmark.project_path.as_ref());
            if filter
                .project_path
                .as_ref()
                .is_some_and(|wanted| project != Some(wanted))
                || filter.agent.is_some_and(|wanted| wanted != agent)
            {
                continue;
            }
            let title = session.as_ref().map_or(&bookmark.title, |meta| &meta.title);
            let searchable =
                format!("{}\n{}\n{}", title, bookmark.note, bookmark.excerpt).to_lowercase();
            if !terms.iter().all(|term| searchable.contains(term)) {
                continue;
            }
            let message = self.bookmark_message(&bookmark.session_key, bookmark.seq)?;
            let status = match message {
                Some(message) if session.is_some() => {
                    if hash(&message.text) == bookmark.text_hash {
                        BookmarkStatus::Current
                    } else {
                        BookmarkStatus::Changed
                    }
                }
                _ => BookmarkStatus::Unavailable,
            };
            views.push(BookmarkView {
                bookmark,
                session,
                status,
            });
        }
        Ok(views)
    }
    pub fn import_bookmarks(
        &self,
        backup: &BookmarkBackup,
        replacements: &[BookmarkReplacement],
    ) -> Result<BookmarkImport> {
        backup.validate()?; // Validate every row before starting a transaction.
        let mut replace_keys = HashSet::new();
        for replacement in replacements {
            ensure!(
                replace_keys.insert((&replacement.session_key, replacement.seq)),
                "Duplicate replacement identity"
            );
            ensure!(
                backup
                    .bookmarks
                    .iter()
                    .any(|bookmark| bookmark.session_key == replacement.session_key
                        && bookmark.seq == replacement.seq),
                "Replacement is absent from backup"
            );
        }
        let tx = self.conn().unchecked_transaction()?;
        let mut result = BookmarkImport::default();
        for incoming in &backup.bookmarks {
            let existing = get(&tx, &incoming.session_key, incoming.seq)?;
            match existing {
                None => {
                    write(&tx, incoming)?;
                    result.imported += 1;
                }
                Some(existing) if same_content(&existing, incoming) => {
                    result.unchanged += 1;
                }
                Some(existing) => {
                    let replacement = replacements.iter().find(|replacement| {
                        replacement.session_key == incoming.session_key
                            && replacement.seq == incoming.seq
                    });
                    if replacement.is_some_and(|replacement| {
                        replacement.expected_updated_at == existing.updated_at
                    }) {
                        let mut incoming = incoming.clone();
                        incoming.updated_at = incoming
                            .updated_at
                            .max(existing.updated_at.saturating_add(1));
                        write(&tx, &incoming)?;
                        result.imported += 1;
                    } else {
                        result.conflicts.push(BookmarkConflict {
                            existing,
                            incoming: incoming.clone(),
                        });
                    }
                }
            }
        }
        tx.commit()?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ParsedSession;
    use std::path::Path;

    fn parsed(key: &str, text: &str) -> ParsedSession {
        serde_json::from_value(serde_json::json!({
            "meta":{"key":key,"native_id":"same-native-id","agent":"claude-code","host":if key.starts_with("ssh:"){Some("build")}else{None},"parent_key":null,
                "title":"Bookmark sample","project_path":"/repo","source_path":"/missing-fixture","created_at":0,"updated_at":1,
                "model":null,"source":null,"tokens":null,"archived":false,"metadata_only":false,"can_delete":true},
            "messages":[{"seq":7,"role":"assistant","kind":"text","text":text,"timestamp":null,"model":null,"thinking":null,"tool_calls":[],"images":[]}]
        })).unwrap()
    }

    #[test]
    fn annotations_survive_reindex_prune_upgrade_and_backup_without_silent_overwrites() {
        assert_eq!(
            hash("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let path = std::env::temp_dir().join(format!(
            "ronda-bookmarks-{}-{}.db",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        {
            let mut store = Store::open(&path).unwrap();
            store
                .conn()
                .execute("DROP TABLE message_bookmarks", [])
                .unwrap(); // preceding additive schema
            store
                .upsert(&parsed("local", "Original ΑΛΦΑ"), "1")
                .unwrap();
            store.set_flags("local", true, true).unwrap();
        }
        let mut store = Store::open(&path).unwrap();
        assert!(store.get_session("local").unwrap().unwrap().starred);
        let created = store
            .save_bookmark("local", 7, "Keep this note", false, None)
            .unwrap();
        assert_eq!(
            store.save_bookmark("local", 7, "", false, None).unwrap(),
            created
        );
        assert!(store.save_bookmark("missing", 7, "", false, None).is_err());
        assert!(store.save_bookmark("local", 8, "", false, None).is_err());
        assert!(store
            .save_bookmark(
                "local",
                7,
                &"🙂".repeat(4001),
                false,
                Some(created.updated_at)
            )
            .is_err());
        let edited = store
            .save_bookmark("local", 7, "Edited note", false, Some(created.updated_at))
            .unwrap();
        assert!(edited.updated_at > created.updated_at);
        assert!(store
            .save_bookmark("local", 7, "Stale note", false, Some(created.updated_at))
            .is_err());
        store
            .upsert(&parsed("ssh:build:local", "Remote same native id"), "1")
            .unwrap();
        store
            .save_bookmark("ssh:build:local", 7, "Remote note", false, None)
            .unwrap();
        assert_eq!(
            store
                .list_bookmarks("αλφα", &SessionQuery::default())
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            store
                .list_bookmarks(
                    "note",
                    &SessionQuery {
                        project_path: Some("/other".into()),
                        ..Default::default()
                    }
                )
                .unwrap()
                .len(),
            0
        );
        store
            .upsert(&parsed("local", "Rewritten text"), "2")
            .unwrap();
        let view = store
            .list_bookmarks("edited", &SessionQuery::default())
            .unwrap();
        assert_eq!(view[0].status, BookmarkStatus::Changed);
        assert_eq!(view[0].bookmark.excerpt, "Original ΑΛΦΑ");
        let preserved = store
            .save_bookmark("local", 7, "Old text note", false, Some(edited.updated_at))
            .unwrap();
        assert_eq!(preserved.text_hash, created.text_hash);
        let refreshed = store
            .save_bookmark(
                "local",
                7,
                "New text note",
                true,
                Some(preserved.updated_at),
            )
            .unwrap();
        assert_ne!(refreshed.text_hash, created.text_hash);
        store.rederive_all().unwrap();
        store.prune_missing(None, &HashSet::new()).unwrap();
        assert!(store.get_session("ssh:build:local").unwrap().is_some());
        store.prune_missing(Some("build"), &HashSet::new()).unwrap();
        assert_eq!(
            store
                .list_bookmarks("", &SessionQuery::default())
                .unwrap()
                .len(),
            2
        );
        assert!(store
            .list_bookmarks("", &SessionQuery::default())
            .unwrap()
            .iter()
            .all(|view| view.status == BookmarkStatus::Unavailable));
        let unavailable = store
            .save_bookmark(
                "local",
                7,
                "Unavailable note",
                false,
                Some(refreshed.updated_at),
            )
            .unwrap();
        assert!(store
            .save_bookmark("local", 7, "", true, Some(unavailable.updated_at))
            .is_err());
        let backup = store.export_bookmarks().unwrap();
        let json = serde_json::to_string(&backup).unwrap();
        drop(store);
        let readonly = Store::open_existing_read_only(&path).unwrap();
        assert_eq!(
            serde_json::to_string(&readonly.export_bookmarks().unwrap()).unwrap(),
            json
        );
        assert!(readonly
            .save_bookmark(
                "local",
                7,
                "Write rejected",
                false,
                Some(unavailable.updated_at)
            )
            .is_err());
        drop(readonly);
        let target = Store::open(Path::new(":memory:")).unwrap();
        let backup = BookmarkBackup::parse(&json).unwrap();
        assert_eq!(target.import_bookmarks(&backup, &[]).unwrap().imported, 2);
        assert_eq!(
            serde_json::to_string(&target.export_bookmarks().unwrap()).unwrap(),
            json
        );
        assert_eq!(target.import_bookmarks(&backup, &[]).unwrap().unchanged, 2);
        let mut conflict = backup.clone();
        conflict.bookmarks[0].note = "Incoming conflicting note".into();
        let result = target.import_bookmarks(&conflict, &[]).unwrap();
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(
            serde_json::to_string(&target.export_bookmarks().unwrap()).unwrap(),
            json
        );
        let replacement = BookmarkReplacement {
            session_key: result.conflicts[0].existing.session_key.clone(),
            seq: 7,
            expected_updated_at: result.conflicts[0].existing.updated_at,
        };
        assert_eq!(
            target
                .import_bookmarks(&conflict, &[replacement])
                .unwrap()
                .imported,
            1
        );
        assert_eq!(
            target.import_bookmarks(&conflict, &[]).unwrap().unchanged,
            2
        );
        let before = serde_json::to_string(&target.export_bookmarks().unwrap()).unwrap();
        conflict.bookmarks.push(conflict.bookmarks[0].clone());
        assert!(target.import_bookmarks(&conflict, &[]).is_err());
        assert_eq!(
            serde_json::to_string(&target.export_bookmarks().unwrap()).unwrap(),
            before
        );
        assert!(BookmarkBackup::parse("{\"version\":2,\"bookmarks\":[]}").is_err());
        assert!(
            BookmarkBackup::parse("{\"version\":1,\"bookmarks\":[],\"unknown\":true}").is_err()
        );
        let mut invalid = backup.clone();
        invalid.bookmarks[0].text_hash = "bad".into();
        assert!(target.import_bookmarks(&invalid, &[]).is_err());
        // An SQL failure must roll back the whole import, including earlier successful rows.
        target.conn().execute_batch("CREATE TRIGGER reject_test_note BEFORE INSERT ON message_bookmarks WHEN NEW.note='reject' BEGIN SELECT RAISE(ABORT,'synthetic save failure'); END;").unwrap();
        let mut transaction = backup.clone();
        for (i, bookmark) in transaction.bookmarks.iter_mut().enumerate() {
            bookmark.session_key = format!("new-{i}");
            bookmark.note = if i == 1 { "reject" } else { "accepted" }.into();
        }
        assert!(target.import_bookmarks(&transaction, &[]).is_err());
        assert_eq!(
            serde_json::to_string(&target.export_bookmarks().unwrap()).unwrap(),
            before
        );
        let current = target.export_bookmarks().unwrap().bookmarks[0].clone();
        assert!(target
            .save_bookmark(
                &current.session_key,
                7,
                "reject",
                false,
                Some(current.updated_at)
            )
            .is_err());
        assert_eq!(
            serde_json::to_string(&target.export_bookmarks().unwrap()).unwrap(),
            before
        );
        target.delete_bookmark("local", 7).unwrap();
        target.delete_bookmark("local", 7).unwrap();
        assert_eq!(target.export_bookmarks().unwrap().bookmarks.len(), 1);
        std::fs::remove_file(path).unwrap();
    }
}
