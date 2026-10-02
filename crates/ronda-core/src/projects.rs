use crate::{
    bookmarks::BookmarkView,
    intel::report::{Intelligence, RecurringBug},
    SessionMeta, SessionQuery, Store,
};
use anyhow::{ensure, Result};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ProjectOverview {
    pub path: String,
    pub host: Option<String>,
    pub local_only: bool,
    pub since: i64,
    pub sessions: Vec<SessionMeta>,
    pub total_sessions: usize,
    pub bookmarks: Vec<BookmarkView>,
    pub total_bookmarks: usize,
    pub errors: Vec<RecurringBug>,
    pub total_errors: usize,
    pub intelligence: Option<Intelligence>,
    pub intelligence_error: Option<String>,
}

impl Store {
    pub fn project_overview(
        &self,
        path: &str,
        host: Option<&str>,
        local_only: bool,
        now: i64,
    ) -> Result<ProjectOverview> {
        ensure!(
            !path.trim().is_empty() && path.chars().count() <= 4096,
            "Choose a valid project path"
        );
        let since = now.saturating_sub(30 * 24 * 60 * 60 * 1000);
        let filter = SessionQuery {
            project_path: Some(path.into()),
            host: host.map(str::to_owned),
            local_only,
            ..Default::default()
        };
        filter.validate()?;
        // ponytail: reuse existing metadata/annotation scans; add SQL section paging if measured project refresh exceeds its budget.
        let mut sessions = self.list_sessions(&filter)?;
        sessions.retain(|session| session.parent_key.is_none());
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.key.cmp(&b.key)));
        let total_sessions = sessions.len();
        sessions.truncate(10);
        let mut bookmarks = self.list_bookmarks("", &filter)?;
        let total_bookmarks = bookmarks.len();
        bookmarks.truncate(10);
        let (mut intelligence, intelligence_error) =
            match self.intelligence_scoped(Some(since), Some(path), host, local_only) {
                Ok(report) => (Some(report), None),
                Err(error) => (None, Some(error.to_string())),
            };
        let total_errors = intelligence
            .as_ref()
            .map_or(0, |report| report.totals.recurring_bugs);
        let errors = intelligence.as_mut().map_or_else(Vec::new, |report| {
            report.recurring.iter().take(5).cloned().collect()
        });
        Ok(ProjectOverview {
            path: path.into(),
            host: host.map(str::to_owned),
            local_only,
            since,
            sessions,
            total_sessions,
            bookmarks,
            total_bookmarks,
            errors,
            total_errors,
            intelligence,
            intelligence_error,
        })
    }
}
