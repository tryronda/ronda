# Ronda feature and release plan

Maintained on 2026-10-03. The original ten improvements shipped through v1.0.10. The current release cycle is preserving bookmark note drafts for v1.0.11, followed by Open project folder for v1.0.12. The historical 1.0.0 assessment and initial ten-feature plans remain below; the execution ledger tracks completed releases and verification.

The goal is faster context recovery and reuse for individual developers. Each feature ships as a separately reviewable desktop release, with matching documentation and a working browser demonstration. The first cycle shipped patches 1.0.1 through 1.0.10. Check remote tags and releases before allocating each follow-up version; hotfixes can consume patch numbers without changing feature order.

## Current status verified 2026-10-03

- `origin/main` and the latest published GitHub release are v1.0.10 at `8df378f0ac5770d659dee3870b9c728fa6176169`. Patches 1.0.1–1.0.10 from the original plan have been shipped.
- PR [#13](https://github.com/tryronda/ronda/pull/13) prepares 1.0.11, preserving bookmark note drafts. Its source checks, five package jobs, and installed Windows/Linux smoke checks passed in [CI run 37089199985](https://github.com/tryronda/ronda/actions/runs/37089199985). A separately packaged macOS app also passed synthetic-data verification for draft preservation across navigation/restart and Escape discard behavior. A changelog date correction is running through PR checks; the release remains untagged.
- The live product site at [tryronda.cloud](https://tryronda.cloud/) responds successfully and currently reflects the 1.0.10 release. `site/changelog/releases.ts` derives changelog entries from `CHANGELOG.md`; no separate web changelog should be maintained.
- The next candidate is follow-up 12 below, branch `ronda/open-project-folder`, patch 1.0.12 after 1.0.11. Four additional candidates are ranked below with their own scope, acceptance, and release records.

## Initial findings at 1.0.0 (historical snapshot)

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

## Original release order (shipped)

The refresh fix shipped first because it corrected existing behavior. The remaining releases added capabilities in dependency order.

| Order | Feature | Released version and tag | GitHub release title | Branch |
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

## Follow-up: preserve bookmark note drafts

Research after the ten-release cycle reproduced silent draft loss in the production preview: edit bookmarked message #1, enter unsaved text, switch to All sessions, return to Bookmarks, and reopen the note. The saved note replaced the draft. Individual message/tool copying and per-session reading-position restoration are useful later candidates; draft loss is the smallest demonstrated problem to fix first.

Release: **1.0.11 / `v1.0.11`**, title **Ronda 1.0.11**, branch **`ronda/bookmark-note-drafts`**. Allocate the patch only while the remote tag is available. Continue the bot author/committer/tagger and Ronda App conventions above.

Implementation and boundaries:

1. Keep app-session editor state in the already-mounted Workbench, using the existing JSON session/message identity helper and React record-state pattern. Pass it to both transcript and bookmark-list controls. Retain note text and its original optimistic timestamp through navigation, filters, prompts-only, and source refresh.
2. Keep editor visibility and focus local. Closing the editor retains a draft; Cancel note and Escape explicitly discard it. Save is the only action that stores the note. Drafts remain memory-only and reset when the app closes or the preview reloads; no database migration, storage layer, new dependency, or backend contract is required.
3. Share the per-bookmark busy/error state to prevent two displayed controls from editing during the same outstanding write. Capture each operation's session/message identity; completing a save on A must not clear B's draft. Preserve failed drafts and optimistic conflict checks, and refuse automatic recreation after external bookmark removal.
4. Apply a successful saved/deleted bookmark to the local list before reloading it. Clear only its draft after a successful write. If the list refresh fails after a write, report that the write succeeded and keep the new local timestamp, preventing a false conflict on retry. Snapshot-only updates preserve a retained note draft.
5. Update the bookmark documentation, README, and preview instructions with retention, deliberate discard, explicit Save, and app-session lifetime. The shared frontend gives the synthetic demo the same behavior without new commands. Prepare a dated Fixed changelog section and synchronized package/Cargo/config/lockfile versions.

Acceptance and delivery:

- A regression must fail against 1.0.10 by restoring the old saved note instead of an unsaved Unicode draft, then pass with this change. Check bookmark/transcript sharing, filters, A→B→A with equal sequences, prompts-only, refresh, Cancel/Escape, failed saves, external changes/removal, and successful write followed by failed refresh. A deferred save must lock duplicate A controls and leave B's draft untouched.
- Package and check the native app against an isolated synthetic index: edit a draft, browse sessions/Bookmarks/Settings, return and Save, restart, and verify that only the saved note persisted and source bytes are unchanged. No index benchmark is needed because indexing is unchanged.
- Run the common source, sidecar, release, site, and native checks. Review/merge the exact checked bot-authored commit, annotate its version tag, and let CI build all five targets and run installed resume smoke before publishing seven installers and SHA256SUMS.txt.
- Independently verify the published source and installer checksums, then verify matching production highlights/changelog/downloads/docs, retained drafts, deliberate discard, saved-note behavior, and console output. Begin the next research iteration only after these release/site gates complete.

## Implementation status

- 2026-10-02: Live transcripts merged through [PR #1](https://github.com/tryronda/ronda/pull/1). Local checks, installed-app refresh and terminal checks, existing-index compatibility, and all five PR installer builds passed. The main build compiled and signed macOS arm successfully but failed during DMG packaging without the underlying error in its log; verbose installer output is enabled for diagnosis. Publication and production-site verification remain open gates. No feature release has been published yet.

- 2026-10-02: Grouped search is implemented on `ronda/search-results`, preparing patch `v1.0.2`. Local checks pass: 10 frontend/site tests, TypeScript, 40 Rust tests, Clippy, release checks, and desktop/site builds. The macOS package opened a v1.0.0-created index, counted 25 native matching messages, opened an excerpt, and loaded both excerpt pages. The browser preview demonstrates 54 active matching sample sessions, both sorts, archive inclusion, and session/match paging without console errors. Grouped-query p95 was 14.70 ms on the documented 800 MiB fixture. Packaging CI and release/site publication remain pending.
- 2026-10-02: Grouped search [PR #2](https://github.com/tryronda/ronda/pull/2) passed the check job and all five platform installer jobs in [run 37042482679](https://github.com/tryronda/ronda/actions/runs/37042482679). It is ready for review; merge and release remain sequenced after the first feature release.
- 2026-10-02: Transcript navigation is implemented on `ronda/transcript-navigation`, with 1.0.3 version sources and changelog prepared. Twelve frontend/site checks cover literal/Unicode matches, wrapping, disclosures, shortcut scope, refresh, reduced motion, and restoring full view for a global excerpt. Browser verification exercised Markdown, code and tool-output matches, optional thinking, prompts-only counts, exact excerpt jumps, and live appends. Local 1.0.3 DMG/app packaging and packaged CLI/MCP version checks passed. The macOS app loaded the existing 1.0.0 index with star/pin flags intact; native checks verified five rendered-text/tool matches, six with thinking enabled, Enter navigation, automatic disclosure opening, prompts-only counts, Escape/Cmd+F, session reset, and terminal shortcut isolation using a synthetic shell. CI, publication, and production-site verification remain open gates.

- 2026-10-02: Bookmark work started on `ronda/message-bookmarks`. Additive user-data storage, exact message-text SHA-256, capped notes/excerpt snapshots, changed/unavailable detection, and transactional JSON backup/import commands are implemented. A runnable storage check covers preceding-schema upgrade, restart/read-only opens, reindex/derived rebuild, local/remote identity separation, pruning, duplicate clicks, malformed backups, stale saves, explicit import conflicts, round trips, and failed-write rollback. Workspace tests (41) and Clippy pass. The note-editor component passes failed-draft retention, plain-text rendering, explicit snapshot refresh, and keyboard/focus checks; library/transcript integration, Settings backup UI, demo, docs, and release gates remain unfinished.

- 2026-10-02: Bookmark transcript/library integration, project/agent and note/excerpt/title search, Settings JSON export/import with explicit conflict review, browser sample commands, docs, landing mention, and README backup guidance are implemented. Sixteen frontend/site checks and TypeScript pass; workspace storage checks (41 tests), the timestamp-overflow rollback check, and Clippy pass. Browser verification created a bookmark, saved a plain-text note on an unavailable message with focus restored, downloaded and inspected a three-record JSON backup, kept an import conflict until explicit replacement, and found the imported note in the library. Native package, CI, release, and production-site gates remain pending. Screenshot: `docs/screenshots/message-bookmarks.png`.
- 2026-10-02: Navigation CI run 37044774990 passed checks and four installer targets, but macOS arm compiled/signed successfully and failed six seconds into DMG bundling with the same generic error seen on main. Verbose installer output is now carried into this branch for diagnosis. The separate 1.0.1 diagnostics PR passed all five installer targets; navigation publication still requires its own complete green run.

- 2026-10-02: Navigation run [37046749424](https://github.com/tryronda/ronda/actions/runs/37046749424) passed checks and all five installer targets for `55a6440`. Main run [37046741403](https://github.com/tryronda/ronda/actions/runs/37046741403) passed for `71bbc56`. The bot-authored annotated `v1.0.1` tag was pushed at that commit; release run [37048100803](https://github.com/tryronda/ronda/actions/runs/37048100803) is building before installer publication and site deployment. Release and production-site verification are still pending.

- 2026-10-02: Bookmark version sources and dated changelog are prepared for patch 1.0.4. Release consistency and four mocked publisher checks pass; the mocked publisher output is not evidence of a live release. Local macOS packaging is running before native backup/import verification.

- 2026-10-02: v1.0.1 installers are published from 71bbc56; all seven downloaded assets passed the published checksums. Site deployment failed because github-pages permits main, not release tags. PR #6 routes publication through a main repository-dispatch workflow that still checks out and verifies the published tag; its CI is running. Bookmark PR #5 passed checks and all five installers for a60c157. Native 1.0.4 package/app/CLI/MCP checks, note editing/focus, export, conflict review/replacement, and index rebuild passed. A read-only check after app restart confirmed the imported note/excerpt and existing star flag remain; native UI restart verification awaits the Mac being unlocked.

- 2026-10-02: Feature 5 started on ronda/library-filters. Shared query defaults preserve old payloads, and core date/model/local/remote predicates apply before result limits. The native session-page command returns exact root-session totals and up to 100 items, preserving pinned/update/key order. A 600-session check covers complete library/grouped-search pages, duplicate prevention, pin/tie order, null models, independent/combined filters, date end boundaries, legacy limits/payloads, and invalid ranges. Bookmark filtering uses linked metadata for host/model/date filters, keeping unavailable records accessible under All. Workspace tests (42) and Clippy pass. Desktop controls, local-calendar/DST handling, preferences, demo/docs, benchmarks, and release gates remain unfinished.

- 2026-10-02: v1.0.1 site repair PR #6 is merged and Pages run 37051266869 succeeded. Production changelog, landing release highlights, transcript-refresh docs, download names, and a visible appended sample transcript message were verified. Filter frontend contracts and the preview now support exact-total root-session pages and date/model/local/remote predicates shared across browse, search, and bookmark metadata. Legacy query payloads remain supported. Frontend checks pass (17 tests and TypeScript), and the desktop production build passes. Filter controls, full-library option lists, preference restore, race-safe Load more, larger preview fixtures, benchmarks, and release gates remain open.

- 2026-10-02: Filter controls and full-library options are implemented with additive core/Tauri queries. Independent/combined model and host filters, hidden selections, native end-day filtering, Clear filters, and inverted ranges were verified in the preview; input events keep native date edits immediately reactive. The calendar check passed in New York (23/25-hour days) and São Paulo (skipped midnight), alongside 19 frontend tests/TypeScript, 42 workspace Rust tests, and Clippy. Search/library docs and Unreleased notes describe the implemented controls. Browse/search Load more, preference restore, larger demo and benchmark fixtures, native checks, and release publication remain required before feature 5 is ready.

- 2026-10-02: Bookmarks native restart verification is complete: the packaged 1.0.4 app displayed its imported note and saved excerpt after restart, and opening the bookmark from prompts-only view restored the assistant message. PR #5 is ready for review on a60c157 after check plus all five installer targets passed in run 37049066478. Its merge/release/site publication remains sequenced after patches 1.0.2 and 1.0.3.

- 2026-10-02: Filter browsing/search Load more and preference restore are implemented. The workbench reports exact totals, keeps full-library choices, appends unique keys, resets pages on query/filter/sort/index changes, and invalidates pending pages immediately on source notifications while coalescing refreshes. Home stats use backend totals instead of the loaded page. Twenty-two frontend checks cover 601-row completion, duplicate pages, pending source/filter updates, hidden selections, validated preference restore and serialized writes. The browser completed all 616 active sample sessions and all 540 matching search groups; clearing search reset browsing to 100. Baseline filtered 800 MiB / 300-session p95: library page 2.64 ms, options 2.34 ms, grouped search 27.18 ms (warm read-only connection; excludes startup/UI paint). The larger 6,000-session benchmark is still indexing; its results, native feature-5 checks, release version preparation, CI, publication, and live-site verification remain gates.

- 2026-10-02: The complete paging/preference checks pass on the current implementation (22 frontend tests and TypeScript; Clippy including the benchmark example). The 601-row DOM correctness check has a 15-second per-test allowance for slower hosts after exceeding its former 5-second limit under concurrent indexing; query/UI performance is measured separately. Source notifications and filter changes during a pending page discard that response. Native date/model/host controls in the browser distinguish a remote host literally named local from Local sessions, preserve its open transcript outside filters, and restore full-library totals after Clear filters. Search v1.0.2 release run 37053019776 and updated navigation CI run 37053087391 are live.
- 2026-10-02: Search PR #2 passed checks and all five installer targets in run 37042482679. The verified main installer diagnostics are merged into this branch. Main run 37046741403 passed; the bot-authored v1.0.1 tag now points to 71bbc56 and release run 37048100803 is still building. Search merge, tagging, and site publication remain sequenced after verification of that first release.
- 2026-10-02: Patch v1.0.1 published from 71bbc56 with seven installers and SHA256SUMS.txt; all seven downloaded installers passed checksum verification. Run 37048100803 passed checks, every installer, release publication, and the site build. The github-pages environment rejected the tag deployment because it allows only main. Site publication is being routed through a repository dispatch on main while checking out and verifying the published tag; environment protection rules and immutable release assets are preserved. Production-site verification remains pending.

- 2026-10-02: Patch v1.0.1 production-site gates are complete. Bot PR #6 passed every installer/check target and merged as d6daa60. Repository-dispatch Pages run 37051266869 verified and deployed the immutable v1.0.1 source. The live changelog and landing highlights show 1.0.1, install links resolve to the seven release asset names, transcript-refresh documentation is present, and appending a sample message visibly updates the selected production preview transcript. Search now carries this deployment workflow; its updated head still requires CI before merge/tagging.

- 2026-10-02: Search PR #2 passed all five installer targets plus checks on fc5e09a (run 37051538459), merged, and received the bot-authored annotated tag v1.0.2 at that exact commit. Release run 37053019776 is building; publication, installer checksum verification, and production-site verification remain open. Navigation now carries the protected-main dispatch workflow and requires CI on its updated head before its release.

- 2026-10-02: Native bookmark restart verification is complete: the packaged 1.0.4 app displayed its imported note and saved excerpt, and reopening the bookmark from prompts-only view restored the assistant message. PR #5 is ready after check and all five installer targets passed on a60c157. This branch now carries navigation fd21f9f and the protected-main published-tag site workflow; current-head CI remains required before sequenced merge/release/site publication.

- 2026-10-02: All five v1.0.2 installers passed in run 37053019776, but release publication stopped when the uploaded draft download failed; the original helper hid stderr. A bot-authenticated local download succeeded. Its exact source marker/tag and all seven checksums were verified before publishing the existing draft without reuploading assets. v1.0.2 is published; protected-main Pages run 37054383803 is deploying it. The next release adds three bounded retries for local download verification (including partial-file replacement) and prints final subprocess diagnostics; failed verification still prevents publication.

- 2026-10-02: Filter release version metadata is prepared at 1.0.5; no tag is created. The 6,000-session benchmark and retained baseline are complete and recorded in docs/benchmark.md, including the larger-profile latency ceiling. Counts remain exact (6,000 sessions/36,000 message matches); baseline filtered queries pass 100 ms, larger grouped queries do not. A snippet-deferral experiment was removed after it failed to establish a reliable improvement. Native filter verification and current-head CI remain open.

- 2026-10-02: v1.0.2 production checks confirm the landing/changelog, resolved installer links, search docs, 54 active versus 55 archived-inclusive sessions, 78/79 matching messages, both paging controls, and recent sorting. Production verification found an excerpt jump could be consumed while the transcript skeleton was mounted. The navigation release now waits for loading and a scoped message element; the local browser verified message #24 visibly inside its transcript container. This fix is queued for the next patch rather than changing the published tag.

- 2026-10-02: Copy-context implementation started in isolated ronda/copy-context, stacked on the filter branch. Transcript/bookmark selection, source resolution, a pure Markdown formatter, editable preview, browser clipboard/download, and native atomic Markdown export are implemented. Version metadata is prepared at 1.0.6; no tag or release exists. Validation, actual preview/native export checks, current-head CI, and preceding release gates remain open. The rebuilt navigation 1.0.3 app verified all 25 synthetic matches and a visible jump to message #24 on 3cb834e; the filter installer is now rebuilding.

- 2026-10-02: Copy-context checks pass: 25 frontend checks, 43 workspace Rust checks, Clippy, version agreement, publisher checks, and the prerendered site build. The browser preserved an edited draft through closing/reopening, combined Claude Code and Codex messages from two projects, explicitly regenerated tool input/output, disabled unavailable originals, and downloaded the complete 1,299-character edited Markdown with source references. Browser clipboard write reported success, but the tool's clipboard readback was empty; exact native clipboard verification remains open. Shared worktree dependency symlinks were replaced with a frozen-lockfile install after a Vite temporary-config race; no dependencies changed. Navigation PR #4 is merged at 3cb834e, annotated bot tag v1.0.3 is pushed, and release run 37056839822 is building.

- 2026-10-02: Navigation patch v1.0.3 is released and production-verified. PR #4 merged at 3cb834e; its annotated tag uses the Ronda bot identity. Release run 37056839822 and protected-main site run 37057652231 succeeded. The published source marker matches the tag, and independent downloads verified every checksum for all seven installers. The live landing/changelog/docs show 1.0.3; find wraps 1/6 to 6/6 with thinking enabled, prompts-only renders only user messages, and opening pagination excerpt #24 places its target visibly inside the transcript. Bookmarks now targets main, but its merge/tag/publication remain sequenced after these completed gates.

- 2026-10-02: The filter app was rebuilt at 705361a with paging controls outside scrolling rows. Native checks completed all 603 library sessions and all 600 matching search groups, then model filtering returned 240 exact matches. Existing bookmark and star/pin data were copied into the isolated fixture and remained indexed. Calendar/host combinations, hidden selection, and preference-restart checks remain open after an app-interaction interruption; the process is kept alive rather than restarted to treat an observation failure as terminal. Copy-context PR #8 is attached, stacked on filters, and current-head CI is running at e3c8b70.

- 2026-10-02: Filter current-head CI run 37057260634 passed checks and all five installer targets at 705361a. Native combined model/local-host/date filtering returned exactly 240 October 1 sessions; an October 2 transcript stayed open with Outside current filters when the same-day range excluded it. An intentional restart restored both October 1 date boundaries, model 0, Local sessions, and the exact 240-session total; the search query correctly reset. All previously pending native filter controls/preference gates are complete. Release remains sequenced after bookmarks. The current db74c46 bookmark package is rebuilding for a final exact-source native check. Copy-context CI passed checks and four installer targets, with Intel macOS still live.

- 2026-10-02: Copy-context app/DMG packaging passed on ad3c4ea. The native app selected original messages, preserved an edited 228-character Unicode draft, copied it through the system clipboard (verified by native paste), kept it after a cancelled save and closing/reopening, and exported bytes exactly matching the complete edited draft. Current-head CI and preceding release/site gates remain open. Project overview started in isolated ronda/project-overview: a bounded read-only core/Tauri command reuses session/bookmark queries and host-scoped Intelligence aggregation, keeping library sections available if analytics cannot load. Four Intelligence checks pass, including project path identity, a remote host literally named local, exact totals, bounded recent rows, unavailable annotations, and missing analytics tables. Frontend navigation, demo/docs, version preparation, CI and release gates remain unfinished.

- 2026-10-02: Bookmarks v1.0.4 is published from db74c469. Release run 37058826007 and Pages run 37060224878 succeeded. Independent downloads matched all seven installer checksums and the exact source marker. Production landing/changelog/docs/download names and explicit saving of an unavailable sample bookmark note were verified. Filters PR #7 merged at 705361a with complete native/CI gates; its bot-authored annotated v1.0.5 tag is pushed and release run 37060691320 is live. Copy-context now targets main and remains ready at ad3c4ea, awaiting the filter release/site gates.

- 2026-10-02: Project overview frontend, shared navigation history, host-scoped Intelligence links, coherent synthetic preview, docs, README, landing mention, and patch 1.0.7 metadata are prepared. Browser checks confirmed exact counts (305 project sessions; buildbox 82 all-time/2 in range), scoped recurring error evidence, Back/Forward, and View all preserving project/host. Twenty-eight frontend checks and TypeScript, 44 workspace Rust checks, Clippy, publisher checks, and site build pass. Core coverage includes 223 root sessions, separate full paths, a remote host named local, a child session, unavailable annotations, missing tools/timestamps, and unavailable analytics. Native package/GUI checks, current-head CI, preceding releases, and publication remain open.

- 2026-10-02: Filters v1.0.5 is published from 705361a. Release run 37060691320 and Pages run 37061664269 succeeded; independent downloads verified all seven installer checksums and the source marker. Production preview paging grew from 100 to 200 of 616 sessions, combined model/local-host filtering returned 80, and an October 2 same-day range returned zero for those older samples. Landing, search docs, installer links, and changelog are verified. Copy-context PR #8 merged at ad3c4ea and its bot-authored v1.0.6 tag is pushed; release run 37062119978 is live.

- 2026-10-02: Project overview PR #9 is attached and now targets main. Native 1.0.7 app/DMG packaging passed for code 4dac97e. Its isolated fixture showed five scoped sessions, one bookmark, one recurring error with two original evidence messages; opening error #1 and Back restored the project. Adding a third source while visible refreshed to six sessions, four tool calls, three errors and three recurring occurrences. Scoped Intelligence and View all bookmarks retained their context, and coverage explicitly reported 4/6 sessions with tools and 5/6 with usable timestamps. Native screenshot: [project overview](screenshots/project-overview.png). Current-head all-platform CI and the complete 1.0.6 release/site gates remain before 1.0.7 publication.

- 2026-10-02: Error history started in isolated ronda/error-history from the project-overview branch. The shared CLI/MCP lookup now accepts project and host scope before exact/prefix signature selection, drops deleted sources, counts repeated events once per session, and validates empty/20,000-character input. No second normalizer or dependency was added. Scoped lookup checks cover 25 sessions, separate full paths, a remote host named local, exact evidence sequences, missing sources, unknown errors and CLI/MCP parity. Desktop DTO/paging, Tauri command, multiline input/actions, coherent preview/docs/version preparation, native/CI checks and release remain unfinished.

- 2026-10-02: Copy-context v1.0.6 is published from ad3c4ea. Release run 37062119978 and Pages run 37062846344 succeeded; independent downloads verified the source marker and all seven installer checksums. Production generated a draft from original message #1, preserved an edited 58-character Unicode draft through close/reopen, copied the exact text through the browser clipboard, and reported a completed sample export. Context docs, changelog and all installer/checksum links are verified. Project-overview current-head run 37062300876 passed checks and all five installer targets at 2488095; PR #9 merged and bot-authored annotated v1.0.7 is pushed. Its release run 37063527607 is live.

- 2026-10-02: Error history now has a read-only typed Tauri command, twenty-session paging with exact counts and scoped tool coverage, an explicit-submit multiline dialog, project/host controls, message/tool/project/search actions, raw transcript-find fallback, and stale-page invalidation on library changes. Browser checks loaded 20 then all 28 originals, narrowed to 14 buildbox occurrences, opened exact message #1, prefilled its Bash output, and found the raw text at 1 of 1. Thirty frontend checks, TypeScript, 45 workspace Rust checks, Clippy, site build and version consistency pass. Docs/README/Intelligence links, coherent synthetic events, dated changelog and synchronized 1.0.8 metadata are prepared. Native package/GUI checks, current-head CI, preceding release verification and publication remain gates.

- 2026-10-02: Project overview v1.0.7 is published from 24880957fc2eb1284a90f80da7d583bfd0a8a0c4. [Release run 37063527607](https://github.com/tryronda/ronda/actions/runs/37063527607) and [Pages run 37064670826](https://github.com/tryronda/ronda/actions/runs/37064670826) succeeded. Independent downloads verified the published source marker and all seven installer checksums. Production showed 305 active project sessions, two bookmarks, and one recurring error; buildbox narrowed all-time sessions to 82 and Intelligence to two sessions/two errors. Original message #1, Back, scoped full-session/bookmark browsing, scoped Intelligence, docs, installer links and the 1.0.7 changelog were verified. Native error-history packaging and GUI checks at 3ff24745 loaded all 27 fixture occurrences, opened the final-page original, preserved project/local scope and raw find, invalidated results on a source change, and returned 28 after explicit resubmission. Its current-head Intel installer and release remain open gates.

- 2026-10-02: Related sessions is prepared on ronda/related-sessions for patch 1.0.9. Direct host-aware parent/child lookup is shared with the CLI, including legacy references. A bounded indexed project/host query ranks five roots by shared signatures/files/recency, with lexical remote-safe path normalization and explicit explanation labels. The 5,000-root fixture measured 29.14 ms p95 after batching signals and adding a project/host/root index. Thirty-two frontend checks and TypeScript, 46 workspace Rust checks, Clippy, release consistency and site build pass. Browser checks opened an untitled child using its native ID, verified absent child Resume/Trash controls, used Parent and Back/Forward, opened shared-file originals, and confirmed that switching to an error transcript replaces connection evidence with shared-error suggestions. A duplicate React key found during that transition was removed and a regression check added. Docs, README, landing copy, synthetic examples and dated changelog are prepared. Native package/GUI, current-head installer CI, complete 1.0.8 publication, and 1.0.9 release/site verification remain gates.
- 2026-10-02: Error history is fully released as [v1.0.8](https://github.com/tryronda/ronda/releases/tag/v1.0.8) from `3ff24745b9bcf0c77e890b9a279d694af4d51fa0`. [Release CI](https://github.com/tryronda/ronda/actions/runs/37065484376) and [Pages](https://github.com/tryronda/ronda/actions/runs/37066602743) passed. Independent downloads verified the seven installer checksums; production verified 28-result paging, fourteen-result local/buildbox scopes, exact message #1 Bash evidence, raw transcript fallback, docs, changelog, and every installer link.
- 2026-10-02: Related sessions is fully released as [v1.0.9](https://github.com/tryronda/ronda/releases/tag/v1.0.9) from `75bb4f69c9e1c66b3def1d8881dcec2f3639b048`, merged through [PR #11](https://github.com/tryronda/ronda/pull/11). [Release CI](https://github.com/tryronda/ronda/actions/runs/37066866060) and [Pages](https://github.com/tryronda/ronda/actions/runs/37067679081) passed. Independent downloads verified all seven installer checksums. Exact-head native app/DMG checks covered indexed children, shared-file/error ranking, Parent/Back/Forward, child restrictions, and watcher refresh from two to three children. Production verified the same navigation/ranking, untitled-child fallback, docs, changelog, and download links.
- 2026-10-02: Resume readiness is implemented on `ronda/resume-readiness`: shared launch inspection/revalidation, structured reasons, exact local folder mappings and removal, consistent platform quoting, explicit sample-only readiness, docs/site/changelog, and 1.0.10 metadata. Local frontend and Rust regression checks pass; the packaging matrix now runs resume checks on each native OS. Browser evidence covers missing-folder recovery, Settings removal/restoration, and Desktop required behavior. Installed-app checks on macOS/Windows/Linux, current-head CI, native packaging, release publication, and production verification remain required gates. No 1.0.10 tag or release exists yet.

- 2026-10-02: Resume readiness is fully released as [v1.0.10](https://github.com/tryronda/ronda/releases/tag/v1.0.10) from `8df378f0ac5770d659dee3870b9c728fa6176169`, merged through [PR #12](https://github.com/tryronda/ronda/pull/12) with the bot author/committer and annotated tagger identity preserved. [Release CI](https://github.com/tryronda/ronda/actions/runs/37085618626) and [Pages](https://github.com/tryronda/ronda/actions/runs/37086654687) passed. The tag's installed Debian and NSIS checks proved native picker recovery, restart persistence, Resume/Restart/external launches into the exact Unicode folder with literal arguments, late launch refusal, Settings removal, child restrictions, no injected file, and unchanged source files. macOS native app/DMG checks proved the same runtime paths. Independent downloads verified all seven installer checksums and the release source marker. Production verified 1.0.10 highlights/changelog, docs and all download links, sample folder recovery, Desktop required, mapping removal restoring the original missing-folder state, and no console errors. A main-only Apple-silicon `hdiutil: Resource busy` error did not recur in the complete successful release build. All ten original feature/release/site cycles are complete.

- 2026-10-02: Follow-up 11 is implemented on `ronda/bookmark-note-drafts`: app-session drafts, shared write state, explicit discard, and successful-write reconciliation. The regression fails on 1.0.10 and passes with the change; 35 frontend tests, 47 Rust tests, TypeScript, Clippy, site generation, release checks, and local macOS app/DMG packaging pass. The installed Windows/Linux smoke now checks draft navigation, explicit save, and restart persistence. Final CI, packaged native UI evidence, publication, and production verification remain open gates.

- 2026-10-02: Follow-up 11 CI run 37088525035 passed source checks and Linux/macOS packaging, but cold Windows PowerShell hit the documented five-second readiness deadline in a resolution test. Command-resolution assertions now use a separate 30-second test budget; the product keeps its five-second limit, and the explicit timeout assertion and installed-app checks remain required. macOS UI verification is waiting for the Mac to be unlocked.

## Follow-up 12: open a session's project folder

**Release target:** 1.0.12 / `v1.0.12`, branch `ronda/open-project-folder`, title “Open a session's project folder”. Start from the 1.0.11 candidate while PR #13 is pending; rebase or merge its verified main commit before release preparation. The latest published release was verified from GitHub as v1.0.10 on 2026-10-03. Features 1.0.1–1.0.10 in the original roadmap are shipped; 1.0.11 is a separate open draft and is not yet published. The live product site is `https://tryronda.cloud`; its source derives release highlights and changelog entries from `CHANGELOG.md`.

**Problem and outcome:** A transcript records the project path, and Resume readiness can recover a moved project, but opening that working copy currently takes manual path copying and Finder/Explorer navigation. Add one action in the transcript header to open the effective local project folder in the platform's default file manager. Copy project path remains available beside the path.

**Behavior and boundaries:**

1. The action is available for local root sessions with a recorded project path. Use the exact local folder mapping from Resume readiness when one exists, so opening and resuming land in the same recovered copy. Open a directory directly; do not run a shell command or an agent.
2. Validate the session key, reject remote and child sessions, require an absolute path to an existing directory, canonicalize it, then pass the resulting path as a path value to Tauri's opener. Paths with spaces, quotes, dollar signs, and Unicode must remain literal. Return a readable error for missing, unavailable, or unknown folders.
3. Remote and child sessions disable Open project folder and retain Copy project path. Missing local paths report that the folder is unavailable; users can copy the recorded path and use **Choose project folder** under Resume readiness to set a recovered mapping. Browser preview uses synthetic paths and always reports Desktop required; it never opens a visitor's folder.
4. No schema change, agent adapter, new dependency, CLI/MCP command, network request, or telemetry is needed. The action changes no session metadata or agent files.

**Acceptance and site work:** Cover existing, mapped, missing, relative, file-as-folder, remote, child, unknown, and unusual Unicode/quoted paths. Verify the native macOS package against an isolated synthetic index; installed Linux and Windows smoke jobs remain CI evidence for the shared command and platform packaging. Do not claim a manual check on an OS that was not exercised. Update the Resume docs, README feature summary, preview instructions and synthetic command, plus an Added changelog entry. The preview response must name Desktop required and prove no real folder access.

**Release sequence:** Run frontend/Rust checks, site prerendering, sidecar/release checks, native macOS synthetic UI check, and the five-target packaging matrix. Merge the reviewed bot-authored commit after 1.0.11, synchronize package, Tauri, Cargo workspace and lockfile versions to 1.0.12, add a dated changelog section, and push annotated bot tag `v1.0.12`. Let the tag workflow publish the release. Verify the seven installers, checksum file and source SHA, then verify the Pages deployment shows the matching highlight, changelog, docs, preview behavior and release downloads. Record real PR, tag, release and successful workflow URLs here only after each exists.

## Ranked backlog after 1.0.12

These are research candidates, not scheduled releases. Allocate each next available patch only after the preceding release is published and a focused review confirms that the behavior still fills a gap.

### Copy one transcript message

**Why:** The multi-message context bundle can assemble excerpts from several sessions, but copying a single visible response still requires selecting rendered text. **Scope:** Add a per-message Copy action for visible user/assistant text; preserve plain text, Markdown, code fences, and line breaks. Do not include hidden thinking, tool input/output, system messages, or image payloads. **Acceptance:** Verify Unicode and code formatting, clipboard success/failure feedback, keyboard/screen-reader labeling, and the browser preview's sample-only response. **Release records:** Update transcript/context docs, preview instructions and sample handler, README if space permits, and an Added changelog entry; use a `ronda/copy-transcript-message` branch and the next available patch tag. **Size:** XS/S, low risk; distinct from cross-session context bundling.

### Export a privacy-safe diagnostics report

**Why:** Support reports need basic installation and index facts, while the privacy promise rules out transcript content. **Scope:** A user-initiated preview followed by a local JSON export containing app/schema versions, enabled source paths, index size, and counts; omit titles, message text, tokens, remote credentials, and environment variables. **Acceptance:** Inspect the preview and saved file, exercise cancel and write failures, and assert that seeded synthetic transcript strings and secrets never appear. Update Settings → Data docs and a synthetic site example. **Release records:** Add a Changed or Added changelog entry, documentation and site-preview guidance, then ship on the next patch `ronda/diagnostics-export`; do not send the report anywhere. **Size:** S, modest privacy review.

### Remember the last-read message

**Why:** Transcript refresh preserves a current reading position, but deliberately reopening a session starts at its default location. **Scope:** Persist one last-read sequence per local session and offer a clear Continue action when opening it again. Save only deliberate navigation, never terminal state or a background refresh; keep the normal open-at-latest behavior available. **Acceptance:** Verify restart persistence in a synthetic library, backward/forward navigation, new messages, deleted message fallback, and cleanup when the session is removed. Update Resume docs, preview and Added changelog. **Release records:** Assign a later patch and `ronda/reading-position` branch after a short UX review; do not silently jump users away from the latest message. **Size:** S/M, depends on a clear reopen interaction.

### Show source refresh health

**Why:** Users can see whether locations are enabled, but a stale or failing source can still make a session appear absent. **Scope:** Surface the last successful local scan and existing per-location error summaries in Settings → Locations, with Refresh as the explicit retry. Avoid new periodic network activity and avoid persisting transcript content. **Acceptance:** Use synthetic enabled/disabled locations, success/error scan results, and recovery after Refresh; redact usernames from example screenshots. Update Locations docs and preview. **Release records:** Use a subsequent patch branch `ronda/source-refresh-health`, document the exact summary fields, and add a Changed changelog entry. **Size:** S/M; depends on confirming which scan state is already retained.
