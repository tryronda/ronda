//! Aggregates stored facts into the intelligence report. Reads only the derived tables, never transcripts.
use super::{patterns::Pattern, Category, Outcome};
use crate::Store;
use anyhow::{Context, Result};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

const EVIDENCE: usize = 5;
const RECURRING: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Evidence {
    pub session_key: String,
    pub seq: i64,
    pub title: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Totals {
    pub sessions: usize,
    pub active_ms: i64,
    pub recovery_ms: i64,
    pub tool_calls: i64,
    pub tool_errors: i64,
    pub failed_sessions: usize,
    pub recurring_bugs: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeRow {
    pub category: String,
    pub label: String,
    pub sessions: usize,
    pub active_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailureRow {
    pub pattern: String,
    pub label: String,
    pub sessions: usize,
    pub evidence: Vec<Evidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecurringBug {
    pub signature: String,
    pub message: String,
    pub sessions: usize,
    pub agents: Vec<String>,
    pub projects: Vec<String>,
    pub first_seen: i64,
    pub last_seen: i64,
    /// A session with this error ended in a commit, and the error showed up again in a later session.
    pub came_back: bool,
    pub evidence: Vec<Evidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackRow {
    pub tech: String,
    pub sessions: usize,
    pub share: u32,
    pub new: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutcomeRow {
    pub outcome: String,
    pub label: String,
    pub sessions: usize,
    pub active_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCoverage {
    pub agent: String,
    pub sessions: usize,
    /// Sessions with tool calls; failures, stack, and outcomes need them.
    pub with_tools: usize,
    /// Sessions with message timestamps; time needs them.
    pub with_time: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Intelligence {
    pub since: Option<i64>,
    pub project: Option<String>,
    pub totals: Totals,
    pub time: Vec<TimeRow>,
    pub failures: Vec<FailureRow>,
    pub recurring: Vec<RecurringBug>,
    pub stack: Vec<StackRow>,
    pub outcomes: Vec<OutcomeRow>,
    pub coverage: Vec<AgentCoverage>,
    pub callouts: Vec<String>,
}

/// An error's latest wording and the sessions that hit it, each with how that session ended.
pub type ErrorMatches = (String, Vec<(Evidence, String)>);

struct Fact {
    key: String,
    root: String,
    agent: String,
    project: Option<String>,
    started_at: i64,
    ended_at: i64,
    active_ms: i64,
    recovery_ms: i64,
    tool_calls: i64,
    tool_errors: i64,
    category: String,
    outcome: String,
}

pub fn hours(ms: i64) -> String {
    let h = ms as f64 / 3_600_000.0;
    if h >= 10.0 {
        format!("{h:.0} h")
    } else if h >= 1.0 {
        format!("{h:.1} h")
    } else {
        format!("{} min", (ms / 60_000).max(if ms > 0 { 1 } else { 0 }))
    }
}

impl Store {
    fn facts(&self, project: Option<&str>) -> Result<Vec<Fact>> {
        let mut stmt = self.conn().prepare(
            "SELECT session_key,parent_key,agent,project,started_at,ended_at,active_ms,recovery_ms,tool_calls,tool_errors,category,outcome \
             FROM session_facts WHERE ?1 IS NULL OR project=?1",
        ).context("intelligence tables are missing; open Ronda to rebuild the index")?;
        let rows = stmt.query_map([project], |r| {
            let key: String = r.get(0)?;
            let parent: Option<String> = r.get(1)?;
            Ok(Fact {
                root: parent.unwrap_or_else(|| key.clone()),
                key,
                agent: r.get(2)?,
                project: r.get(3)?,
                started_at: r.get(4)?,
                ended_at: r.get(5)?,
                active_ms: r.get(6)?,
                recovery_ms: r.get(7)?,
                tool_calls: r.get(8)?,
                tool_errors: r.get(9)?,
                category: r.get(10)?,
                outcome: r.get(11)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    fn evidence(&self, key: &str, seq: i64) -> Result<Evidence> {
        let title = self.get_session(key)?.map(|m| m.title).unwrap_or_default();
        Ok(Evidence {
            session_key: key.into(),
            seq,
            title,
        })
    }

    /// The intelligence report for sessions active since `since` (all time when `None`), optionally for one project path.
    pub fn intelligence(&self, since: Option<i64>, project: Option<&str>) -> Result<Intelligence> {
        let all = self.facts(project)?;
        let by_key: HashMap<&str, &Fact> = all.iter().map(|f| (f.key.as_str(), f)).collect();
        let in_range = |f: &Fact| since.is_none_or(|t| f.ended_at >= t);
        let top: Vec<&Fact> = all
            .iter()
            .filter(|f| f.key == f.root && in_range(f))
            .collect();
        let range_keys: HashSet<&str> = all
            .iter()
            .filter(|f| in_range(f))
            .map(|f| f.key.as_str())
            .collect();

        let mut totals = Totals {
            sessions: top.len(),
            ..Default::default()
        };
        let mut time = BTreeMap::<Category, (usize, i64)>::new();
        let mut outcomes = BTreeMap::<Outcome, (usize, i64)>::new();
        let mut coverage = BTreeMap::<String, AgentCoverage>::new();
        for f in &top {
            totals.active_ms += f.active_ms;
            totals.recovery_ms += f.recovery_ms;
            let category = Category::parse(&f.category).unwrap_or(Category::Features);
            let row = time.entry(category).or_default();
            row.0 += 1;
            row.1 += f.active_ms - f.recovery_ms;
            if let Some(outcome) = Outcome::parse(&f.outcome) {
                let row = outcomes.entry(outcome).or_default();
                row.0 += 1;
                row.1 += f.active_ms;
                if outcome == Outcome::Failed {
                    totals.failed_sessions += 1;
                }
            }
            let c = coverage
                .entry(f.agent.clone())
                .or_insert_with(|| AgentCoverage {
                    agent: f.agent.clone(),
                    sessions: 0,
                    with_tools: 0,
                    with_time: 0,
                });
            c.sessions += 1;
        }
        // Subagents do the work for their parent: their tool calls count toward the parent's agent.
        for f in all.iter().filter(|f| in_range(f)) {
            totals.tool_calls += f.tool_calls;
            totals.tool_errors += f.tool_errors;
        }
        let mut family = HashMap::<&str, (bool, bool)>::new();
        for g in &all {
            let entry = family.entry(g.root.as_str()).or_default();
            *entry = (entry.0 || g.tool_calls > 0, entry.1 || g.active_ms > 0);
        }
        for f in &top {
            let (tools, timed) = family.get(f.key.as_str()).copied().unwrap_or_default();
            let c = coverage.get_mut(&f.agent).expect("counted above");
            c.with_tools += tools as usize;
            c.with_time += timed as usize;
        }

        // Failure patterns: sessions (counting a subagent as its parent) where each rule fired.
        let mut failures = BTreeMap::<Pattern, (BTreeSet<String>, Vec<(i64, String, i64)>)>::new();
        let mut stmt = self
            .conn()
            .prepare("SELECT session_key,seq,pattern FROM failure_events")?;
        for row in stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })? {
            let (key, seq, pattern) = row?;
            let (Some(fact), Some(pattern)) = (by_key.get(key.as_str()), Pattern::parse(&pattern))
            else {
                continue;
            };
            if !range_keys.contains(key.as_str()) {
                continue;
            }
            let entry = failures.entry(pattern).or_default();
            entry.0.insert(fact.root.clone());
            entry.1.push((fact.ended_at, key, seq));
        }
        let mut failures: Vec<FailureRow> = failures
            .into_iter()
            .map(|(pattern, (roots, mut hits))| {
                hits.sort_by_key(|h| std::cmp::Reverse(h.0));
                let evidence = hits
                    .iter()
                    .take(EVIDENCE)
                    .map(|(_, key, seq)| self.evidence(key, *seq))
                    .collect::<Result<_>>()?;
                Ok(FailureRow {
                    pattern: pattern.as_str().into(),
                    label: pattern.label().into(),
                    sessions: roots.len(),
                    evidence,
                })
            })
            .collect::<Result<_>>()?;
        failures.sort_by_key(|f| std::cmp::Reverse(f.sessions));

        // Recurring bugs: an error signature seen in two or more sessions, at least once in range.
        struct Hit {
            root: String,
            key: String,
            seq: i64,
            started_at: i64,
            ended_at: i64,
            message: String,
        }
        let mut signatures = HashMap::<String, Vec<Hit>>::new();
        let mut stmt = self
            .conn()
            .prepare("SELECT session_key,seq,signature,message FROM error_events")?;
        for row in stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })? {
            let (key, seq, signature, message) = row?;
            let Some(fact) = by_key.get(key.as_str()) else {
                continue;
            };
            signatures.entry(signature).or_default().push(Hit {
                root: fact.root.clone(),
                key,
                seq,
                started_at: fact.started_at,
                ended_at: fact.ended_at,
                message,
            });
        }
        let mut recurring = Vec::new();
        for (signature, mut hits) in signatures {
            let sessions = hits
                .iter()
                .map(|h| h.root.as_str())
                .collect::<BTreeSet<_>>()
                .len();
            if sessions < 2 || !hits.iter().any(|h| range_keys.contains(h.key.as_str())) {
                continue;
            }
            hits.sort_by_key(|h| h.started_at);
            let root_fact = |h: &Hit| by_key.get(h.root.as_str()).copied();
            let agents: BTreeSet<String> = hits
                .iter()
                .filter_map(|h| root_fact(h).map(|f| f.agent.clone()))
                .collect();
            let projects: BTreeSet<String> = hits
                .iter()
                .filter_map(|h| root_fact(h).and_then(|f| f.project.clone()))
                .collect();
            let came_back = hits.iter().any(|fixed| {
                root_fact(fixed).is_some_and(|f| f.outcome == Outcome::Committed.as_str())
                    && hits
                        .iter()
                        .any(|later| later.root != fixed.root && later.started_at > fixed.ended_at)
            });
            let mut latest: Vec<&Hit> = Vec::new();
            for hit in hits.iter().rev() {
                if !latest.iter().any(|h| h.root == hit.root) {
                    latest.push(hit);
                }
            }
            let evidence = latest
                .iter()
                .take(EVIDENCE)
                .map(|h| self.evidence(&h.key, h.seq))
                .collect::<Result<_>>()?;
            recurring.push(RecurringBug {
                signature,
                // The latest wording, since paths and values in it are the most relevant now.
                message: hits.last().map(|h| h.message.clone()).unwrap_or_default(),
                sessions,
                agents: agents.into_iter().collect(),
                projects: projects.into_iter().collect(),
                first_seen: hits.first().map(|h| h.started_at).unwrap_or(0),
                last_seen: hits.iter().map(|h| h.ended_at).max().unwrap_or(0),
                came_back,
                evidence,
            });
        }
        recurring.sort_by_key(|b| {
            (
                std::cmp::Reverse(b.sessions),
                std::cmp::Reverse(b.last_seen),
            )
        });
        totals.recurring_bugs = recurring.len();
        recurring.truncate(RECURRING);

        // Stack: share of sessions in range that touch each technology; new when nothing before the range did.
        let mut in_range_tech = HashMap::<String, BTreeSet<String>>::new();
        let mut earlier_tech = HashSet::<String>::new();
        let mut stmt = self
            .conn()
            .prepare("SELECT session_key,tech FROM stack_hits")?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (key, tech) = row?;
            let Some(fact) = by_key.get(key.as_str()) else {
                continue;
            };
            if range_keys.contains(key.as_str()) {
                in_range_tech
                    .entry(tech)
                    .or_default()
                    .insert(fact.root.clone());
            } else if since.is_some_and(|t| fact.ended_at < t) {
                earlier_tech.insert(tech);
            }
        }
        let with_tools = top
            .iter()
            .filter(|f| family.get(f.key.as_str()).is_some_and(|x| x.0))
            .count()
            .max(1);
        let mut stack: Vec<StackRow> = in_range_tech
            .into_iter()
            .map(|(tech, roots)| StackRow {
                new: since.is_some() && !earlier_tech.contains(&tech),
                share: ((roots.len() * 100) as f64 / with_tools as f64).round() as u32,
                sessions: roots.len(),
                tech,
            })
            .collect();
        stack.sort_by(|a, b| b.sessions.cmp(&a.sessions).then(a.tech.cmp(&b.tech)));

        let time: Vec<TimeRow> = time
            .into_iter()
            .map(|(c, (sessions, active_ms))| TimeRow {
                category: c.as_str().into(),
                label: c.label().into(),
                sessions,
                active_ms,
            })
            .collect();
        let outcomes: Vec<OutcomeRow> = outcomes
            .into_iter()
            .map(|(o, (sessions, active_ms))| OutcomeRow {
                outcome: o.as_str().into(),
                label: o.label().into(),
                sessions,
                active_ms,
            })
            .collect();
        let callouts = callouts(&totals, &time, &outcomes, &recurring, &stack);
        Ok(Intelligence {
            since,
            project: project.map(str::to_owned),
            totals,
            time,
            failures,
            recurring,
            stack,
            outcomes,
            coverage: coverage.into_values().collect(),
            callouts,
        })
    }

    /// Prior sessions that hit the same error as `text`, newest first.
    pub fn find_error(&self, text: &str) -> Result<Option<ErrorMatches>> {
        let line = super::errors::extract(text)
            .map(|e| e.message)
            .unwrap_or_else(|| text.lines().next().unwrap_or(text).to_owned());
        let mut signature = super::errors::signature(&line);
        let exact: bool = self.conn().query_row(
            "SELECT EXISTS(SELECT 1 FROM error_events WHERE signature=?1)",
            [&signature],
            |r| r.get(0),
        )?;
        if !exact {
            // The text may leave out what the recorded line carries, such as its `at file:line` tail: match on the shared start.
            let wanted = super::errors::normalize(&line);
            if wanted.len() < 12 {
                return Ok(None);
            }
            let mut stmt = self.conn().prepare("SELECT signature,message,count(DISTINCT session_key) n FROM error_events GROUP BY signature ORDER BY n DESC")?;
            let best = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                .filter_map(|row| row.ok())
                .find(|(_, message)| {
                    let known = super::errors::normalize(message);
                    known.starts_with(&wanted) || (known.len() >= 12 && wanted.starts_with(&known))
                });
            match best {
                Some((found, _)) => signature = found,
                None => return Ok(None),
            }
        }
        let mut stmt = self.conn().prepare(
            "SELECT e.session_key,e.seq,e.message,f.outcome FROM error_events e JOIN session_facts f ON f.session_key=e.session_key \
             WHERE e.signature=?1 ORDER BY f.ended_at DESC",
        )?;
        let rows: Vec<(String, i64, String, String)> = stmt
            .query_map(params![signature], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        let Some(message) = rows.first().map(|r| r.2.clone()) else {
            return Ok(None);
        };
        let mut seen = HashSet::new();
        let hits = rows
            .into_iter()
            .filter(|r| seen.insert(r.0.clone()))
            .map(|(key, seq, _, outcome)| Ok((self.evidence(&key, seq)?, outcome)))
            .collect::<Result<_>>()?;
        Ok(Some((message, hits)))
    }
}

fn callouts(
    totals: &Totals,
    time: &[TimeRow],
    outcomes: &[OutcomeRow],
    recurring: &[RecurringBug],
    stack: &[StackRow],
) -> Vec<String> {
    let mut out = Vec::new();
    if totals.recovery_ms > 0 && totals.active_ms > 0 {
        let share = totals.recovery_ms * 100 / totals.active_ms;
        let chores: i64 = time
            .iter()
            .filter(|t| t.category == "tests" || t.category == "setup")
            .map(|t| t.active_ms)
            .sum();
        let comparison = if chores > 0 && totals.recovery_ms > chores {
            ", more than writing tests and setup combined"
        } else {
            ""
        };
        out.push(format!(
            "Recovering from failing commands took {} ({share}% of active time){comparison}.",
            hours(totals.recovery_ms)
        ));
    }
    let avg = |o: &str| {
        outcomes
            .iter()
            .find(|r| r.outcome == o && r.sessions >= 3)
            .map(|r| r.active_ms as f64 / r.sessions as f64)
    };
    if let (Some(failed), Some(committed)) = (avg("failed"), avg("committed")) {
        if committed > 0.0 && failed / committed >= 1.5 {
            out.push(format!(
                "Sessions that ended failing ran {:.1}× longer than committed ones.",
                failed / committed
            ));
        }
    }
    if let Some(bug) = recurring.iter().find(|b| b.came_back) {
        out.push(format!(
            "“{}” came back after a session that committed a fix.",
            bug.message
        ));
    }
    let new: Vec<&str> = stack
        .iter()
        .filter(|s| s.new)
        .take(3)
        .map(|s| s.tech.as_str())
        .collect();
    if !new.is_empty() {
        out.push(format!("New in this period: {}.", new.join(", ")));
    }
    out
}
