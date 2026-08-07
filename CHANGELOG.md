# Changelog

All notable changes to Ronda are recorded here.

## [0.2.0] - 2026-08-07

### Added
- Qoder, CodeBuddy, WorkBuddy, and Cursor agent transcript sessions.
- Subagent transcripts for Claude Code and Cursor, linked to their parent and hidden from the main list.
- Qoder sessions follow the active conversation branch.

### Changed
- Codex sessions read names, models, token counts, and archive state from Codex's own thread database.
- Internal Codex rollouts (subagents, reviews, memory consolidation) no longer appear as sessions.
- Cursor transcripts that contain only turn markers are skipped.

## [0.1.0] - 2026-07-31

### Added
- Desktop app built on Tauri 2 with Sessions, Insights, and Settings views.
- Sidebar with all sessions, starred sessions, projects, and agents, plus an **Include archived** toggle.
- Transcript view with Markdown rendering, inline images, and collapsible thinking and tool calls.
- Keyboard shortcuts: ⌘K to search, ⌘1–⌘3 to switch views, ⌘B for the sidebar, Alt ←/→ for history, and ↑/↓ through the session list.
- Search results jump to the matching message.
- Window size and position are remembered between launches.

## [0.0.3] - 2026-07-24

### Added
- Incremental indexing: unchanged session files are skipped by modification time, size, and WAL state.
- Sessions whose files are gone are pruned from the index, but only after a complete scan.

### Performance
- Appending a message reindexes one session in about 0.6 s on an 800 MiB library.

## [0.0.2] - 2026-07-16

### Added
- Full-text search with SQLite FTS5 and a trigram tokenizer, matching code fragments like `useEffect(` and Chinese text.
- Queries shorter than three characters fall back to substring matching.
- `ronda-cli search` groups hits by session with `ronda://session/…#seq` references.

### Security
- Search terms are quoted before reaching FTS5, so query syntax can't be injected.

### Performance
- Search measured 23 ms p50 and 26 ms p95 on an 800 MiB, 300-session library on an Apple M3 Pro, including CLI startup.

## [0.0.1] - 2026-07-08

### Added
- `ronda-core`: a rebuildable SQLite index kept separate from agent files, stored in the platform data directory or at `RONDA_DB`.
- Claude Code and Codex sessions, with messages, tool calls and their output, thinking, token usage, and compaction summaries.
- `ronda-cli sessions`, `show`, and `projects`.
- `RONDA_HOME` to scan a different home directory.
