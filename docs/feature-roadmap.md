# Ronda feature and release plan

Prepared on 2026-10-02. This is a proposed implementation roadmap for the ten improvements identified in the product review. No feature, tag, release, or site deployment has been created by this document.

The goal is faster context recovery and reuse for individual developers. Each feature ships as a separately reviewable desktop release, with matching documentation and a working browser demonstration. Version numbers below assume the latest published version remains 1.0.0; check remote tags and releases before allocating each version. Hotfixes can consume patch numbers without changing the feature order.

## Findings from the existing product

- The repository and latest published GitHub release are at 1.0.0. Earlier releases used a dated `CHANGELOG.md` section, synchronized app versions, a `vX.Y.Z` tag, and platform installers.
- `CONTRIBUTING.md` describes release preparation. Versions live in `package.json`, the workspace section of `Cargo.toml`, and `src-tauri/tauri.conf.json`; workspace package versions also appear in `Cargo.lock`. Settings currently displays a hardcoded 1.0.0.
- `.github/workflows/build.yml` runs frontend and Rust checks, builds five platform targets, verifies bundled CLI/MCP binaries, then publishes seven installers plus `SHA256SUMS.txt`. GitHub release notes are extracted from the changelog.
- The latest tag run successfully built its packages but failed at publication because a release named `v1.0.0` already existed. Preserve that published release; fix retry handling for future versions.
- `.github/workflows/pages.yml` deploys on matching `main` pushes. It can therefore publish feature claims and the new interface before the corresponding installers are available.
- The live site has a landing page, documentation, changelog, Intelligence page, and brand page. Its interactive preview mounts the actual React app through `site/preview/LivePreview.tsx`; `site/preview/demo.ts` supplies mocked Tauri commands and sample data.
- The demo currently finds at most one message per session, ignores some desktop filter/limit behavior, and silently returns `null` for unknown commands. Desktop and browser behavior already differ. Every new command needs an explicit demo implementation.
- `site/changelog/releases.ts` parses `CHANGELOG.md`; a second hand-maintained web changelog is unnecessary. The landing page currently selects the first nonempty section, including Unreleased, for its latest highlights.
- Desktop search returns message hits ordered by session recency; the interface turns every hit into a session row. The default library limit is 500 and search limit is 100. The CLI already groups search output, so its behavior must be considered separately.
- Source watching already exists. Open transcripts and active searches do not consistently refresh from library-change events. Parent/child metadata, normalized tool paths, error signatures, and Intelligence evidence already exist and should be reused.

Reviewed sources: [contribution and release guide](../CONTRIBUTING.md), [build workflow](../.github/workflows/build.yml), [site workflow](../.github/workflows/pages.yml), [changelog](../CHANGELOG.md), and [demo backend](../site/preview/demo.ts). Live checks: [product and preview](https://tryronda.cloud/#preview), [published release](https://github.com/tryronda/ronda/releases/tag/v1.0.0), and [latest tag workflow](https://github.com/tryronda/ronda/actions/runs/35278496114). Local uncommitted launch/site work exists; preserve it and keep it outside feature commits unless intentionally included.

## Release order

The refresh fix ships first because it corrects existing behavior. The remaining releases add capabilities in dependency order.

| Order | Feature | Proposed version and tag | GitHub release title | Branch |
| --- | --- | --- | --- | --- |
| 1 | Reliable live transcripts | 1.0.1 / `v1.0.1` | Ronda 1.0.1 | `ronda/live-transcripts` |
| 2 | Better search results | 1.0.2 / `v1.0.2` | Ronda 1.0.2 | `ronda/search-results` |
| 3 | Transcript navigation | 1.0.3 / `v1.0.3` | Ronda 1.0.3 | `ronda/transcript-navigation` |
| 4 | Message bookmarks and notes | 1.0.4 / `v1.0.4` | Ronda 1.0.4 | `ronda/message-bookmarks` |
| 5 | Richer filters and complete browsing | 1.0.5 / `v1.0.5` | Ronda 1.0.5 | `ronda/library-filters` |
| 6 | Copy context for another agent | 1.0.6 / `v1.0.6` | Ronda 1.0.6 | `ronda/copy-context` |
| 7 | Project overview | 1.0.7 / `v1.0.7` | Ronda 1.0.7 | `ronda/project-overview` |
| 8 | Find this error in history | 1.0.8 / `v1.0.8` | Ronda 1.0.8 | `ronda/error-history` |
| 9 | Related sessions and subagent navigation | 1.0.9 / `v1.0.9` | Ronda 1.0.9 | `ronda/related-sessions` |
| 10 | Resume readiness | 1.0.10 / `v1.0.10` | Ronda 1.0.10 | `ronda/resume-readiness` |

All new feature, release-preparation, and follow-up branches use the `ronda/` prefix. Every implementation and release commit must continue using `ronda-agent[bot]` as both author and committer, with email `330417223+ronda-agent[bot]@users.noreply.github.com`, matching the existing repository history and local configuration. Set identity per repository or per commit, never globally, and verify both fields with `git show --format=fuller` before pushing. Continue using the Ronda agent GitHub App authentication for bot-owned pushes and PR operations; verify access before publishing and never substitute a personal account silently.

These are ordinary semantic-version tags, not extra feature tags. This series uses patch increments for small compatible improvements. Reserve a minor or major bump for a material capability or compatibility change that warrants it. Use the actual publication date in each changelog section, in the maintainer's America/Argentina/Buenos_Aires timezone. Do not predate releases or publish placeholders.

## Common delivery requirements

### Release foundation before the first feature ships

Include these small process corrections with 1.0.1. They are prerequisites for the whole roadmap, rather than a separate product feature.

1. Add a version consistency check before bundle jobs. Compare all three version sources, workspace lockfile package versions, tag when present, and a dated changelog section. Display the app version from build metadata instead of a literal in Settings.
2. Make publication safely retryable. Create a draft release, upload the complete expected asset set and checksum file, then publish. Put the source commit SHA in release notes. On retry, continue an existing draft only for that same SHA; replace draft assets as needed. If an already-published release has the same SHA and asset checksums, finish successfully without changing it. Otherwise stop with a clear mismatch error. Never move a published tag or overwrite published assets.
3. Run `bun run site:build` in PR/check CI so preview compilation and prerendering are gates before release. Add focused tests for changelog parsing, published-highlight selection, and the demo commands changed by each feature.
4. Convert the site deployment workflow to a reusable `workflow_call` plus manual dispatch. Remove automatic deployment on `main` pushes. Add a job after successful release publication in the build workflow that calls site deployment with the release tag as its checkout ref and the necessary Pages permissions. Explicit invocation avoids relying on another workflow being triggered by the default GitHub token's release event.
5. Manual deployment accepts a published tag and verifies it before checkout. Default to the latest published tag. Site-only fixes use a patch release if they must change deployed source; do not deploy arbitrary unreleased app code to production.
6. Make the landing page's latest highlights skip Unreleased. Keep the changelog's Unreleased section visible as development work, clearly distinct from dated releases. Downloads keep the existing version-free asset names; historical release notes should link to their own tag's assets rather than `/latest/`.
7. Correct demo dispatch for new commands and make genuinely unknown commands fail clearly, retaining explicit no-op handlers for the Tauri/window/event calls the preview needs. Implement demo event subscriptions so synthetic updates can exercise real refresh behavior.
8. Update `CONTRIBUTING.md` and the PR checklist with the release/site gates. Test the retry branches using mocked `gh` responses or a temporary local harness; do not publish a throwaway production release.

### Checklist for every feature

1. Start from the latest released commit, check remote version availability, and create the listed `ronda/` branch. Configure and verify the Ronda agent author/committer identity and bot authentication before making commits. Use synthetic session fixtures and an isolated `RONDA_HOME`/`RONDA_DB` for manual testing.
2. Implement the feature across core, desktop commands, frontend, browser fallback values, and demo commands as applicable. Keep adapter files read-only and preserve existing CLI/MCP contracts unless the feature explicitly extends them.
3. Add user-facing entries under Unreleased using the existing Added, Changed, Fixed, or Performance categories. Add screenshots of synthetic data to the PR and describe tests and limitations.
4. Update the relevant site documentation, interactive sample, README feature text where appropriate, and landing copy only where the new capability materially changes the promise. No redesign is required for every release.
5. Pass `bun run check`, `bun run prepare:sidecars`, `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, and `bun run site:build`. Run the existing benchmark for index/scanner/search changes, plus a targeted check of any new query not covered by the CLI benchmark.
6. Test the installed app, not just Vite: upgrade from the preceding release, open an existing index, perform the feature's happy path, and check keyboard access. Platform-specific changes require macOS, Windows, and Linux smoke tests. Keep existing installer/sidecar verification in the five-target CI matrix.
7. Prepare the release commit: synchronize versions and lockfile workspace entries; move the feature's Unreleased entries into `## [X.Y.Z] - YYYY-MM-DD`; leave an empty Unreleased section; include all matching site/docs/demo changes. Re-run the gates after release preparation.
8. Merge the reviewed commit, verify main CI, create an annotated `vX.Y.Z` tag on that exact commit using the Ronda agent tagger identity, and push it. Let CI publish the GitHub release; do not create a competing manual release.
9. Verify all seven installers and `SHA256SUMS.txt`, checksum agreement, the source SHA, release notes, CLI/MCP versions, and a real download. Then verify the production site deployed the same tag: downloads, release highlights, changelog anchor, docs, preview, and absence of console errors.
10. A feature is complete only when the desktop release and site verification both pass. If packaging fails, keep the old site deployed. If site deployment fails after publication, fix or rerun it for the same released SHA. A product regression gets a new patch release; published versions remain immutable.

No new analytics collection is required. Use synthetic acceptance tasks and voluntary usability sessions to evaluate the roadmap. Preserve the existing local-data promise.

## Reliable live transcripts

**Release:** 1.0.1, tag `v1.0.1`. No feature dependencies; includes the release foundation.

### Behavior and implementation

- Reuse the existing library-change subscription, debounce pattern, and `sameJson` comparison. Refresh sessions, current search results, and the selected transcript as one coherent refresh cycle. Do not add another filesystem watcher or polling loop.
- Keep the previous transcript visible while refreshing. Fetch by the selected session key and discard responses after a selection change or a newer request. A library refresh must not clear an open session merely because it is outside the current list page or filters; resolve its metadata directly.
- If the reader was at the bottom before an append, follow new messages. Otherwise preserve the visible message and its offset and show a keyboard-accessible New messages button. For edits to earlier messages, preserve the nearest surviving message anchor.
- While the Workbench is hidden, mark it stale and refresh once when shown. Terminal execution continues independently. A remote transcript refreshes after a successful existing SSH sync; this release does not add automatic remote polling.
- On refresh failure retain readable content and show retry. If the session was actually removed, show Session no longer available instead of silently switching to another session.
- Existing event/command interfaces remain usable; do not require timestamps to change before re-fetching because transcript content can change without a useful timestamp.

### Acceptance checks

- Append a message to an isolated source and verify it appears without reselecting the session, after watcher notification. Update an existing message and verify replacement.
- Test bottom-following, reading-position preservation, hidden-page refresh, active-search refresh, rapid selection changes, burst events, missing sessions, and recoverable fetch failure.
- Keep a terminal running while changing pages and refreshing. Record end-to-end watcher-to-paint timing separately from existing index benchmark numbers.

### Site and release contents

- Add a sample-only Append demo message control outside the embedded app chrome. It updates the mock transcript and emits the mocked library event; never imply a real terminal is running in the browser.
- Update resume documentation to explain transcript freshness and remote-sync limits. Test the actual shared Workbench in the demo.
- Proposed changelog: **Fixed:** Open transcripts and search results update when the library changes, without losing your reading position. **Changed:** The product preview demonstrates transcript updates with sample messages. Record release-process fixes in Changed where user-facing.

## Better search results

**Release:** 1.0.2, tag `v1.0.2`. Depends on the refresh release.

### Behavior and implementation

- Display one result row per session, with the number of matching indexed messages and up to three clickable excerpts. Expand a session's matches inline with Load more; each excerpt opens its exact message. Distinguish title matches (`seq = -1`) from message matches and open the session for title-only results.
- Add a grouped desktop query alongside existing `search_sessions`: input is query, existing filter, sort, offset, and page size; output is session groups plus total sessions and total message matches. Default to 50 session groups. Add a query for one session's matching excerpts, paged at 20. Existing CLI/MCP search text and raw-hit callers remain compatible.
- Reuse FTS5 trigram matching and the short-query substring path. Preserve case-insensitive, punctuation, multilingual, and current all-terms matching semantics. Do not interpret arbitrary user text as raw FTS syntax.
- Default to relevance. Rank title-matching sessions first, then best FTS5 `bm25` score, then update time and session key for deterministic ties. For the short-query fallback, use title match then update time/key. Recent sorting ignores relevance and uses update time/key. Session pins do not override search ranking.
- Generate snippets around an actual case-insensitive match with valid Unicode boundaries. Highlight plain snippet text using React text nodes and `<mark>`; never insert highlighted user content as HTML. Count matching rows with `seq >= 0` separately from title rows.
- Retain the previous results during debounce and reject stale responses. Make archive inclusion honor the checkbox rather than secretly forcing archived results on; explain this visible change in docs.
- Apply filters before grouping and paging. Avoid per-hit session queries by joining metadata once. Do not increase the old 100-hit cap and then group it in the UI, which would still hide sessions.

### Acceptance checks

- A session with hundreds of matching messages occupies one row without suppressing other matching sessions. Counts and pagination agree.
- Test title-only matches, multiple excerpts, relevance versus recent, stable ties, archive inclusion, starred/project/agent filters, Unicode, mixed-case snippets, punctuation, two-character queries, and stale responses.
- Run CLI/MCP parity checks and the existing benchmark. Measure grouped queries too: target p95 below the existing 100 ms search budget on the documented fixture; publish revised claims only after measurement.

### Site and release contents

- Replace the demo's first-message-only search with grouped multi-hit fixtures, title matches, both sorts, and paging. Use identical documented matching semantics; verify the examples used in the landing page.
- Update Search docs, preview guidance, README search text, and the search feature card. Retain historical benchmark wording with its fixture/date or update it with new measurements.
- Proposed changelog: **Added:** Relevance and recent search sorting, expandable matches, and match highlighting. **Changed:** Search groups results by session and respects the archive filter.

## Transcript navigation

**Release:** 1.0.3, tag `v1.0.3`. Depends on grouped search.

### Behavior and implementation

- Add Find in transcript with a case-insensitive literal query, a match counter, next/previous controls, and first/last-message buttons. Scope Cmd/Ctrl+F to the active transcript; in the embedded preview intercept it only when focus is inside the preview. Enter advances, Shift+Enter goes back, Escape closes find. Do not capture terminal or note-editor input.
- Search visible message text and textual tool input/output already available in the loaded transcript. Search thinking only when explicitly enabled. Match navigation opens the relevant disclosure and highlights its text; images are not OCR-searched.
- Add a Prompts only toggle containing user messages of kind text. Navigation counts reflect visible content. Opening a global search hit that is hidden by this mode restores the full transcript before jumping.
- Keep selected message sequence and highlight separate from array position. Support previous/next wraparound. Preserve find state during refresh of the same session; reset on another session.
- Use existing transcript loading and message IDs. No new core API, parser, or indexing format is required. Preserve Markdown formatting and safe rendering while adding highlights.

### Acceptance checks

- Verify first/last navigation, repeated matches inside one message, mixed-case/Unicode/punctuation queries, no matches, wraparound, disclosure opening, and prompts-only behavior.
- Verify shortcuts do not interfere with terminals, editable fields, or the containing website. Test keyboard-only use and reduced-motion preferences.
- Refresh while finding and open a grouped-search excerpt hidden by the current view mode.

### Site and release contents

- Add a longer sample transcript with repeated terms and tool-output matches. Existing shared UI provides the demo feature automatically.
- Add Transcript navigation docs and update the keyboard shortcut table; adjust preview guidance to demonstrate find.
- Proposed changelog: **Added:** Find within transcripts, next and previous matches, prompts-only reading, and first/last-message navigation.

## Message bookmarks and notes

**Release:** 1.0.4, tag `v1.0.4`. Depends on transcript navigation.

### Behavior and implementation

- Add a bookmark button to each message and an editable plain-text note, capped at 4,000 characters. Add a Bookmarks library destination searchable by note, saved excerpt, and session title, with existing project/agent filtering. Order by bookmark update time.
- Store records in a new `message_bookmarks` SQLite table with primary key `(session_key, seq)`, note, excerpt snapshot capped at 500 characters, exact message-text SHA-256, and created/updated timestamps. Add the small hashing dependency only if no installed/shared hashing utility can provide SHA-256; do not store another full transcript.
- Add bookmark list/upsert/delete commands. Validate the session and message when creating; validate note length at the command boundary. Save notes explicitly, show unsaved state, and keep editor text if saving fails.
- Preserve this table through rescans, derived-fact rebuilds, source pruning, and source disappearance. Do not add a cascade to indexed sessions. Show unavailable bookmarks with their saved excerpts; let users remove them manually.
- On opening, compare the message's stored text hash with the saved hash. If it changed, display a Changed since bookmarking warning and require an explicit update to replace the excerpt/hash. Do not silently attach an old note to different text at the same sequence.
- This is additive user-data storage, separate from the Intelligence derivation version. Document that bookmarks cannot be reconstructed from agent files. Include Export bookmarks and Import bookmarks as a versioned JSON backup in Settings Data; validate the entire import before a transaction, preserve existing newer notes by default, and never silently overwrite conflicting notes. Show conflicts for explicit replacement.
- Keep stars and pins as session actions. This release adds no tags, folder hierarchy, or write-capable MCP tool.

### Acceptance checks

- Upgrade an index from the preceding release; bookmark, edit, restart, rescan, and rebuild derived facts without losing notes. Test both write and read-only CLI/MCP database opens.
- Test unavailable/changed messages, identical local and remote native IDs, duplicate bookmark clicks, import conflicts, malformed backup, save failure, and source pruning.
- Export/import into an isolated index and verify round-trip note preservation. Keyboard access and focus restoration work for note editing.

### Site and release contents

- Implement bookmark commands in demo memory with sample bookmarks and notes. Provide browser downloads for bookmark backup and a browser file picker for importing synthetic backup files; reset demo state on reload and state that clearly.
- Add Bookmarks docs and explain backup, changed-message warnings, and the distinction between a rebuildable index and irreplaceable annotations. Add a small landing feature mention and README bullet.
- Proposed changelog: **Added:** Message bookmarks, editable notes, a bookmark library, and JSON backup/restore for bookmarks.

## Richer filters and complete browsing

**Release:** 1.0.5, tag `v1.0.5`. Depends on grouped search and bookmarks.

### Behavior and implementation

- Add native date inputs, model and host selects, and Clear filters. Combine them with existing agent, project, starred, and archive controls. A host selector distinguishes all hosts, local sessions, and one remote host. Derive filter choices from the full library, not the current page.
- Extend shared query types with optional `updated_from_ms`, `updated_before_ms`, and model, plus an explicit local-only selector. Dates filter session update time; convert local calendar boundaries to an inclusive start and exclusive next-day end, respecting DST. Reject inverted date ranges.
- Add a desktop session-page command returning `{items, total, offset, limit}` with 100 sessions per page. Existing list command remains available for CLI/MCP compatibility. Extend the grouped search page query from the grouped-search release with the same filters. Bookmarks filter via their linked session metadata; unavailable bookmarks remain accessible under All.
- Display Showing X of Y sessions and Load more for the library and grouped search; counts never pretend a capped page is the full library. Reset pagination on query/filter/sort change and when the index changes. Deduplicate appended keys, and discard stale page responses.
- Preserve session selection even when filters hide it, with a clear Outside current filters label. Keep all ordinary browsing pinned-first then updated-time/key. Persist only the last chosen search sort and filter controls in existing preferences; do not introduce saved searches yet.
- Apply predicates in shared core queries before limits. Normalize legacy serialized queries with defaults so omitted fields preserve previous behavior. Existing CLI/MCP `since` keeps its documented meaning; desktop date range is an additive interface.

### Acceptance checks

- Browse more than 500 sessions and search more than 100 matching sessions to completion. Verify counts, ordering, page boundaries, pins, and duplicate prevention.
- Test every filter independently and combined; local versus remote hosts; null models/timestamps; DST transitions and date end boundaries.
- Test changing filters during page load, source updates during browsing, hidden selection, preference restore, and old query payloads. Benchmark filtered pages and grouped counts on a larger synthetic library as well as the existing fixture.

### Site and release contents

- Extend demo fixtures with multiple hosts, archived sessions, unknown models, and enough synthetic sessions to demonstrate paging. Respect actual limits/offsets and matching totals in every demo query.
- Update Search and library docs, explain date semantics and filters, and revise preview instructions. Keep actual model names in fixtures clearly illustrative.
- Proposed changelog: **Added:** Date, model, and host filters, complete library browsing, result totals, and Load more. **Fixed:** Libraries larger than the initial page remain accessible.

## Copy context for another agent

**Release:** 1.0.6, tag `v1.0.6`. Depends on bookmarks and transcript navigation.

### Behavior and implementation

- Add explicit message selection and Copy context. Support selected transcript messages and selected bookmarks from multiple sessions. Default tools, thinking, and images off. Exclude internal meta/system messages; include only chosen user/assistant content.
- Build a Markdown preview containing each source's session title, agent, project, timestamp when available, message sequence, and existing `ronda://session/<key>#<seq>` reference. Use the source's actual text, not an invented summary. Group by session and order messages by sequence.
- Allow optional tool input/output inclusion and local editing of the draft before copying. Strip nothing silently. Warn that selected text can contain secrets and personal paths, while keeping the final preview fully inspectable. Never send the draft to another agent or server automatically.
- Cap generated drafts at 100,000 characters. Reject an oversized selection with a request to reduce it; do not quietly truncate. Clipboard failure leaves the draft available for retry. Native Markdown export uses the existing save dialog and reports failures.
- Use one pure formatter shared by preview/copy/export. No new agent adapter or automatic native session conversion. References are local identifiers, not promised OS deep links; another agent can resolve them through the existing MCP tools.

### Acceptance checks

- Copy several messages in order, including code fences, Unicode, and multiple projects. Verify defaults exclude tool output, thinking, image payloads, and internal context.
- Verify optional tool inclusion, edited draft copying, size rejection, unavailable bookmarked content, clipboard rejection, cancelled export, and complete Markdown export.
- Confirm the operation performs no network requests and runs no agent commands.

### Site and release contents

- Make sample context copying work through the browser clipboard with user interaction; export through a browser Blob download. Explain that users paste it into their chosen agent themselves.
- Add Copy context docs and cross-agent workflow examples. Update the landing feature list and README to describe selected excerpts, rather than native session transfer or automatic memory.
- Proposed changelog: **Added:** Preview, copy, and export selected messages as a context bundle for another coding agent.

## Project overview

**Release:** 1.0.7, tag `v1.0.7`. Depends on filters, bookmarks, and context copying.

### Behavior and implementation

- Make a project selection open a project overview in the detail pane while filtering the session list. Show ten recent root sessions, ten recent bookmarks, five recurring errors, and existing project Intelligence totals for the last 30 days. Provide View all links to the corresponding filtered views.
- Use existing project paths as identity and show full paths where basenames collide. Preserve host labels; do not merge different folders just because they share a basename. A path present on multiple hosts can be viewed together or narrowed by host.
- Add a read-only `get_project_overview` command returning the bounded sections and their total counts. Reuse existing store, bookmark, and Intelligence queries; apply host filtering to every section if selected. Do not compute summary totals from the current 100-row library page.
- Label outcomes as inferred from recorded tool events. Show missing-tool/timestamp coverage where it affects the figures. Do not describe committed sessions as verified fixes or fabricate a next action.
- All rows open an exact session/message through the existing open-request mechanism. Keep the project view in existing navigation history; returning from a transcript restores project context. Refresh only while visible and mark stale otherwise.

### Acceptance checks

- Test an empty project, identical basenames, mixed agents/hosts, large project totals, unavailable bookmarks, and missing Intelligence coverage.
- Verify drill-downs, View all filters, back/forward behavior, current-session navigation, and refresh after a source change.
- Verify all sections respect the same project/host identity and that an unavailable analytics section does not hide usable sessions.

### Site and release contents

- Add coherent project sample data and the overview demo command. Ensure numbers agree with the sample sessions instead of reusing unrelated scaled global statistics.
- Add Projects docs, a landing mention, and README description. Link the dedicated Intelligence page to the project workflow without creating another marketing page.
- Proposed changelog: **Added:** Project overviews bring recent sessions, bookmarks, recurring errors, and local Intelligence together.

## Find this error in history

**Release:** 1.0.8, tag `v1.0.8`. Depends on project overview for its entry point; the core capability already exists.

### Behavior and implementation

- Add Find error history in global search and project overview, plus a message/tool-output action that pre-fills the selected error text. Use a multiline text input and a submit action; do not run expensive lookups on every keystroke.
- Expose a typed Tauri result wrapping the existing `Store::find_error`/normalized signature logic. Share lookup behavior with CLI/MCP and leave their text output compatible. Add optional project and host filters and 20-session paging for desktop results, applied before limits.
- Show canonical error text, total matched sessions, recorded outcome, project/agent/host, and clickable evidence at the error sequence. Describe results as previous occurrences, never confirmed fixes. A committed session only means a commit command was observed.
- Reject empty input and input above 20,000 characters. Explain no-match and missing-tool-coverage states. Offer ordinary transcript search for wording that is not recognized as a recorded error.
- Do not add embeddings, a second error normalizer, or automatic agent execution. Opening surrounding evidence uses the current transcript navigation.

### Acceptance checks

- Equivalent errors with different paths, line numbers, and volatile values return matching occurrences. Distinct normalized errors stay separate.
- Verify unknown errors, unsupported transcript coverage, missing sessions, repeated errors within one session, project/host filtering, paging, and exact message jumps.
- Run CLI/MCP parity and validate that no output calls a session fixed solely because it committed.

### Site and release contents

- Add repeated synthetic error events and a demo command returning typed results. Let visitors paste the documented sample error and inspect different sessions.
- Extend Intelligence and MCP docs with the desktop entry points and evidence limitations. Add a preview suggestion and README sentence; reuse the existing Intelligence marketing page.
- Proposed changelog: **Added:** Search previous error occurrences directly in the desktop app and jump to their recorded evidence.

## Related sessions and subagent navigation

**Release:** 1.0.9, tag `v1.0.9`. Depends on project and error history interfaces.

### Behavior and implementation

- Add Parent and Subagents navigation to a transcript header. Load relationships directly rather than relying on the root-session list, which intentionally hides children. Reuse the CLI's host-aware parent matching, including legacy parent-key forms.
- Add a Related sessions section showing up to five root sessions in the same project and host. Order by number of shared normalized error signatures, then shared normalized edit/read file paths, then recency/key. If neither signal is present, show recent project sessions explicitly labeled Same project.
- Reuse indexed `error_events` and `tool_events`. Normalize tool file paths relative to the known project when safely possible; do not resolve remote paths on the local filesystem. Skip comparisons for paths that cannot be normalized consistently.
- Return typed relationship and related-session data with an explanation for each suggestion: Subagent, Shared error, Shared files, or Same project. Exclude the current session, tombstoned/unavailable sources, and duplicate keys. Do not call proximity proof of the same task.
- Fetch on selection and refresh when the library changes. Query only bounded indexed candidates in the selected project/host; avoid a whole-library pairwise similarity pass or persistent similarity table.
- Expose child counts and parent navigation without allowing unsupported child resume/trash actions. Show empty states for agents whose children were never indexed; do not imply complete agent ancestry.

### Acceptance checks

- Test local and remote parents with identical native IDs, legacy keys, absent parents, several children, unknown child titles, and direct opening of a child.
- Verify ranking with shared errors/files, path separator normalization, same-project fallback, deterministic ties, duplicates, and removed sources.
- Test parent/child back navigation and benchmark a project with thousands of synthetic sessions. Keep the query below 100 ms p95 on the recorded test machine or tighten candidate SQL before shipping.

### Site and release contents

- Add a synthetic parent with two children and several related sessions; implement their demo commands and explanation labels.
- Add related-session/subagent documentation, note coverage limitations, and update preview examples. No new landing section is needed; extend the project/context feature copy.
- Proposed changelog: **Added:** Navigate indexed subagents and discover related project sessions through shared errors and file activity.

## Resume readiness

**Release:** 1.0.10, tag `v1.0.10`. Depends on the prior navigation work; adapters already provide resume specifications.

### Behavior and implementation

- Extract read-only resume inspection from the shared `resume_plan` flow. Return support status, local/remote location, effective directory, program/args, display command, and structured reasons such as Unsupported agent, Unknown project, Missing folder, Missing executable, or Remote environment not checked.
- Use the same plan resolution for embedded terminal, restart, and external terminal. Inspect again immediately before execution because filesystem and configuration can change. Prevent UI checks from being the only guard.
- On local sessions verify the project directory and executable availability in the actual launch environment. POSIX checks use the configured login shell's PATH; invoke only a fixed executable-lookup script with the adapter program passed as a quoted argument, with a short timeout. Windows checks use the same PowerShell environment used for launch. Do not rely on the GUI process PATH or install packages automatically.
- If inspection cannot complete, distinguish Unknown from Missing. Never probe SSH just by selecting a remote session; mark remote executable/folder availability unchecked and explain that launch reports SSH/auth/environment failures. Local SSH availability can be inspected.
- Add Choose project folder for missing/moved local projects using the native dialog. Persist an exact original-path-to-new-path mapping in existing preferences, scoped to local sessions. Share it among sessions from that exact path, show the effective path, and allow removing the mapping in Settings. Keep source metadata and source files untouched. Do not apply local mappings to remote sessions.
- Keep command construction and platform quoting in the existing shared functions. Folder names and mappings are data, never interpolated without escaping. Revalidate mapped directories and reject child sessions that cannot independently resume.
- Display capability reasons where Resume is unavailable, even when project metadata is missing. Offer copyable commands where useful, but never report successful agent startup just because a login shell spawned. Existing terminal errors remain visible.

### Acceptance checks

- Test supported/unsupported adapters, unknown folders, moved folders, mapping persistence/removal, missing binaries, binaries available only in login-shell PATH, and inspection timeout.
- Test spaces, quotes, Unicode, shell metacharacters, Windows drive/UNC paths, remote sessions, and same native ID on different hosts.
- Verify embedded resume, restart, and external terminal all use the same mapping and restrictions. Run installed-app smoke tests on macOS, Windows, and Linux; selection/inspection must not start an agent or SSH connection.

### Site and release contents

- Provide sample readiness states and an explicit Desktop required response for real resume actions. The browser may demonstrate folder mapping with a synthetic choice, but must label it Sample folder and never claim to inspect the visitor's machine.
- Update Resume, Locations, Remote hosts, and troubleshooting documentation; mention folder recovery in README. Ensure the preview's existing resume stub no longer claims a real terminal was opened.
- Proposed changelog: **Added:** Resume readiness explanations and recoverable project-folder mappings. **Fixed:** Embedded and external resumes consistently validate their effective launch directory.

## Completion and follow-up

For each feature, record the merged PR, tagged commit SHA, GitHub release URL, successful build/site run URLs, acceptance evidence, and any measured performance results in the implementation PR or release notes. Avoid a second release ledger with duplicated changelog content.

Keep the first versions local and explicit: no cloud collaboration, automatic summarization, semantic search service, agent orchestration, or new telemetry. Revisit those only after observed usage demonstrates that the delivered workflow cannot meet a concrete need.

The existing launch video and brand assets can remain accurate as an introduction to the original product. Update screenshots used as current-interface documentation when affected; refresh promotional media after the bookmarks/context/project releases only if it materially helps explain the new product. Creating new videos is a separate task.

## Implementation status

- 2026-10-02: Work started in an isolated `ronda/live-transcripts` worktree with Ronda bot authentication verified. Live transcript and search refresh, regression coverage, sample preview updates, and release/site coordination are implemented. Local Rust checks and macOS app/DMG builds pass. The packaged app received watcher updates, kept a synthetic terminal running across hidden-page refresh, and opened a v1.0.0-created index with its transcript/star/pin preserved. A manual source-write-to-AX observation upper bound was 8.93 seconds, including tool observation overhead; this is not an index benchmark or a precise paint measurement. CI, publication, and production-site verification remain release gates. No release has been published for this work yet.

- 2026-10-02: Live-transcript PR #1 merged at `a675adde301b754d2326fe0d15c862f8210d7398` after all five installer targets and their sidecar checks passed. Main CI is running before tagging `v1.0.1`; publication and production-site verification remain pending.
- 2026-10-02: Grouped search is implemented on `ronda/search-results`, preparing patch `v1.0.2`. Local checks pass: 10 frontend/site tests, TypeScript, 40 Rust tests, Clippy, release checks, and desktop/site builds. The macOS package opened a v1.0.0-created index, counted 25 native matching messages, opened an excerpt, and loaded both excerpt pages. The browser preview demonstrates 54 active matching sample sessions, both sorts, archive inclusion, and session/match paging without console errors. Grouped-query p95 was 14.70 ms on the documented 800 MiB fixture. Packaging CI and release/site publication remain pending.
- 2026-10-02: Grouped search [PR #2](https://github.com/tryronda/ronda/pull/2) passed the check job and all five platform installer jobs in [run 37042482679](https://github.com/tryronda/ronda/actions/runs/37042482679). It is ready for review; merge and release remain sequenced after the first feature release.
- 2026-10-02: Transcript navigation is implemented on `ronda/transcript-navigation`, with 1.0.3 version sources and changelog prepared. Twelve frontend/site checks cover literal/Unicode matches, wrapping, disclosures, shortcut scope, refresh, reduced motion, and restoring full view for a global excerpt. Browser verification exercised Markdown, code and tool-output matches, optional thinking, prompts-only counts, exact excerpt jumps, and live appends. Local 1.0.3 DMG/app packaging and packaged CLI/MCP version checks passed. The macOS app loaded the existing 1.0.0 index with star/pin flags intact; native checks verified five rendered-text/tool matches, six with thinking enabled, Enter navigation, automatic disclosure opening, prompts-only counts, Escape/Cmd+F, session reset, and terminal shortcut isolation using a synthetic shell. CI, publication, and production-site verification remain open gates.

- 2026-10-02: Bookmark work started on `ronda/message-bookmarks`. Additive user-data storage, exact message-text SHA-256, capped notes/excerpt snapshots, changed/unavailable detection, and transactional JSON backup/import commands are implemented. A runnable storage check covers preceding-schema upgrade, restart/read-only opens, reindex/derived rebuild, local/remote identity separation, pruning, duplicate clicks, malformed backups, stale saves, explicit import conflicts, round trips, and failed-write rollback. Workspace tests (41) and Clippy pass. The note-editor component passes failed-draft retention, plain-text rendering, explicit snapshot refresh, and keyboard/focus checks; library/transcript integration, Settings backup UI, demo, docs, and release gates remain unfinished.

- 2026-10-02: Bookmark transcript/library integration, project/agent and note/excerpt/title search, Settings JSON export/import with explicit conflict review, browser sample commands, docs, landing mention, and README backup guidance are implemented. Sixteen frontend/site checks and TypeScript pass; workspace storage checks (41 tests), the timestamp-overflow rollback check, and Clippy pass. Browser verification created a bookmark, saved a plain-text note on an unavailable message with focus restored, downloaded and inspected a three-record JSON backup, kept an import conflict until explicit replacement, and found the imported note in the library. Native package, CI, release, and production-site gates remain pending. Screenshot: `docs/screenshots/message-bookmarks.png`.
- 2026-10-02: Navigation CI run 37044774990 passed checks and four installer targets, but macOS arm compiled/signed successfully and failed six seconds into DMG bundling with the same generic error seen on main. Verbose installer output is now carried into this branch for diagnosis. The separate 1.0.1 diagnostics PR passed all five installer targets; navigation publication still requires its own complete green run.

- 2026-10-02: Navigation run [37046749424](https://github.com/tryronda/ronda/actions/runs/37046749424) passed checks and all five installer targets for `55a6440`. Main run [37046741403](https://github.com/tryronda/ronda/actions/runs/37046741403) passed for `71bbc56`. The bot-authored annotated `v1.0.1` tag was pushed at that commit; release run [37048100803](https://github.com/tryronda/ronda/actions/runs/37048100803) is building before installer publication and site deployment. Release and production-site verification are still pending.

- 2026-10-02: Bookmark version sources and dated changelog are prepared for patch 1.0.4. Release consistency and four mocked publisher checks pass; the mocked publisher output is not evidence of a live release. Local macOS packaging is running before native backup/import verification.
