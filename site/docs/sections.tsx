import type { ReactNode } from "react";
import { Inline } from "../Inline";
import { ASSETS, REPO_URL, RELEASES_URL } from "../release";

export type DocSection = { id: string; title: string; body: ReactNode };

const P = ({ children }: { children: string }) => <p><Inline>{children}</Inline></p>;
const Code = ({ children }: { children: string }) => <pre className="docs-code"><code>{children}</code></pre>;
const List = ({ items }: { items: string[] }) => <ul>{items.map(item => <li key={item}><Inline>{item}</Inline></li>)}</ul>;

const agents = ["Claude Code", "Codex", "Grok Build", "DeepSeek Harness", "Cursor", "OpenCode", "Pi", "Oh My Pi", "Kiro",
  "Kimi Code", "Gemini CLI", "Copilot CLI", "Antigravity CLI", "Qoder", "Hermes Agent", "OpenClaw", "CodeBuddy", "WorkBuddy"];

const downloads: [string, string][] = [
  ["macOS", `[Apple silicon](${ASSETS.macArm}) · [Intel](${ASSETS.macIntel})`],
  ["Windows", `[x64 installer](${ASSETS.windows})`],
  ["Debian / Ubuntu", `[amd64 .deb](${ASSETS.debAmd64}) · [arm64 .deb](${ASSETS.debArm64})`],
  ["Linux AppImage", `[x86_64](${ASSETS.appImageX64}) · [aarch64](${ASSETS.appImageArm64})`],
];

const shortcuts: [string, string][] = [
  ["⌘1 / ⌘2 / ⌘3 / ⌘4", "Sessions, Insights, Intelligence, Settings"],
  ["⌘K", "Search the library"],
  ["⌘F", "Find in the active transcript"],
  ["Enter / Shift+Enter", "Next / previous match in transcript find"],
  ["⌘B", "Toggle the library sidebar"],
  ["Alt ← / Alt →", "Back and forward through views"],
  ["↑ / ↓", "Move through the session list"],
  ["Esc", "Close transcript find, or clear and leave library search"],
];

export const docs: DocSection[] = [
  {
    id: "install", title: "Install",
    body: <>
      <P>{`Every release ships installers for macOS, Windows, and Linux. The links below always point at the [latest release](${RELEASES_URL}).`}</P>
      <table className="docs-table"><tbody>
        {downloads.map(([platform, links]) => <tr key={platform}><td>{platform}</td><td><Inline>{links}</Inline></td></tr>)}
      </tbody></table>
      <h3>macOS</h3>
      <P>Open the DMG and drag Ronda into Applications. Pick **Apple silicon** for M-series Macs and **Intel** for older ones.</P>
      <P>Builds are not notarized by Apple yet, so macOS blocks the first launch. Open Ronda once, then go to **System Settings → Privacy & Security** and click **Open Anyway**. If macOS instead says the app "is damaged", remove the download quarantine flag and open it again:</P>
      <Code>{`xattr -dr com.apple.quarantine /Applications/Ronda.app`}</Code>
      <h3>Windows</h3>
      <P>Run the installer. The installer is not code-signed yet, so SmartScreen may show "Windows protected your PC": click **More info**, then **Run anyway**.</P>
      <h3>Linux</h3>
      <P>On Debian or Ubuntu, install the `.deb` with apt so it pulls in WebKitGTK. The AppImage runs on most other distributions and needs FUSE 2 (`libfuse2t64` on Ubuntu 24.04).</P>
      <Code>{`sudo apt install ./Ronda-linux-amd64.deb

chmod +x Ronda-linux-x86_64.AppImage
./Ronda-linux-x86_64.AppImage`}</Code>
      <h3>Verify a download</h3>
      <P>{`Each release includes [SHA256SUMS.txt](${ASSETS.checksums}). Put it next to your download and run:`}</P>
      <Code>{`shasum -a 256 --check --ignore-missing SHA256SUMS.txt`}</Code>
    </>,
  },
  {
    id: "agents", title: "Supported agents",
    body: <>
      <P>Ronda reads sessions from 18 coding agents, straight from the files each agent already writes:</P>
      <div className="docs-agents">{agents.map(agent => <span key={agent}>{agent}</span>)}</div>
      <List items={[
        "Both Cursor transcript and IDE stores are included.",
        "Both OpenCode database generations are included.",
        "Antigravity transcripts are encrypted, so Ronda shows their metadata only.",
        "Unknown token usage stays unknown rather than estimated.",
      ]} />
    </>,
  },
  {
    id: "shortcuts", title: "Keyboard shortcuts",
    body: <>
      <P>On Windows and Linux, use Ctrl in place of ⌘.</P>
      <table className="docs-table"><tbody>
        {shortcuts.map(([keys, action]) => <tr key={keys}><td><kbd>{keys}</kbd></td><td>{action}</td></tr>)}
      </tbody></table>
    </>,
  },
  {
    id: "search", title: "Search",
    body: <>
      <P>Press **⌘K** and type. Results are grouped by session, with a count of matching messages and up to three highlighted excerpts. Click an excerpt to open its exact message, or click the session title to open the conversation. **Show all matches** expands the session; **Load more matches** adds twenty excerpts at a time.</P>
      <P>**Relevance** puts title matches first, then ranks sessions by their best matching excerpt. **Recent** sorts by the last update. Browse loads one hundred sessions at a time and search loads fifty. **Showing X of Y sessions** reports the loaded count and exact matching total; **Load more sessions** or **Load more search results** appends the next page. Changing a query, filter, or sort, or refreshing the library, resets paging. The **Include archived** control controls archived results; leave it off to search active sessions only.</P>
      <P>Open **Filters** to combine session update dates, model, and host with project, agent, starred, and archive choices. Host distinguishes **All hosts**, **Local sessions**, and a named remote host. Model and host options come from the full library, including archived sessions. Missing model metadata stays included under **All models**.</P>
      <P>Dates use your local calendar: **Updated from** includes the start of that day; **Updated through** includes the entire end day, even when daylight saving time changes the day's length. Inverted ranges show an error. **Clear filters** resets the controls. An already-open conversation remains readable when filters hide it, with an **Outside current filters** label. The desktop remembers your last filter choices and search sort in its existing preferences; search text is not saved. The browser preview resets its synthetic data and preferences on reload.</P>
      <P>Search uses SQLite FTS5 with a trigram tokenizer, so it matches code fragments like `useEffect(` and prose in any language without a word segmenter. Queries shorter than three characters fall back to substring matching. Matching is case-insensitive and every whitespace-separated query term must occur in the same title or indexed message. Tool names and inputs are searchable; thinking and tool output are not part of the global index.</P>
      <P>On the September 17, 2026 synthetic 800 MiB / 300-session fixture, raw CLI search measured 23 ms p50 and 26 ms p95 on an Apple M3 Pro, including startup. The October 2 rerun measured 32.16 ms p95 for raw CLI search and 14.70 ms p95 for grouped queries on a warm read-only connection. The grouped query counted 300 sessions and 1,800 matching messages; neither result measures UI paint.</P>
    </>,
  },
  {
    id: "transcript-navigation", title: "Transcript navigation",
    body: <>
      <P>Open a session and choose **Find in transcript** or press **⌘F**. Find searches the literal phrase, ignoring case, in the visible message text and textual tool input/output. It preserves punctuation and spaces; it does not split the query into terms. **Include thinking** also searches recorded reasoning. Images are not searched.</P>
      <P>Use **Next match**, **Previous match**, Enter, or Shift+Enter to cycle through matches. Navigation opens the matching disclosure and highlights its text. Escape closes find. **First message** and **Last message** jump to the ends of the visible transcript.</P>
      <P>**Prompts only** shows user messages of kind text. Find counts reflect that view. Opening an excerpt from library search restores the full transcript and closes find before jumping to the requested message. Find survives refresh of the same session and resets when you open another one.</P>
      <P>Choose **Copy message** on a user or assistant text message to copy its original Markdown, including line breaks and code fences. The action excludes system messages, thinking, tool input/output, and image data. Clipboard errors appear in an error alert. The browser preview copies only the selected synthetic sample message; its sample content does not come from your computer.</P>
      <P>After you deliberately scroll a transcript with the wheel, touch, or keyboard, Ronda keeps the first visible message as a local reading marker. **Continue reading** appears when that exact message still exists and can be resolved safely. It never moves the transcript automatically. If the message changed or identical duplicates cannot be distinguished, Continue stays unavailable instead of guessing. Ronda retains markers for the 100 most recently saved sessions and evicts the oldest saved place when the limit is reached. A marker contains message fingerprints and an opaque session-key digest, not transcript text, images, paths, or host names; it lives in local preferences and is excluded from bookmark backups and diagnostics reports.</P>
      <P>**Session connections** in the transcript header shows an indexed **Parent** and a **Subagents / Related sessions** disclosure. Open a child directly even though the normal library only lists root sessions. Blank child titles use their native identifier. **Back** and **Forward** preserve the original conversation. Subagents cannot be resumed or moved to Trash independently.</P>
      <P>Related suggestions show up to five root sessions in the exact same project path and host, including archived indexed sessions. They rank shared normalized error signatures first, then shared read/edit file paths, then recency with deterministic ties. **Shared error**, **Shared files**, and **Same project** explain each suggestion; they do not establish that sessions worked on the same task. Paths are compared lexically, including Windows separators, without reading the local or remote filesystem. Absolute paths outside the known project and relative paths escaping it are skipped.</P>
      <P>Suggestions use at most 512 candidates, preferring indexed shared errors and directly comparable recorded file paths before recent sessions. More unusual path spellings can be compared only within that candidate set. This is a bounded suggestion list, not exhaustive history. Relationships refresh when the visible library changes. Missing parents and no indexed children mean ancestry was not recorded or is no longer available. The preview adds two synthetic children to the first search session and a file-sharing follow-up; its fixed sample tool strings illustrate the interface rather than duplicating production error derivation.</P>
      <P>Transcript shortcuts leave terminal and editable-field input alone. In the browser preview, focus must be inside the preview before ⌘F opens transcript find; the containing page retains its browser shortcuts elsewhere.</P>
    </>,
  },
  {
    id: "bookmarks", title: "Bookmarks and notes",
    body: <>
      <P>Choose **Bookmark message** on a transcript message to save its excerpt. Write a plain-text note of up to 4,000 characters and choose **Save note**. Unsaved note drafts stay available while you browse sessions, filter Bookmarks, or switch transcript views, including after a failed save. Closing the editor keeps its draft; **Cancel note** or Escape discards it. Drafts last only for the current app session and are lost when you close the app or reload the preview. Only **Save note** stores the note. Stars and pins still apply to whole sessions.</P>
      <P>Open **Bookmarks** in the library to search saved notes, excerpts, and session titles. Project and agent filters also apply. Most recently updated bookmarks appear first. Click an available excerpt to open its message in the full transcript.</P>
      <P>If the source changes, **Changed since bookmarking** keeps the original excerpt and note visible. **Update saved excerpt to this message** explicitly replaces the snapshot. If the message disappears, its saved excerpt and note remain available to read, edit, or remove.</P>
      <P>Bookmarks live in your index database and survive rescans and derived-fact rebuilds. They cannot be reconstructed from agent files. Before deleting or moving that database, choose **Settings → Data → Export bookmarks** to save a versioned JSON backup. **Import bookmarks** validates the entire file before applying it and keeps conflicting notes. Review both versions before choosing **Replace with imported bookmark**.</P>
      <P>The browser preview uses synthetic bookmarks. Export downloads sample JSON; Import opens a file picker. All changes reset when you reload the preview.</P>
    </>,
  },
  {
    id: "copy-context", title: "Copy context for another agent",
    body: <>
      <P>Choose **Select message for context** under user or assistant messages, or select available bookmarks from several sessions. Selections stay while you browse. Choose **Preview context** to load the original messages, group them by session, and order each conversation by message sequence.</P>
      <P>The editable Markdown draft includes the session title, agent, project, host, recorded timestamp, and message reference. Tool input/output and thinking start off; choose an option and regenerate to include them. Images and internal/system context are always excluded. Existing edits stay when you close the preview; regenerating an edited draft requires the explicit **Discard edits and regenerate** action.</P>
      <P>Inspect the draft for secrets and personal paths, edit it, then choose **Copy context** and paste it into your chosen agent yourself. **Export context Markdown** opens the desktop save dialog, or downloads a sample file in the browser preview. Nothing is sent to another agent or server, and no agent command runs. Clipboard or file failures keep the draft available for retry; cancelling the save dialog writes nothing.</P>
      <P>Drafts are capped at 100,000 Unicode characters, including source metadata. An oversized selection is rejected without truncation. Unavailable originals cannot be replaced by saved bookmark excerpts; remove unavailable messages from the selection. A changed bookmark resolves to its current original message, which you can inspect in the draft.</P>
      <P>For example, select a debugging exchange from Codex and a related decision bookmarked in Claude Code, review the combined draft, then paste it into a new agent conversation. A reference such as **ronda://session/codex:example#7** identifies local indexed content; these are not promised operating-system deep links. An MCP-connected agent can retrieve the original with **ronda_get_session** using the reference as its key. The CLI equivalent is shown below.</P>
      <Code>{`ronda-cli show 'ronda://session/codex:example#7' --messages 5`}</Code>
    </>,
  },
  {
    id:"projects",title:"Projects",
    body:<>
      <P>Select a project in the Sessions sidebar to open its overview and filter the library. Project identity is the complete folder path; matching basenames remain separate and show full paths in the sidebar. All hosts combines the same path across machines, while Local sessions or a remote host narrows every overview section.</P>
      <P>The overview shows ten recent root sessions, ten recently updated bookmarks, and five recurring errors with exact total counts. Sessions and bookmarks are all-time sections; archived sessions are excluded from the recent-session section. Intelligence totals and coverage use the last 30 days. Recurring errors may include earlier occurrences when the same error also appears in this range.</P>
      <P>Choose a session, bookmark, or error evidence to open its exact message. Back and Forward restore the project and host context. View all opens the corresponding project session or bookmark list; View all project Intelligence keeps the project and host filters in the existing Intelligence page.</P>
      <P>In the Bookmarks destination, project buttons keep filtering saved annotations. Unavailable bookmarks retain their note and excerpt but cannot open a missing original. Local or remote host filters need available session metadata. An unavailable analytics section does not hide usable sessions and annotations.</P>
      <P>Outcomes are inferred from recorded tool events. A commit command is not proof of a fix. Tool and timestamp coverage shows which sessions can contribute errors, outcomes, and active time. The overview refreshes while visible; source changes while another view is open are read when it returns.</P>
      <P>The sample preview derives project totals and evidence from its displayed synthetic transcripts. Select ronda and try All hosts or buildbox, then open a synthetic project error and return with Back.</P>
    </>,
  },
  {
    id: "resume", title: "Resume a session",
    body: <>
      <P>Open a session and check **Resume readiness**. Unsupported agents and children, unknown projects, missing folders or executables, and incomplete inspection have explicit explanations. **Check resume again** retries the read-only check; selecting a session does not start an agent or SSH connection.</P>
      <P>To return to a previous place in a long transcript, deliberately scroll with the wheel, touch, or keyboard. **Continue reading** appears when the exact saved message can still be identified. Opening a session never jumps automatically, and a changed or ambiguous message is not replaced by a nearby one. Up to 100 session positions are stored locally, separately from bookmarks, and excluded from bookmark backups and diagnostics reports. Continue works for indexed local, remote, and child sessions.</P>
      <P>Click **Resume** when available. Ronda opens a terminal inside the app and runs the agent's own resume command in the session's project folder, so you pick up the same conversation with the same agent.</P>
      <List items={[
        "The session header gets a **Transcript / Terminal** switch. The dot next to **Terminal** pulses while the terminal process is open; it does not verify agent startup.",
        "Terminals keep running while you open other sessions or switch to Insights or Settings. Each resumed session has its own terminal.",
        "When the agent exits, the terminal stays open in your login shell in the same folder. **Restart** runs the resume command again.",
        "**Open in system terminal** hands the session to Terminal on macOS, Windows Terminal or PowerShell on Windows, or `x-terminal-emulator` on Linux.",
        "**Stop and close terminal** ends the process and returns to the transcript.",
      ]} />
      <P>The terminal starts your login shell (`$SHELL -l`, or PowerShell on Windows), so the agent finds the same `PATH` it has in your usual terminal. Resume needs a known project folder and is not available for subagent transcripts.</P>
      <P>For a moved local project, **Choose project folder** opens the native folder picker. The exact original path maps to the selected existing folder for every local session from that project. **Effective folder** shows the mapping; session metadata and agent files stay untouched. Remove it under **Settings → Locations → Recovered project folders**. Remote sessions never use local mappings.</P>
      <P>Use **Open project folder** in a local session's header to open its existing effective folder in the system file manager. This respects recovered-folder mappings. Remote and subagent sessions cannot open a local folder. If the folder has moved or is unavailable, use **Copy project path** and choose a new folder with **Choose project folder** in Resume readiness.</P>
      <P>Embedded Resume, Restart, and Open in system terminal inspect again immediately before launch. Executable lookup uses the configured login shell on macOS/Linux with a two-second timeout, or PowerShell on Windows with a five-second timeout to allow for shell startup. An incomplete check is **Unknown**, rather than proof the executable is missing. Ronda does not install an agent; DeepSeek’s `npx` resume uses `--no-install` and reports a missing package in terminal output. A spawned terminal does not verify successful startup; terminal errors and output remain visible.</P>
      <P>The live preview labels readiness as sample data. **Choose sample folder** changes only a synthetic mapping; Resume and Open project folder report **Desktop required**. It never inspects the visitor’s filesystem, opens a folder, or starts an agent. You can scroll a sample transcript and try **Continue reading**; its preference is in memory and resets when the preview reloads.</P>
      <P>Open transcripts refresh as local agent files change. When you are reading earlier messages, **New messages** lets you jump to the latest content without losing your place. Remote transcripts refresh after a successful sync.</P>
      <P>Remote folders and agent availability are explicitly unchecked; only local SSH availability is inspected. Launch can report authentication, connection, or remote-environment errors. Remote sessions resume on their host: the terminal runs `ssh -t` to the host and starts the agent there. **Open in system terminal** copies that SSH command to the clipboard instead.</P>
    </>,
  },
  {
    id: "intelligence", title: "Intelligence",
    body: <>
      <P>**Intelligence** (⌘3) reports what your sessions add up to. Filter it to the last 7 days, 30 days, or all time, and to one project.</P>
      <List items={[
        "**Where your time goes:** active time split into building features, fixing bugs, refactoring, writing tests, setup and config, and exploring, plus time spent recovering from failing commands. Gaps longer than 15 minutes count as time away.",
        "**Agent failures:** edit loops (one file edited five or more times around errors), context that filled up and was compacted, sessions that ended with tests failing, denied tool calls, and calls to APIs that don't exist.",
        "**Errors that keep coming back:** error lines are normalized so paths, line numbers, and ids don't split one bug into many. Errors are flagged when they return after a session that recorded a commit command.",
        "**Your stack:** languages, frameworks, and tools detected from edited files and commands, as a share of sessions with tool calls. Tech first seen in the selected range is marked new.",
        "**How sessions end:** committed, edited but not committed, ended failing, or no file changes.",
        "**Worth knowing:** short notes, such as recovery time outgrowing tests and setup, or failing sessions running much longer than committed ones.",
      ]} />
      <P>Failure and error rows link to their sessions and open the transcript at the matching message. Everything is derived locally when a session is indexed, with fixed rules and no language model. Agents that don't record tool calls count toward time and sessions, and the view names them.</P>
      <P>**Find error history** sits below global search, in project overviews, and beside message/tool output. It pre-fills the recorded wording but runs only when you choose **Look up previous occurrences**. Paste a multiline error up to 20,000 Unicode characters, choose a full project path and All hosts, Local sessions or a named remote host. Scope applies before counting and twenty-session paging; repeated events in one session count once. Archived sources are included; removed sources are excluded.</P>
      <P>The canonical error and each original message link show agent, host, full project path and recorded outcome. **Commit command observed** does not mean a fix was verified. Tool-data coverage names the indexed sessions that can contribute evidence. A no-match result may reflect missing tool output or different wording. Use **Search wording in current transcript** to search literal prose and tool output instead; with no transcript open, open a session and use **Find in transcript**. Missing analytics shows an error without changing your pasted text; submit again to retry.</P>
      <P>The preview has 28 explicitly synthetic occurrences of `Error: SYNTHETIC_PROJECT_CHECK failed`. Paste that line to load twenty results and then the remaining eight; either Local sessions or buildbox narrows it to fourteen. Preview lookup accepts fixed recorded sample lines; the desktop, CLI and MCP share the existing Rust normalizer for paths, line numbers and volatile values.</P>
      <P>**Insights** (⌘2) covers the rest: a year of activity, and which agents, projects, and models your sessions, prompts, and tokens go to.</P>
    </>,
  },
  {
    id: "locations", title: "Locations",
    body: <>
      <P>**Settings → Locations** lists the default path detected for each agent. Turn a location off to stop indexing it, or add a folder for agents that store sessions somewhere custom.</P>
      <P>**Recovered project folders** lists exact local resume mappings separately from session source locations. Removing a mapping restores the recorded project path for the next inspection and launch. If resume reports **Missing folder**, choose an existing local folder. If it reports **Missing executable**, check the agent installation in your login shell. **Unknown** checks can be retried without starting the agent.</P>
      <P>File-backed sessions update as agents write them. **Settings → Data → Rebuild index** and **Refresh library** show the local scan result: session source records discovered, sessions indexed, sessions unchanged, and the aggregate number of scan errors. Discovered counts source records before sessions are grouped, so it is not a unique-session count and need not equal indexed plus unchanged. Partial results show only the error count; paths and parser details stay hidden. Remote sync reports are not included.</P>
      <P>**Settings → Locations** also shows the last completed local scan time and a status for each configured root. **Disabled** roots are not scanned; **Unavailable** roots could not be read; **Checked** means the adapter reported no errors; and **Partial** means it reported scan issues. Counts are source records found at that root before grouping, so duplicate sessions across roots can count more than once. Zero does not prove agent data is absent, and some adapters suppress filesystem traversal errors. A missing root with previously indexed local sessions keeps those sessions until the source returns or the location is removed or disabled. The saved summary contains only an opaque root identifier, status, counts and time—not paths, transcript text or parser errors. The summary keeps at most 512 configured roots; the screen calls out when additional roots are omitted. The browser preview shows fixed examples, never accesses the visitor's computer or hosts, and resets when reloaded. Databases with a live SQLite WAL are opened read-only.</P>
    </>,
  },
  {
    id: "cli", title: "Command line",
    body: <>
      <P>`ronda-cli` ships beside the desktop app and reads the same index.</P>
      <Code>{`ronda-cli index                    # create an index if none exists
ronda-cli sessions --project "$PWD"
ronda-cli search 'useEffect('
ronda-cli show 'codex:SESSION_ID'
ronda-cli show 'claude-code:SESSION_ID' --subagent '*'
ronda-cli projects
ronda-cli insights --since 7d      # time, failures, recurring errors, stack
ronda-cli errors 'database is locked'
ronda-cli setup                    # print paths and an AGENTS.md snippet`}</Code>
    </>,
  },
  {
    id: "mcp", title: "MCP server",
    body: <>
      <P>`ronda-mcp` is a read-only stdio server that lets an agent search your past sessions. It exposes `ronda_search`, `ronda_list_sessions`, `ronda_get_session`, `ronda_list_projects`, `ronda_insights`, and `ronda_find_error`, which checks whether an error has been seen before and how those sessions ended. Desktop **Find error history** uses the same lookup with optional project/host scope and paged original evidence. Recorded commit commands do not prove a fix.</P>
      <P>**Settings → Connect** shows the installed path and ready-to-copy setup for Claude Code, Codex, and other MCP clients. For Claude Code on macOS:</P>
      <Code>{`claude mcp add --scope user ronda -- '/Applications/Ronda.app/Contents/MacOS/ronda-mcp'`}</Code>
    </>,
  },
  {
    id: "remote", title: "Remote hosts",
    body: <>
      <P>Add an SSH alias or `user@host` under **Settings → Remote hosts**. SSH must connect without prompts, and `rsync` must be installed on both machines.</P>
      <P>Ronda mirrors an allowlist of session paths into its own data directory and indexes that mirror. Remote sessions can't be moved to Trash. **Resume** connects to the host over `ssh -t` in Ronda's terminal and starts the agent there. Removing a host removes its mirror.</P>
    </>,
  },
  {
    id: "privacy", title: "Privacy and data",
    body: <>
      <List items={[
        "Sessions are indexed into a separate SQLite database on your machine. The session index is rebuildable; your bookmarks and notes require a backup from **Settings → Data**. They are never sent to a Ronda server.",
        "In **Settings → Data**, preview and save an optional diagnostics JSON containing app/schema versions, index availability, an aggregate session count, and counts of configured, enabled, and existing local source directories. It contains no paths, source names, transcript content, credentials, preferences, or remote sync details; Ronda does not upload it.",
        "Ronda contacts GitHub only when you choose **Check for updates**, and an SSH host only when you configure and sync it.",
        "Agent files are read, not changed. **Move to Trash** is the only action that removes an agent's session file.",
        "Ronda starts an agent only when you click **Resume**, and that terminal runs on your machine or on your own SSH host.",
        "Ronda does not read agent credential files.",
        "Set `RONDA_HOME` to scan a different home directory and `RONDA_DB` to put the index elsewhere.",
      ]} />
    </>,
  },
  {
    id: "source", title: "Build from source",
    body: <>
      <P>Install Bun 1.4.2 and a current stable Rust toolchain. Linux also needs the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).</P>
      <Code>{`git clone ${REPO_URL}.git && cd ronda
bun install --frozen-lockfile
bun run tauri:dev      # run the desktop app
bun run tauri:build    # create an installer for this platform`}</Code>
    </>,
  },
];
