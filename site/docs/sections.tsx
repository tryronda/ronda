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
      <P>Transcript shortcuts leave terminal and editable-field input alone. In the browser preview, focus must be inside the preview before ⌘F opens transcript find; the containing page retains its browser shortcuts elsewhere.</P>
    </>,
  },
  {
    id: "bookmarks", title: "Bookmarks and notes",
    body: <>
      <P>Choose **Bookmark message** on a transcript message to save its excerpt. Write a plain-text note of up to 4,000 characters and choose **Save note**. Unsaved changes stay in the editor if saving fails. Stars and pins still apply to whole sessions.</P>
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
    id: "resume", title: "Resume a session",
    body: <>
      <P>Open a session and click **Resume**. Ronda opens a terminal inside the app and runs the agent's own resume command in the session's project folder, so you pick up the same conversation with the same agent.</P>
      <List items={[
        "The session header gets a **Transcript / Terminal** switch. The dot next to **Terminal** pulses while the agent is running.",
        "Terminals keep running while you open other sessions or switch to Insights or Settings. Each resumed session has its own terminal.",
        "When the agent exits, the terminal stays open in your login shell in the same folder. **Restart** runs the resume command again.",
        "**Open in system terminal** hands the session to Terminal on macOS, Windows Terminal or PowerShell on Windows, or `x-terminal-emulator` on Linux.",
        "**Stop and close terminal** ends the process and returns to the transcript.",
      ]} />
      <P>The terminal starts your login shell (`$SHELL -l`, or PowerShell on Windows), so the agent finds the same `PATH` it has in your usual terminal. Resume needs a known project folder and is not available for subagent transcripts.</P>
      <P>Open transcripts refresh as local agent files change. When you are reading earlier messages, **New messages** lets you jump to the latest content without losing your place. Remote transcripts refresh after a successful sync.</P>
      <P>Remote sessions resume on their host: the terminal runs `ssh -t` to the host and starts the agent there. **Open in system terminal** copies that SSH command to the clipboard instead.</P>
    </>,
  },
  {
    id: "intelligence", title: "Intelligence",
    body: <>
      <P>**Intelligence** (⌘3) reports what your sessions add up to. Filter it to the last 7 days, 30 days, or all time, and to one project.</P>
      <List items={[
        "**Where your time goes:** active time split into building features, fixing bugs, refactoring, writing tests, setup and config, and exploring, plus time spent recovering from failing commands. Gaps longer than 15 minutes count as time away.",
        "**Agent failures:** edit loops (one file edited five or more times around errors), context that filled up and was compacted, sessions that ended with tests failing, denied tool calls, and calls to APIs that don't exist.",
        "**Errors that keep coming back:** error lines are normalized so paths, line numbers, and ids don't split one bug into many. Errors are flagged when they return after a session that committed a fix.",
        "**Your stack:** languages, frameworks, and tools detected from edited files and commands, as a share of sessions with tool calls. Tech first seen in the selected range is marked new.",
        "**How sessions end:** committed, edited but not committed, ended failing, or no file changes.",
        "**Worth knowing:** short notes, such as recovery time outgrowing tests and setup, or failing sessions running much longer than committed ones.",
      ]} />
      <P>Failure and error rows link to their sessions and open the transcript at the matching message. Everything is derived locally when a session is indexed, with fixed rules and no language model. Agents that don't record tool calls count toward time and sessions, and the view names them.</P>
      <P>**Insights** (⌘2) covers the rest: a year of activity, and which agents, projects, and models your sessions, prompts, and tokens go to.</P>
    </>,
  },
  {
    id: "locations", title: "Locations",
    body: <>
      <P>**Settings → Locations** lists the default path detected for each agent. Turn a location off to stop indexing it, or add a folder for agents that store sessions somewhere custom.</P>
      <P>File-backed sessions update as agents write them. **Refresh** rescans every source. Databases with a live SQLite WAL are opened read-only.</P>
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
      <P>`ronda-mcp` is a read-only stdio server that lets an agent search your past sessions. It exposes `ronda_search`, `ronda_list_sessions`, `ronda_get_session`, `ronda_list_projects`, `ronda_insights`, and `ronda_find_error`, which checks whether an error has been seen before and how those sessions ended.</P>
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
