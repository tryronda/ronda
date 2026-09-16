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
  ["⌘B", "Toggle the library sidebar"],
  ["Alt ← / Alt →", "Back and forward through views"],
  ["↑ / ↓", "Move through the session list"],
  ["Esc", "Clear and leave search"],
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
      <P>Press **⌘K** and type. Every result points at the matching message, and opening it scrolls the transcript there.</P>
      <P>Search uses SQLite FTS5 with a trigram tokenizer, so it matches code fragments like `useEffect(` and Chinese text without a word segmenter. Queries shorter than three characters fall back to substring matching.</P>
      <P>On an 800 MiB library of 300 sessions, search measured 23 ms p50 and 26 ms p95 on an Apple M3 Pro, including CLI startup.</P>
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
        "Sessions are indexed into a separate, rebuildable SQLite database on your machine. They are never sent to a Ronda server.",
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
