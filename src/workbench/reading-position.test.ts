import { expect, test } from "vitest";
import type { TranscriptMessage, TranscriptSnapshot } from "./api";
import { captureReadingPosition, mergeReadingPosition, readReadingPositions, resolveReadingPosition } from "./reading-position";

const hash = (value: string) => Array.from({ length: 32 }, (_, index) =>
  (value.charCodeAt(index % value.length) || 0).toString(16).padStart(2, "0")).join("");
const message = (seq: number): TranscriptMessage => ({ seq, role: "assistant", kind: "text", text: `m${seq}`,
  timestamp: null, model: null, thinking: null, tool_calls: [], images: [] });
const snapshot = (names: string[], seqs = names.map((_, index) => index)): TranscriptSnapshot => ({
  session_key_hash: hash("session"), messages: seqs.map(message), fingerprints: names.map(hash),
});

test("resolves an exact anchor through append, insertion, and sequence renumbering, but not changed content", () => {
  const saved = captureReadingPosition(snapshot(["a", "b", "c", "d"]), 2, 100, 1)!;
  expect(resolveReadingPosition(snapshot(["a", "b", "c", "d", "e"], [0, 1, 2, 3, 4]), saved)).toEqual({ status: "resolved", seq: 2 });
  expect(resolveReadingPosition(snapshot(["x", "a", "b", "c", "d"], [0, 1, 2, 3, 4]), saved)).toEqual({ status: "resolved", seq: 3 });
  expect(resolveReadingPosition(snapshot(["x", "c", "a", "d", "b"]), saved)).toEqual({ status: "resolved", seq: 1 });
  expect(resolveReadingPosition(snapshot(["a", "c", "d"]), saved)).toEqual({ status: "resolved", seq: 1 });
  expect(resolveReadingPosition(snapshot(["a", "b", "edited", "d"]), saved)).toEqual({ status: "stale" });
  expect(resolveReadingPosition(snapshot(["a", "b", "d"]), saved)).toEqual({ status: "stale" });
});

test("uses exact neighboring context to resolve duplicates and fails closed at boundaries", () => {
  const saved = captureReadingPosition(snapshot(["a", "dup", "c", "x", "dup", "y"]), 1, 100, 1)!;
  expect(resolveReadingPosition(snapshot(["a", "dup", "c", "x", "dup", "y"]), saved)).toEqual({ status: "resolved", seq: 1 });
  const repeated = snapshot(["x", "a", "b", "dup", "c", "a", "b", "dup", "c"]);
  const duplicateContext = captureReadingPosition(repeated, 3, 100, 1)!;
  expect(resolveReadingPosition(repeated, duplicateContext)).toEqual({ status: "ambiguous" });
  // If insertion means the duplicate at index 2 is no longer at the recorded start boundary,
  // it cannot borrow the start marker as a wildcard for arbitrary preceding content.
  const startRecord = captureReadingPosition(snapshot(["p", "q", "dup", "r", "dup", "s"]), 2, 100, 1)!;
  expect(startRecord.at_start).toBe(true);
  expect(resolveReadingPosition(snapshot(["x", "p", "q", "dup", "r", "dup", "s"]), startRecord)).toEqual({ status: "ambiguous" });
});

test("captures third-message start context, validates preferences strictly, and keeps the newest 100", () => {
  const saved = captureReadingPosition(snapshot(["a", "b", "c", "d"]), 2, 100, 1)!;
  const decoded = readReadingPositions(JSON.stringify({ version: 1, records: [saved] }));
  expect(resolveReadingPosition(snapshot(["a", "b", "c", "d"]), decoded[0])).toEqual({ status: "resolved", seq: 2 });
  expect(readReadingPositions(JSON.stringify({ version: 1, records: [{ ...saved, source_path: "/secret" }] }))).toEqual([]);
  expect(readReadingPositions(JSON.stringify({ version: 1, records: [{ ...saved, before: [], at_start: false }] }))).toEqual([]);
  const values = Array.from({ length: 105 }, (_, index) => ({ ...saved,
    session_key_hash: hash(`session-${index}`), saved_at: index + 1, generation: 1 }));
  const capped = mergeReadingPosition(values, { ...saved, session_key_hash: hash("new"), saved_at: 200, generation: 1 });
  expect(capped).toHaveLength(100);
  expect(capped[0].session_key_hash).toBe(hash("new"));
  expect(capped.some(record => record.session_key_hash === hash("session-0"))).toBe(false);
  expect(readReadingPositions(" ".repeat(65_537))).toEqual([]);
});

test("preference data contains only opaque identifiers and bounded fingerprints", () => {
  const saved = captureReadingPosition(snapshot(["private transcript canary"]), 0, 100, 1)!;
  const encoded = JSON.stringify({ version: 1, records: [saved] });
  expect(encoded).not.toContain("private transcript canary");
  expect(encoded).not.toContain("codex:");
  expect(readReadingPositions(encoded)).toEqual([saved]);
});
