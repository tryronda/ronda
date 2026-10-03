import type { TranscriptSnapshot } from "./api";

export const READING_POSITION_PREF = "reading_positions_v1";
export const MAX_READING_POSITIONS = 100;
const MAX_PREF_CHARS = 65_536;
const HASH = /^[0-9a-f]{64}$/;

export interface ReadingPositionRecord {
  session_key_hash: string;
  seq: number;
  anchor: string;
  before: string[];
  after: string[];
  at_start: boolean;
  at_end: boolean;
  saved_at: number;
  generation: number;
}

export interface ReadingPositionPreference {
  version: 1;
  records: ReadingPositionRecord[];
}

export type ReadingPositionResolution =
  | { status: "resolved"; seq: number }
  | { status: "stale" }
  | { status: "ambiguous" };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validRecord(value: unknown): value is ReadingPositionRecord {
  if (!isObject(value)) return false;
  const allowed = ["after", "anchor", "at_end", "at_start", "before", "generation", "saved_at", "seq", "session_key_hash"];
  if (Object.keys(value).sort().join("\0") !== allowed.join("\0")) return false;
  return HASH.test(String(value.session_key_hash ?? ""))
    && Number.isSafeInteger(value.seq) && (value.seq as number) >= 0
    && HASH.test(String(value.anchor ?? ""))
    && Array.isArray(value.before) && value.before.length <= 2 && value.before.every(item => typeof item === "string" && HASH.test(item))
    && Array.isArray(value.after) && value.after.length <= 1 && value.after.every(item => typeof item === "string" && HASH.test(item))
    && typeof value.at_start === "boolean" && typeof value.at_end === "boolean"
    && (value.before.length === 2 || value.at_start)
    && value.at_end === (value.after.length === 0)
    && Number.isSafeInteger(value.saved_at) && (value.saved_at as number) > 0
    && Number.isSafeInteger(value.generation) && (value.generation as number) > 0;
}

export function readReadingPositions(raw: string | null): ReadingPositionRecord[] {
  if (!raw || raw.length > MAX_PREF_CHARS) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || Object.keys(parsed).sort().join("\0") !== "records\0version"
      || parsed.version !== 1 || !Array.isArray(parsed.records)
      || parsed.records.length > MAX_READING_POSITIONS || !parsed.records.every(validRecord)) return [];
    const unique = new Map<string, ReadingPositionRecord>();
    for (const record of parsed.records) {
      const current = unique.get(record.session_key_hash);
      if (!current || compareOrder(record, current) > 0) unique.set(record.session_key_hash, record);
    }
    return Array.from(unique.values()).sort((a, b) => compareOrder(b, a));
  } catch {
    return [];
  }
}

function compareOrder(a: ReadingPositionRecord, b: ReadingPositionRecord): number {
  return a.saved_at - b.saved_at || a.generation - b.generation;
}

export function captureReadingPosition(
  snapshot: TranscriptSnapshot,
  index: number,
  savedAt: number,
  generation: number,
): ReadingPositionRecord | null {
  if (!Number.isInteger(index) || index < 0 || index >= snapshot.messages.length
    || snapshot.fingerprints.length !== snapshot.messages.length
    || !HASH.test(snapshot.session_key_hash)
    || !snapshot.fingerprints.every(hash => HASH.test(hash))
    || !Number.isSafeInteger(snapshot.messages[index]?.seq) || snapshot.messages[index].seq < 0
    || !Number.isSafeInteger(savedAt) || savedAt <= 0
    || !Number.isSafeInteger(generation) || generation <= 0) return null;
  const fingerprints = snapshot.fingerprints;
  const beforeStart = Math.max(0, index - 2);
  return {
    session_key_hash: snapshot.session_key_hash,
    seq: snapshot.messages[index].seq,
    anchor: fingerprints[index],
    before: fingerprints.slice(beforeStart, index),
    after: fingerprints.slice(index + 1, Math.min(index + 2, fingerprints.length)),
    at_start: index <= 2,
    at_end: index === fingerprints.length - 1,
    saved_at: savedAt,
    generation,
  };
}

function matchesContext(fingerprints: string[], index: number, record: ReadingPositionRecord): boolean {
  if (record.at_start && index !== record.before.length) return false;
  if (!record.at_start && index <= record.before.length) return false;
  if (index < record.before.length) return false;
  const before = fingerprints.slice(index - record.before.length, index);
  if (before.length !== record.before.length || before.some((hash, offset) => hash !== record.before[offset])) return false;
  if (record.at_end && index + record.after.length !== fingerprints.length - 1) return false;
  const after = fingerprints.slice(index + 1, index + 1 + record.after.length);
  return after.length === record.after.length && after.every((hash, offset) => hash === record.after[offset]);
}

export function resolveReadingPosition(
  snapshot: TranscriptSnapshot,
  record: ReadingPositionRecord | undefined,
): ReadingPositionResolution {
  if (!record || record.session_key_hash !== snapshot.session_key_hash
    || snapshot.fingerprints.length !== snapshot.messages.length) return { status: "stale" };
  const matches: number[] = [];
  snapshot.fingerprints.forEach((hash, index) => { if (hash === record.anchor) matches.push(index); });
  if (matches.length === 0) return { status: "stale" };
  if (matches.length === 1) return { status: "resolved", seq: snapshot.messages[matches[0]].seq };
  const contextual = matches.filter(index => matchesContext(snapshot.fingerprints, index, record));
  return contextual.length === 1
    ? { status: "resolved", seq: snapshot.messages[contextual[0]].seq }
    : { status: "ambiguous" };
}

export function mergeReadingPosition(
  records: ReadingPositionRecord[],
  next: ReadingPositionRecord,
): ReadingPositionRecord[] {
  const current = records.find(record => record.session_key_hash === next.session_key_hash);
  if (current && compareOrder(next, current) <= 0) return records.slice(0, MAX_READING_POSITIONS);
  return [next, ...records.filter(record => record.session_key_hash !== next.session_key_hash)]
    .sort((a, b) => compareOrder(b, a))
    .slice(0, MAX_READING_POSITIONS);
}
