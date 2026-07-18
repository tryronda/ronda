# Ronda benchmark

Run `cargo build -p ronda-core --release --bin ronda-cli`, then `python3 scripts/benchmark.py --cli target/release/ronda-cli`. The script creates a disposable `RONDA_HOME` and index, runs the real CLI, and removes both when done. `--keep` preserves the fixture for inspection; `--sessions`, `--mb`, and `--searches` change the profile.

## 2026-09-17 result

| Machine and profile | Result |
| --- | ---: |
| macOS 26.6.2 arm64, Apple M3 Pro, 18 GB RAM | Release CLI |
| Sessions | 300 |
| Source size | 800 MiB (838,860,900 bytes) |
| Searchable transcript text | 75.1 MiB (78,762,480 bytes) |
| SQLite index | 263 MiB (275,759,104 bytes) |
| Cold indexing | 12.73 s |
| Search p50 / p95, 40 CLI invocations | 29.77 / 41.19 ms |

The final CLI build was run against a new 300-session/800 MiB fixture on the same machine after the release build: indexing took 9.76 s and search p50/p95 was 23.47/26.05 ms over 40 invocations. The second run benefited from a warmer filesystem cache; both runs meet the search target.

The p95 search target of 100 ms passes. Each sample includes process startup and a read-only SQLite open. Cold indexing has no fixed target in the plan. The CLI's `index` command intentionally runs only when the database is absent.

On the retained 300-session/800 MiB fixture, a separate scanner process appended one Pi message and ran an incremental scan: one session was reindexed in 585.1 ms; a separate read-only SQLite connection found the new message after 591.9 ms, with a maximum concurrent query time of 4.4 ms. This measures index visibility and concurrent query responsiveness. The desktop file watcher adds a 250 ms debounce, so the complete desktop notification and UI paint path remains unmeasured before release.

The fixture uses 300 synthetic Pi JSONL sessions with six short prompt/answer turns each, about 75 MiB of searchable transcript excerpts, and valid non-content records to reach 800 MiB. This tests large-file parsing and a substantial FTS index without reading personal data. It does not model the format mix, image volume, or every token distribution in a real library.
