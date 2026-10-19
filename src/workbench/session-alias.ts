/**
 * Local session titles: a display-only alias per session key, kept in the `session_aliases_v1` preference.
 * Aliases never touch agent files, the index, exports, bookmark backups, or diagnostics.
 */
export const SESSION_ALIASES_KEY = "session_aliases_v1";
export const SESSION_ALIAS_LIMIT = 500;
export const SESSION_ALIAS_TITLE_LIMIT = 120;
export const SESSION_ALIAS_DOCUMENT_BYTES = 256 * 1024;

export type SessionAliases = Record<string, string>;
export type SessionAliasParse = { ok: true; aliases: SessionAliases } | { ok: false };

const encoder = new TextEncoder();
const utf8Bytes = (value: string) => encoder.encode(value).length;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

const validKey = (key: string) => key.length > 0 && utf8Bytes(key) <= 4096;
/** A stored title is already trimmed, 1–120 characters (code points), and free of control characters. */
const validStoredTitle = (title: unknown): title is string =>
  typeof title === "string" && title === title.trim() && title.length > 0 && !CONTROL.test(title)
  && Array.from(title).length <= SESSION_ALIAS_TITLE_LIMIT && utf8Bytes(title) <= SESSION_ALIAS_TITLE_LIMIT * 4;

/** Absent preference reads as no aliases; anything malformed fails closed so it is shown as nothing and never overwritten. */
export function parseSessionAliases(raw: string | null): SessionAliasParse {
  if (raw === null) return { ok: true, aliases: {} };
  if (utf8Bytes(raw) > SESSION_ALIAS_DOCUMENT_BYTES) return { ok: false };
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value) || Object.keys(value).length !== 2 || value.version !== 1 || !isObject(value.titles)) return { ok: false };
    const entries = Object.entries(value.titles);
    if (entries.length > SESSION_ALIAS_LIMIT) return { ok: false };
    if (!entries.every(([key, title]) => validKey(key) && validStoredTitle(title))) return { ok: false };
    const aliases: SessionAliases = Object.create(null);
    for (const [key, title] of entries) aliases[key] = title as string;
    return { ok: true, aliases: { ...aliases } };
  } catch { return { ok: false }; }
}

export function serializeSessionAliases(aliases: SessionAliases): string | null {
  const entries = Object.entries(aliases);
  if (entries.length > SESSION_ALIAS_LIMIT || !entries.every(([key, title]) => validKey(key) && validStoredTitle(title))) return null;
  const raw = JSON.stringify({ version: 1, titles: Object.fromEntries(entries) });
  return utf8Bytes(raw) <= SESSION_ALIAS_DOCUMENT_BYTES ? raw : null;
}

/** Returns an error message, or null when the (untrimmed) input is a usable title. */
export function validateAliasInput(input: string): string | null {
  const title = input.trim();
  if (!title) return "Enter a title, or choose Reset title to restore the original";
  if (CONTROL.test(title)) return "Titles cannot contain control characters";
  if (Array.from(title).length > SESSION_ALIAS_TITLE_LIMIT) return `Titles are limited to ${SESSION_ALIAS_TITLE_LIMIT} characters`;
  return null;
}

export const hasAlias = (aliases: SessionAliases, key: string) => Object.hasOwn(aliases, key);

/** Aliases with `key` set (trimmed) or removed; null when the cap would be exceeded or the title is invalid. */
export function withAlias(aliases: SessionAliases, key: string, input: string | null): SessionAliases | null {
  const next = { ...aliases };
  if (input === null) { delete next[key]; return next; }
  if (validateAliasInput(input)) return null;
  if (!hasAlias(next, key) && Object.keys(next).length >= SESSION_ALIAS_LIMIT) return null;
  next[key] = input.trim();
  return next;
}

/** The title to show: the local alias when present, otherwise the source title. */
export const displayTitle = (aliases: SessionAliases, key: string, sourceTitle: string): string =>
  hasAlias(aliases, key) ? aliases[key] : sourceTitle;

/** Case-insensitive all-terms match against the alias only (client-side, loaded rows). */
export function aliasMatches(aliases: SessionAliases, key: string, query: string): boolean {
  if (!hasAlias(aliases, key)) return false;
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return terms.length > 0 && terms.every(term => aliases[key].toLowerCase().includes(term));
}
