#!/usr/bin/env python3
"""Benchmark the real Ronda CLI against a disposable synthetic Pi home."""

import argparse
import json
import math
import os
import platform
import shutil
import sqlite3
import statistics
import subprocess
import tempfile
import time
from pathlib import Path


def machine():
    details = {"platform": platform.platform(), "python": platform.python_version()}
    if platform.system() == "Darwin":
        for key, name in [("machdep.cpu.brand_string", "cpu"), ("hw.memsize", "memory_bytes")]:
            result = subprocess.run(["sysctl", "-n", key], capture_output=True, text=True, check=False)
            if result.returncode == 0:
                details[name] = result.stdout.strip()
    else:
        details["cpu"] = platform.processor()
        if Path("/proc/meminfo").exists():
            for line in Path("/proc/meminfo").read_text().splitlines():
                if line.startswith("MemTotal:"):
                    details["memory_bytes"] = int(line.split()[1]) * 1024
                    break
    return details


def write_fixture(home: Path, sessions: int, total_bytes: int):
    root = home / ".pi" / "agent" / "sessions" / "benchmark-project"
    root.mkdir(parents=True)
    pad = "x" * 65536
    padding_row = json.dumps({"type": "model_change", "padding": pad}) + "\n"
    empty_padding_size = len(json.dumps({"type": "model_change", "padding": ""}) + "\n")
    desired = math.ceil(total_bytes / sessions)
    indexed_text_bytes = 0
    for number in range(sessions):
        path = root / f"2026_benchmark-{number:04d}.jsonl"
        with path.open("w", encoding="utf-8") as output:
            output.write(json.dumps({"type": "session", "id": f"benchmark-{number:04d}",
                "timestamp": "2026-01-01T00:00:00Z", "cwd": "/tmp/ronda benchmark project"}) + "\n")
            for turn in range(6):
                prompt = f"Benchmark prompt {number} {turn} ronda_benchmark_needle"
                indexed_text_bytes += len(prompt)
                output.write(json.dumps({"type": "message", "message": {"role": "user",
                    "content": [{"type": "text", "text": prompt}]}}) + "\n")
                indexed_text_bytes += len(f"Benchmark answer {number} {turn}")
                output.write(json.dumps({"type": "message", "message": {"role": "assistant",
                    "model": "benchmark-model", "usage": {"totalTokens": 100},
                    "content": [{"type": "text", "text": f"Benchmark answer {number} {turn}"}]}}) + "\n")
            # Searchable excerpts exercise FTS; non-content records model larger runtime logs.
            excerpt = json.dumps({"type": "message", "message": {"role": "user",
                "content": [{"type": "text", "text": pad}]}}) + "\n"
            for _ in range(max(1, int(desired * .10 / len(excerpt)))):
                output.write(excerpt)
                indexed_text_bytes += len(pad)
            while output.tell() + len(padding_row) <= desired:
                output.write(padding_row)
            remaining = desired - output.tell()
            if remaining >= empty_padding_size:
                output.write(json.dumps({"type": "model_change", "padding": "x" * (remaining - empty_padding_size)}) + "\n")
    return sum(path.stat().st_size for path in root.glob("*.jsonl")), indexed_text_bytes


def run_cli(cli: Path, db: Path, home: Path, *args: str):
    env = os.environ.copy()
    env["RONDA_HOME"] = str(home)
    env["RONDA_DB"] = str(db)
    start = time.perf_counter()
    result = subprocess.run([str(cli), "--db", str(db), *args], env=env,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
    duration_ms = (time.perf_counter() - start) * 1000
    if result.returncode:
        raise RuntimeError(f"ronda-cli {' '.join(args)} failed ({result.returncode}): {result.stderr.strip()}")
    return duration_ms, result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sessions", type=int, default=300)
    parser.add_argument("--mb", type=int, default=800, help="total source size in MiB")
    parser.add_argument("--searches", type=int, default=40)
    parser.add_argument("--cli", type=Path, help="path to a built ronda-cli")
    parser.add_argument("--keep", action="store_true", help="keep synthetic files for inspection")
    args = parser.parse_args()
    if min(args.sessions, args.mb, args.searches) < 1:
        parser.error("--sessions, --mb, and --searches must be positive")
    cli = args.cli or next((path for path in [Path("target/release/ronda-cli"), Path("target/debug/ronda-cli")]
        if path.exists()), None)
    if cli is None or not cli.is_file():
        parser.error("build the CLI first: cargo build -p ronda-core --release --bin ronda-cli")
    cli = cli.resolve()
    need = args.mb * 1024 * 1024 * 3
    if shutil.disk_usage(tempfile.gettempdir()).free < need:
        parser.error(f"need roughly {need // (1024 * 1024)} MiB free in temporary storage")

    temporary = Path(tempfile.mkdtemp(prefix="ronda-benchmark-"))
    try:
        home = temporary / "home"
        db = temporary / "index" / "ronda.db"
        source_bytes, indexed_text_bytes = write_fixture(home, args.sessions, args.mb * 1024 * 1024)
        cold_ms, index_text = run_cli(cli, db, home, "index")
        if not db.is_file():
            raise RuntimeError(f"CLI reported success but did not create {db}: {index_text.strip()}")
        with sqlite3.connect(db) as connection:
            indexed = connection.execute("SELECT count(*) FROM sessions").fetchone()[0]
        if indexed != args.sessions:
            raise RuntimeError(f"expected {args.sessions} sessions; indexed {indexed}: {index_text.strip()}")
        warm_ms, first_search = run_cli(cli, db, home, "search", "ronda_benchmark_needle", "--limit", "10")
        if "benchmark-" not in first_search:
            raise RuntimeError("search did not return the synthetic sessions")
        samples = [run_cli(cli, db, home, "search", "ronda_benchmark_needle", "--limit", "10")[0]
            for _ in range(args.searches)]
        samples.sort()
        report = {
            "machine": machine(), "cli": str(cli), "profile": "Pi JSONL; 6 prompt/answer turns plus searchable excerpts per session; valid model-change padding",
            "sessions": indexed, "source_bytes": source_bytes, "indexed_text_bytes": indexed_text_bytes,
            "index_bytes": db.stat().st_size,
            "cold_index_ms": round(cold_ms, 1), "search_warmup_ms": round(warm_ms, 2),
            "search_p50_ms": round(statistics.median(samples), 2),
            "search_p95_ms": round(samples[math.ceil(len(samples) * .95) - 1], 2),
            "search_runs": len(samples), "incremental_refresh": "unmeasured: CLI index is intentionally one-time",
            "gates": {"search_p95_under_100_ms": samples[math.ceil(len(samples) * .95) - 1] < 100,
                "sessions_300": indexed >= 300, "source_800_mib": source_bytes >= 800 * 1024 * 1024},
        }
        if args.keep: report["fixture_dir"] = str(temporary)
        print(json.dumps(report, indent=2))
    finally:
        if not args.keep: shutil.rmtree(temporary)


if __name__ == "__main__":
    main()
