# Contributing to Ronda

Thanks for helping. You can contribute by reporting a bug, asking for an agent, fixing an issue, or improving the docs.

- **Bugs and agent requests:** use the [issue templates](https://github.com/tryronda/ronda/issues/new/choose).
- **Larger changes:** open an issue first so we can agree on the approach before you write the code.
- **Security problems:** do not open a public issue. Follow [SECURITY.md](SECURITY.md) instead.

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

By contributing, you agree that your contributions are licensed under the [AGPL-3.0](LICENSE).

## Project layout

| Path | What lives there |
| --- | --- |
| `crates/ronda-core` | Agent adapters, scanner, SQLite FTS5 index, session intelligence, and the `ronda-cli` and `ronda-mcp` binaries |
| `src-tauri` | The Tauri 2 desktop shell: commands, file watching, embedded resume terminals, remote hosts, and update checks |
| `src` | The React interface |
| `site` | The product site at [tryronda.cloud](https://tryronda.cloud), with its landing page, docs, changelog, and brand pages |
| `scripts` | Sidecar packaging, site prerendering, brand asset rendering, and the benchmark |

## Build and run

Install [Bun](https://bun.sh) 1.4.2 and a current stable Rust toolchain. Linux also needs the [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
bun install --frozen-lockfile
bun run tauri:dev
```

`bun run tauri:build` creates an installer for the current platform. The packaging script builds `ronda-cli` and `ronda-mcp` for the current Rust target and bundles them next to the app executable. To build for another target, set `CARGO_BUILD_TARGET` to its Rust target triple first.

To keep your own sessions out of development, set `RONDA_HOME` to scan a synthetic home directory and `RONDA_DB` to put the index somewhere else. Ronda never reads agent credential files.

## Checks

CI runs these on every pull request, so run them before you push:

```sh
bun run check
bun run prepare:sidecars
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

`docs/benchmark.md` describes the search and indexing benchmark (`scripts/benchmark.py`). Run it when a change touches the scanner or the index.

## Adding an agent

Adapters live in `crates/ronda-core/src/adapters/`. A new adapter should:

- read the agent's files without changing them, and open live SQLite databases read-only;
- leave token usage unknown when the agent doesn't record it, instead of estimating it;
- come with tests that use synthetic fixtures, never real transcripts.

Also add the agent to the lists in `README.md` and `site/docs/sections.tsx`.

## Product site

```sh
bun run site:dev      # http://127.0.0.1:1430
bun run site:build    # prerendered output in dist-site/
```

The **Deploy site** workflow publishes `site/` to GitHub Pages on every push to `main` that touches it. The site is served from `tryronda.cloud`; `site/public/CNAME` holds the domain.

## Pull requests

- Keep each pull request focused, and describe what changed and why.
- Add an entry under `## [Unreleased]` in `CHANGELOG.md` for anything users will notice.
- Include a screenshot for interface changes.

## Releasing

1. Set the new version in `package.json`, `Cargo.toml` (`workspace.package.version`), and `src-tauri/tauri.conf.json`.
2. Rename `## [Unreleased]` in `CHANGELOG.md` to `## [x.y.z] - YYYY-MM-DD`.
3. Commit, then tag and push:

   ```sh
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

The **Build Ronda** workflow builds every platform, checks that each package contains the CLI and MCP sidecars, and publishes a GitHub release. Its notes come from the changelog section. Release assets have version-free names, such as `Ronda-macos-arm64.dmg`, so `releases/latest/download/<name>` links in the README and on the site always get the newest build. The workflow refuses to publish when the tag doesn't match the app version or the changelog has no section for it.

### Code signing (optional)

macOS builds are ad-hoc signed unless these repository secrets are set. With them, Tauri signs the app with a Developer ID and notarizes it:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` Developer ID Application certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for that `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Apple ID, app-specific password, and team ID for notarization |

Windows builds are not signed yet.
