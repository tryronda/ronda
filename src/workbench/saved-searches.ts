import { agentIds, type AgentId, type SearchSort } from "./api";

export const SAVED_SEARCHES_KEY = "saved_searches_v1";
export const SAVED_SEARCH_LIMIT = 20;
export const SAVED_SEARCH_NAME_LIMIT = 80;
export const SAVED_SEARCH_QUERY_LIMIT = 512;
export const SAVED_SEARCH_DOCUMENT_BYTES = 64 * 1024;

export interface SavedSearchFilters {
  project: string | null;
  agent: AgentId | null;
  starredOnly: boolean;
  includeArchived: boolean;
  dateFrom: string;
  dateThrough: string;
  model: string;
  host: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters: SavedSearchFilters;
  sort: SearchSort;
}

export interface SavedSearchDocument { version: 1; items: SavedSearch[] }
export type SavedSearchParse = { ok: true; document: SavedSearchDocument } | { ok: false };

const encoder = new TextEncoder();
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const utf8Bytes = (value: string) => encoder.encode(value).length;
const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
const validText = (value: unknown, maxBytes: number): value is string =>
  typeof value === "string" && utf8Bytes(value) <= maxBytes;
const validId = (value: unknown) => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function validFilters(value: unknown): value is SavedSearchFilters {
  if (!isObject(value) || !hasExactKeys(value, ["project", "agent", "starredOnly", "includeArchived", "dateFrom", "dateThrough", "model", "host"])) return false;
  if (!(value.project === null || validText(value.project, 4096))) return false;
  if (!(value.agent === null || (typeof value.agent === "string" && agentIds.includes(value.agent as AgentId)))) return false;
  if (typeof value.starredOnly !== "boolean" || typeof value.includeArchived !== "boolean") return false;
  if (!validText(value.dateFrom, 10) || !validText(value.dateThrough, 10)) return false;
  if ((value.dateFrom && !validDate(value.dateFrom)) || (value.dateThrough && !validDate(value.dateThrough))) return false;
  if (value.dateFrom && value.dateThrough && value.dateFrom > value.dateThrough) return false;
  if (!validText(value.model, 1024) || !validText(value.host, 1024)) return false;
  if (value.host !== "" && value.host !== "local" && !/^remote:.{1,1000}$/s.test(value.host)) return false;
  return true;
}

function validSearch(value: unknown): value is SavedSearch {
  if (!isObject(value) || !hasExactKeys(value, ["id", "name", "query", "filters", "sort"])) return false;
  if (!validId(value.id)) return false;
  if (!validText(value.name, 320) || Array.from(value.name).length < 1 || Array.from(value.name).length > SAVED_SEARCH_NAME_LIMIT || value.name.trim() !== value.name || !value.name.trim()) return false;
  if (!validText(value.query, 2048) || Array.from(value.query).length < 1 || Array.from(value.query).length > SAVED_SEARCH_QUERY_LIMIT || value.query.trim() !== value.query || !value.query.trim()) return false;
  if (!validFilters(value.filters)) return false;
  return value.sort === "relevance" || value.sort === "recent";
}

export function parseSavedSearches(raw: string | null): SavedSearchParse {
  if (raw === null) return { ok: true, document: { version: 1, items: [] } };
  if (utf8Bytes(raw) > SAVED_SEARCH_DOCUMENT_BYTES) return { ok: false };
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value) || !hasExactKeys(value, ["version", "items"]) || value.version !== 1
      || !Array.isArray(value.items) || value.items.length > SAVED_SEARCH_LIMIT || !value.items.every(validSearch)) return { ok: false };
    const ids = new Set<string>();
    if (value.items.some(item => { if (ids.has(item.id)) return true; ids.add(item.id); return false; })) return { ok: false };
    if (hasDuplicateDefinition(value.items)) return { ok: false };
    return { ok: true, document: value as unknown as SavedSearchDocument };
  } catch { return { ok: false }; }
}

export function savedSearchIdentity(search: Pick<SavedSearch, "name" | "query" | "filters" | "sort">) {
  const filters = search.filters;
  return JSON.stringify([search.name, search.query, filters.project, filters.agent, filters.starredOnly,
    filters.includeArchived, filters.dateFrom, filters.dateThrough, filters.model, filters.host, search.sort]);
}

const hasDuplicateDefinition = (items: SavedSearch[]) => {
  const definitions = new Set<string>();
  return items.some(item => {
    const identity = savedSearchIdentity(item);
    if (definitions.has(identity)) return true;
    definitions.add(identity);
    return false;
  });
};

export function serializeSavedSearches(items: SavedSearch[]): string | null {
  if (items.length > SAVED_SEARCH_LIMIT || !items.every(validSearch)) return null;
  const ids = new Set<string>();
  if (items.some(item => { if (ids.has(item.id)) return true; ids.add(item.id); return false; })) return null;
  if (hasDuplicateDefinition(items)) return null;
  const raw = JSON.stringify({ version: 1, items });
  return utf8Bytes(raw) <= SAVED_SEARCH_DOCUMENT_BYTES ? raw : null;
}

export function validateSavedSearchInput(name: string, query: string): string | null {
  if (!name.trim()) return "Enter a name for this saved search";
  if (name.trim() !== name) return "Remove spaces from the start or end of the name";
  if (Array.from(name).length > SAVED_SEARCH_NAME_LIMIT || utf8Bytes(name) > 320) return "Name is too long (maximum 80 characters)";
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return "Enter a search before saving it";
  if (Array.from(trimmedQuery).length > SAVED_SEARCH_QUERY_LIMIT || utf8Bytes(trimmedQuery) > 2048) return "Search is too long (maximum 512 characters)";
  return null;
}
