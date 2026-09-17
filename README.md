<p align="center">
  <a href="https://tryronda.cloud"><img src="site/public/og.png" alt="Ronda: all your agent sessions in one place." width="720"></a>
</p>

<p align="center">
  <strong>A desktop library for your coding-agent sessions.</strong><br>
  Search sessions from 18 coding agents and resume them in a built-in terminal. Everything is indexed on your machine and nothing is uploaded.
</p>

<p align="center">
  <a href="https://tryronda.cloud"><b>tryronda.cloud</b></a> ·
  <a href="https://tryronda.cloud/docs/#install">Download</a> ·
  <a href="https://tryronda.cloud/docs/">Docs</a> ·
  <a href="https://tryronda.cloud/changelog/">Changelog</a>
</p>

<p align="center">
  <a href="https://github.com/tryronda/ronda/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/tryronda/ronda?label=release&color=171719"></a>
  <a href="https://github.com/tryronda/ronda/actions/workflows/build.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/tryronda/ronda/build.yml?branch=main&label=build"></a>
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-171719"></a>
  <img alt="macOS, Windows, Linux" src="https://img.shields.io/badge/platforms-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-171719">
</p>

---

## Your best work is buried in agent transcripts

A good session with a coding agent holds the fix for a strange bug, a design decision, a command that finally worked. It then disappears into a hidden folder. If you use more than one agent, those folders are spread across Claude Code, Codex, Cursor, Gemini CLI, and the rest, each in its own format, and none of them can be searched together.

Ronda brings them into one fast, private library. You can find the conversation you half remember, open it at the exact message, and pick up where you left off.

<p align="center">
  <video src="https://github.com/tryronda/ronda/raw/main/site/public/ronda-launch.mp4" controls muted playsinline width="720"></video>
</p>

<p align="center">
  <sub>Video not playing? <a href="https://github.com/tryronda/ronda/raw/main/site/public/ronda-launch.mp4">Watch it here</a>.</sub>
</p>

**[Try the live preview →](https://tryronda.cloud/#preview)**: the real interface runs in your browser on sample data.

## What Ronda does for you

- **One library for every agent.** Claude Code, Codex, Cursor, Gemini CLI, Copilot CLI, OpenCode, and 12 more. Ronda reads the session files these agents already write, so there is nothing to export and no plugin to install.
- **Find anything in milliseconds.** Full-text search covers every transcript, including code fragments like `useEffect(` and prose in any language, and each result opens at the matching message. On an 800 MiB library, p95 search time is about 26 ms.
- **Resume right where you left off.** **Resume** starts the agent's own resume command in a terminal built into Ronda, in the project folder or over SSH for remote sessions. Switch between the transcript and the live terminal, keep several agents running while you browse, or hand the session off to your system terminal. You can also export any session to Markdown.
- **See how you work.** Insights show a year of activity and which agents, projects, and models your sessions and tokens go to. **[Intelligence](https://tryronda.cloud/intelligence/)** works out where your time goes, where agents get stuck, which errors keep coming back, your real stack, and how sessions end, all on your machine.
- **Let your agents learn from past sessions.** The bundled CLI and a read-only MCP server let Claude Code, Codex, and other MCP clients search your history. An agent can ask whether an error has been seen before and how that session ended.
- **Follow your remote machines.** Ronda can mirror sessions from SSH hosts, index them locally next to the rest, and resume them on the host over SSH.
- **Private by design.** The index is a rebuildable SQLite database on your machine. Sessions are never sent to a server. Agent files are only read. The one exception is the explicit **Move to Trash** action.

## Download

| Platform | Download |
| --- | --- |
| **macOS**, Apple silicon | [Ronda-macos-arm64.dmg](https://github.com/tryronda/ronda/releases/latest/download/Ronda-macos-arm64.dmg) |
| **macOS**, Intel | [Ronda-macos-x64.dmg](https://github.com/tryronda/ronda/releases/latest/download/Ronda-macos-x64.dmg) |
| **Windows** x64 | [Ronda-windows-x64-setup.exe](https://github.com/tryronda/ronda/releases/latest/download/Ronda-windows-x64-setup.exe) |
| **Debian / Ubuntu** | [amd64 .deb](https://github.com/tryronda/ronda/releases/latest/download/Ronda-linux-amd64.deb) · [arm64 .deb](https://github.com/tryronda/ronda/releases/latest/download/Ronda-linux-arm64.deb) |
| **Linux AppImage** | [x86_64](https://github.com/tryronda/ronda/releases/latest/download/Ronda-linux-x86_64.AppImage) · [aarch64](https://github.com/tryronda/ronda/releases/latest/download/Ronda-linux-aarch64.AppImage) |

Builds are not notarized or code-signed yet, so the first launch needs one extra step:

- **macOS:** open Ronda once, then click **Open Anyway** in **System Settings → Privacy & Security**. If macOS says the app is damaged, run `xattr -dr com.apple.quarantine /Applications/Ronda.app`.
- **Windows:** if SmartScreen appears, click **More info → Run anyway**.
- **Linux:** install the `.deb` with `sudo apt install ./Ronda-linux-amd64.deb`, or `chmod +x` the AppImage and run it.

Each release includes `SHA256SUMS.txt` for checking your download. The full install guide is at **[tryronda.cloud/docs](https://tryronda.cloud/docs/#install)**.

## Supported agents

Claude Code · Codex · Cursor · Gemini CLI · Copilot CLI · OpenCode · Grok Build · DeepSeek Harness · Pi · Oh My Pi · Kiro · Kimi Code · Antigravity CLI · Qoder · Hermes Agent · OpenClaw · CodeBuddy · WorkBuddy

Is your agent missing? [Open an issue](https://github.com/tryronda/ronda/issues/new?template=agent_request.yml) and tell us where it stores sessions.

## Learn more

The **[documentation](https://tryronda.cloud/docs/)** covers search, [Intelligence](https://tryronda.cloud/docs/#intelligence), [resuming sessions](https://tryronda.cloud/docs/#resume), keyboard shortcuts, custom locations, the [command line](https://tryronda.cloud/docs/#cli), the [MCP server](https://tryronda.cloud/docs/#mcp), [remote hosts](https://tryronda.cloud/docs/#remote), and [how your data is handled](https://tryronda.cloud/docs/#privacy).

## Contributing

Ronda is built with Tauri 2, Rust, React, and SQLite FTS5. Bug reports, agent adapters, and fixes are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to build from source, run the checks, and cut a release. To report a security problem, see [SECURITY.md](SECURITY.md).

## License

Copyright © 2026 Ronda contributors.

Ronda is free software under the [GNU Affero General Public License v3.0](LICENSE). Third-party code is credited in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
