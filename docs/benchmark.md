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


## 2026-10-02 grouped-search result

The same synthetic Pi profile (300 sessions, 800 MiB source, 75.1 MiB searchable text) on the Apple M3 Pro / 18 GB machine measured:

| Query surface, 40 samples | p50 | p95 |
| --- | ---: | ---: |
| Raw CLI search, including process startup | 25.58 ms | 32.16 ms |
| Grouped desktop query, warm read-only connection | 11.80 ms | 14.70 ms |

Grouped search counted all 300 sessions and 1,800 matching messages, returning the first 50 session groups. Cold indexing took 12.74 seconds and the index was 275,841,024 bytes. Both query measurements meet the 100 ms target; the grouped measurement excludes process startup, debounce, and UI paint. These synthetic results do not predict every real query or format mix.

Reproduce with `cargo build -p ronda-core --release --bin ronda-cli --example grouped-search-benchmark`, then `python3 scripts/benchmark.py --cli target/release/ronda-cli --grouped target/release/examples/grouped-search-benchmark`. The benchmark opens only the disposable fixture index.


## 2026-10-02 library-filter scaling check

The filter release was measured on the retained 300-session/800 MiB fixture and a new 6,000-session/400 MiB fixture on the same Apple M3 Pro. Both use synthetic Pi logs. Each filtered query combines model `benchmark-model`, local-only sessions, and an inclusive start/exclusive end covering all fixture dates. Each measurement takes 40 samples on one warm read-only connection, excluding startup, debounce, and UI paint.

| Fixture and query | p50 | p95 | Returned / total |
| --- | ---: | ---: | --- |
| 300 sessions, filtered library page | 1.02 ms | 1.62 ms | 100 / 300 sessions |
| 300 sessions, full filter choices | 0.99 ms | 1.79 ms | 1 project / 1 model |
| 300 sessions, filtered grouped search | 13.41 ms | 21.66 ms | 50 / 300 sessions; 1,800 messages |
| 6,000 sessions, unfiltered library page | 27.55 ms | 70.32 ms | 100 / 6,000 sessions |
| 6,000 sessions, full filter choices | 26.82 ms | 31.74 ms | 1 project / 1 model |
| 6,000 sessions, unfiltered grouped search | 333.82 ms | 439.95 ms | 50 / 6,000 sessions; 36,000 messages |
| 6,000 sessions, filtered library page | 31.41 ms | 102.11 ms | 100 / 6,000 sessions |
| 6,000 sessions, full choices during filtered run | 31.60 ms | 117.51 ms | 1 project / 1 model |
| 6,000 sessions, filtered grouped search | 451.04 ms | 843.15 ms | 50 / 6,000 sessions; 36,000 messages |

The larger fixture contains 419,436,000 source bytes, 395,686,680 searchable text bytes, and a 1,383,886,848-byte index. Cold indexing took 750.68 seconds; this profile forces at least one 64 KiB indexed excerpt per session and is substantially denser than the baseline. Raw CLI search measured 160.37 / 271.60 ms p50/p95 including startup. These observations do not establish a general sub-100 ms guarantee: the baseline passes, while large grouped counts exceed it, and filtered page/facet tails also cross it. Concurrent local builds and tests add variability.

A streaming/snippet deferral experiment retained all counts but did not establish a reliable latency improvement, so it was removed. The remaining ceiling is the full matching-row scan, metadata/filter work, and ranking before pagination. SQL aggregation and indexed page/facet predicates are the next optimization if a sub-100 ms target must cover this larger profile; this measurement must remain visible when assessing release readiness.

Reproduce the larger profile with `python3 scripts/benchmark.py --cli target/release/ronda-cli --grouped target/release/examples/grouped-search-benchmark --sessions 6000 --mb 400 --searches 40 --keep`. Run the retained fixture's grouped example with `DB ronda_benchmark_needle 40 '{"model":"benchmark-model","local_only":true,"updated_from_ms":0,"updated_before_ms":9223372036854775807}'` for the combined-filter measurement.


## 2026-10-02 related-session lookup

On this Apple M3 Pro, the read-only relationship query returned parents, children, and five ranked suggestions from 5,000 synthetic root sessions in one project. Twenty warm debug-build samples measured **29.14 ms p95**, excluding index creation, IPC, and UI paint. The fixture includes shared errors, relative/absolute and Windows-separated file paths, two local children, and a remote parent with the same native identifier. Each query ranks at most 512 project/host candidates.

An initial version exceeded 100 ms under concurrent load. Batched candidate signals and an SQLite index on project/host/root metadata removed repeated per-candidate queries and JSON scope scans. The runnable fixture asserts ranking, host separation, removed sources, and a p95 below 100 ms. Reproduce with `cargo test -p ronda-core --lib related -- --nocapture`; timings vary with machine load and this is not a whole-library similarity or UI latency guarantee.
