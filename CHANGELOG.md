# Changelog

All notable changes to Ronda are recorded here.

## [Unreleased]

## [Unreleased]

### Added

- Read-only project overview queries combine recent sessions, bookmarks, recurring errors, and 30-day Intelligence with consistent project and host scope.

## [1.0.6] - 2026-10-02

### Added

- Select transcript messages and bookmarks across sessions to preview an editable Markdown context bundle, then copy or export it for another coding agent.
- Context drafts include source metadata and local message references, with tool input/output and thinking included only when chosen. Images and internal/system context are excluded.
- Oversized selections are rejected without truncation; edited drafts remain available after clipboard or export failures.

## [1.0.5] - 2026-10-02

### Added

- Date, model, and host controls with combined filters, full-library choices, local calendar boundaries, preserved hidden selections, and restored filter/sort preferences.
- Complete library browsing and grouped search with exact totals and Load more.
- Over 600 synthetic sessions in the preview demonstrate complete paging, multiple hosts, archived sessions, and unknown models.

### Fixed

- Keep library and search Load more controls visible outside the scrolling rows as the list grows.

- Libraries larger than the initial page remain accessible; pending pages cannot overwrite refreshed or filtered results.

## [1.0.4] - 2026-10-02

### Added

- Message bookmarks, editable plain-text notes, and a searchable bookmark library with project and agent filters.
- Versioned JSON backup and import in Settings → Data. Conflicting notes stay saved until explicitly replaced; changed and unavailable messages keep their original excerpt snapshots.
- The browser preview includes synthetic bookmarks, note editing, backup downloads, and a backup file picker. Changes reset on reload.

## [1.0.3] - 2026-10-02

### Added

- Find within transcripts with literal, case-insensitive matching, next/previous matches, optional thinking, prompts-only reading, and first/last-message navigation.

### Changed

- Release verification retries asset downloads before publishing and preserves download diagnostics when retries fail.

### Fixed

- Search excerpt navigation waits for the transcript to finish loading before scrolling to its message.

## [1.0.2] - 2026-10-02

### Added

- Search results group by session with complete message counts, highlighted excerpts, relevance/recent sorting, and session/match pagination.
- The sample preview demonstrates title matches, multiple excerpts, and both kinds of search paging.

### Changed

- Desktop search honors the archive checkbox instead of always including archived sessions.

### Fixed

- Search excerpts center on case-insensitive matches, including text with Unicode case expansion.
- Site previews render cleanly when the HTML contains only the prerender placeholder comment.

## [1.0.1] - 2026-10-02

### Fixed
- Open transcripts and active search results refresh when the library changes, without losing the selected session or reading position.
- Refreshing while the workbench is hidden waits until you return; failed refreshes preserve readable content and offer retry.

### Added
- The live product preview can append a sample message to demonstrate transcript updates.

### Changed
- Release checks validate all version sources before packaging, publication safely retries drafts, and the site deploys only after the matching installers are published.
- Settings shows the packaged app version, and the site's release highlights exclude unreleased changes.

## [1.0.0] - 2026-09-17

### Added
- **Resume** opens the session in a terminal inside Ronda, running the agent's resume command in the project folder. Remote sessions connect over `ssh -t` in the same terminal.
- A **Transcript / Terminal** switch in the session header, with a live status dot while the agent runs.
- Terminal toolbar with **Restart** after the process exits, **Open in system terminal**, and **Stop and close terminal**.
- Resumed terminals keep running while you browse other sessions or pages. When the agent exits, the terminal drops into your login shell in the same folder.
- On macOS, the top bar draws its own close, minimize, and full-screen buttons. They stay visible when the window loses focus, and ⌥-click on the green button zooms instead.
- **Intelligence** view (⌘3): active time by kind of work, agent failure patterns, errors that keep coming back, your stack, and how sessions end, filtered by range and project. Rows link to the message they came from.
- Session facts are derived locally while indexing, with fixed rules and no language model.
- `ronda-cli insights` and `ronda-cli errors`, plus the `ronda_insights` and `ronda_find_error` MCP tools.
- Library home that opens with "All your agent sessions in one place.", library stats, and the four most recent sessions.
- Four time-of-day themes (dawn, morning, dusk, night) with a theme slider in the top bar and a matching picker in **Settings → General**.
- Animated pixel field whose palette follows the active theme.
- Browser preview mode: the interface renders an empty library instead of failing when it runs outside the desktop shell.
- Product site with a live interface preview, plus separate changelog and documentation pages.
- Tagged builds publish a GitHub release with installers for every platform under fixed names, such as `Ronda-macos-arm64.dmg`, plus a `SHA256SUMS.txt` checksum file.
- macOS builds are signed and notarized with a Developer ID once Apple signing secrets are configured.
- Install guide for macOS, Windows, and Linux, including first-launch security prompts and checksum verification.

### Changed
- New app icon, and a smaller Ronda mark and wordmark in the top bar.
- Ronda starts in the light **morning** theme. Pick **System** in **Settings → General** to follow the OS appearance. The theme slider moved out of the top bar.
- The top bar no longer repeats the open session's title.
- The minimum window size is now 1024 × 680. A saved window smaller than the default opens at the default size, centered.
- Project folders in the sidebar show a folder icon.
- Redesigned the interface with square glass controls, a display serif for headings, Afacad for reading, and JetBrains Mono for controls.
- Sessions no longer auto-open on launch; click the Ronda mark to return to the library home.
- Existing `light` and `dark` theme preferences map to morning and night.
- Switched the JavaScript toolchain to Bun 1.4.2.
- Ronda is open source under the AGPL-3.0. The repository moved to `tryronda/ronda`, and the site to [tryronda.cloud](https://tryronda.cloud).
- The app identifier is now `cloud.tryronda.ronda`, so saved window size and position reset once. The session index is unaffected.

### Performance
- Library queries run off the main thread, so a slow search or scan no longer freezes the window.
- Switching between Sessions, Insights, Intelligence, and Settings keeps each page's scroll position and no longer re-animates or reflows.
- Insights and Intelligence refresh only while visible. Changes made while they are hidden are applied when you return, and bursts of file changes are coalesced.
- Markdown rendering, Insights, and Settings load after the shell is idle, halving the startup bundle from 945 kB to 480 kB.
- The pixel field draws on a single canvas, and long session lists and transcripts skip rendering off-screen rows.
- Search keeps previous results visible while a new query runs, and the debounce dropped from 180 ms to 120 ms.

## [0.9.1] - 2026-09-15

### Added
- CI builds macOS arm64 and x64 DMGs, Linux x64 and arm64 `.deb` and AppImage packages, and a Windows x64 NSIS installer.
- Every package is opened in CI to check that `ronda-cli` and `ronda-mcp` are bundled and not empty.
- Linux and Windows windows draw their own minimize, maximize, and close buttons in the top bar.

### Changed
- CI runs `cargo fmt --check`, Clippy with warnings as errors, the Rust test suite, and the frontend tests before building packages.

## [0.9.0] - 2026-09-14

### Added
- **Settings → Remote hosts**: add an SSH alias or `user@host`, enable or disable it, sync on demand, and see the last sync time and error.
- Remote sessions are mirrored with `rsync` from a fixed allowlist of agent session paths and indexed with their own `agent:host:id` keys.
- **Resume** on a remote session copies an `ssh -t` command instead of opening a local terminal.
- Enabled hosts sync on launch and on every **Refresh**.

### Changed
- Removing a host deletes its mirror and its sessions from the index.
- Host names are restricted to letters, digits, `@`, `.`, `_`, and `-`, and can't start with `-`.

## [0.8.0] - 2026-09-10

### Added
- **Settings → Locations** lists the detected path for each agent, with switches to disable a location and a form to add custom folders.
- Filesystem watching: file-backed sessions update in the library as agents write them.
- **Settings → Data** shows the index path and can rebuild the index.
- **Settings → Updates** checks for a newer release, and **Settings → About** shows the version.

### Performance
- Watcher events are debounced until 250 ms of quiet, and scans are serialized so a refresh never races the watcher.

## [0.7.0] - 2026-09-07

### Added
- Insights view with session, prompt, and token totals.
- 12-month activity heatmap with a tooltip for each day.
- Activity by weekday, month, and hour of day.
- Leaderboards for agents, projects, and models, ranked by sessions, prompts, or tokens.

### Changed
- Unknown token counts stay unknown instead of being estimated.

## [0.6.0] - 2026-09-02

### Added
- `ronda-mcp`, a read-only stdio MCP server with `ronda_search`, `ronda_list_sessions`, `ronda_get_session`, and `ronda_list_projects`.
- **Settings → Connect** with ready-to-copy MCP setup for Claude Code, Codex, and other clients.
- `ronda-cli setup` prints the binary paths and an `AGENTS.md` snippet; `ronda-cli index` creates an index when none exists.
- `--since` accepts `30m`, `12h`, `7d`, `2w`, dates, and RFC 3339 timestamps.
- `--project` matches the current folder, its closest indexed parent, or a project name.
- Agent aliases such as `claude`, `deepseek`, and `gemini-cli` in `--agent`.
- `ronda-cli` and `ronda-mcp` ship beside the desktop app.

### Changed
- The CLI and MCP server share one query layer, so they return identical text for the same request.

## [0.5.0] - 2026-08-26

### Added
- Star and pin sessions; pinned sessions sort to the top and flags survive rescans.
- Export a session to Markdown.
- **Resume** reopens a session in its agent: Terminal on macOS, the default terminal emulator on Linux, and Windows Terminal or PowerShell on Windows.
- **Move to Trash** sends a session's files to the system Trash after confirmation and keeps the session out of later scans.

### Changed
- **Move to Trash** only removes files inside an enabled location, and never touches shared agent databases or remote mirrors.

## [0.4.0] - 2026-08-20

### Added
- Copilot CLI, OpenCode, Hermes Agent, OpenClaw, and Antigravity CLI sessions.
- Cursor IDE conversations from `state.vscdb`, alongside Cursor agent transcripts.
- Both OpenCode database generations, kept under separate keys.
- Hermes Agent profiles and OpenClaw's legacy JSONL sessions.

### Changed
- Agent databases open read-only without `immutable`, so sessions still in a live SQLite WAL appear, and agent files are left byte-identical.
- When a Cursor transcript and an IDE conversation share an ID, the transcript wins.
- Antigravity transcripts are encrypted, so Ronda shows their metadata only.

## [0.3.0] - 2026-08-13

### Added
- Pi, Oh My Pi, Grok Build, Gemini CLI, Kiro, Kimi Code, and DeepSeek Harness sessions.
- Streaming decompression for DeepSeek Harness `.zstd` sessions.
- Grok Build subagents grouped under their parent session.

### Changed
- Inline images are shown only when embedded in the transcript; remote URLs and `file:` paths are never loaded.
- DeepSeek Harness subagent sessions are skipped, and when a compressed and uncompressed copy exist, only the newer one is indexed.

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
- Full-text search with SQLite FTS5 and a trigram tokenizer, matching code fragments like `useEffect(` and prose in any language.
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
