import { expect, test } from "vitest";
import {
  SAVED_SEARCH_DOCUMENT_BYTES, SAVED_SEARCH_LIMIT, parseSavedSearches, savedSearchIdentity,
  serializeSavedSearches, validateSavedSearchInput, type SavedSearch,
} from "./saved-searches";

const saved: SavedSearch = {
  id: "123e4567-e89b-42d3-a456-426614174000", name: "Connection failures", query: "ECONNRESET",
  filters: { project: "/projects/demo", agent: "codex", starredOnly: false, includeArchived: true,
    dateFrom: "2026-01-01", dateThrough: "2026-01-31", model: "gpt-5", host: "remote:buildbox" }, sort: "recent",
};

test("saved-search document accepts only the complete supported versioned shape", () => {
  const raw = serializeSavedSearches([saved]);
  expect(raw).not.toBeNull();
  const parsed = parseSavedSearches(raw!);
  expect(parsed.ok && parsed.document).toEqual({ version: 1, items: [saved] });
  expect(parseSavedSearches(null)).toEqual({ ok: true, document: { version: 1, items: [] } });
  for (const value of ["{", JSON.stringify({ version: 2, items: [] }), JSON.stringify({ version: 1, items: [], extra: true }),
    JSON.stringify({ version: 1, items: [{ ...saved, extra: true }] }), JSON.stringify({ version: 1, items: [{ ...saved, id: "bad" }] }),
    JSON.stringify({ version: 1, items: [{ ...saved, filters: { ...saved.filters, dateFrom: "2026-02-31" } }] }),
    JSON.stringify({ version: 1, items: [{ ...saved, filters: { ...saved.filters, agent: "unknown" } }] })]) {
    expect(parseSavedSearches(value).ok).toBe(false);
  }
});

test("saved-search limits use character and UTF-8 byte counts and reject oversize documents", () => {
  expect(validateSavedSearchInput("a".repeat(80), "x".repeat(512))).toBeNull();
  expect(validateSavedSearchInput("🧭".repeat(81), "x")).toContain("Name is too long");
  expect(validateSavedSearchInput("name", "🧭".repeat(513))).toContain("Search is too long");
  expect(validateSavedSearchInput("  name", "query")).toContain("spaces");
  expect(validateSavedSearchInput("name", "  ")).toContain("Enter a search");
  expect(parseSavedSearches(" ".repeat(SAVED_SEARCH_DOCUMENT_BYTES + 1)).ok).toBe(false);
  const tooMany = Array.from({ length: SAVED_SEARCH_LIMIT + 1 }, (_, index) => ({ ...saved,
    id: `123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, "0")}` }));
  expect(serializeSavedSearches(tooMany)).toBeNull();
  const large = Array.from({ length: SAVED_SEARCH_LIMIT }, (_, index) => ({ ...saved,
    id: `123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, "0")}`,
    name: `Search ${index}`, filters: { ...saved.filters, project: `/projects/${String(index).padStart(2, "0")}${"x".repeat(4000)}` } }));
  expect(serializeSavedSearches(large)).toBeNull();
});

test("exact duplicate identity includes name, query, every scope and sort", () => {
  const reordered = { name: saved.name, query: saved.query, sort: saved.sort, filters: {
    host: saved.filters.host, model: saved.filters.model, dateThrough: saved.filters.dateThrough,
    dateFrom: saved.filters.dateFrom, includeArchived: saved.filters.includeArchived,
    starredOnly: saved.filters.starredOnly, agent: saved.filters.agent, project: saved.filters.project,
  } };
  expect(savedSearchIdentity(saved)).toBe(savedSearchIdentity(reordered));
  expect(savedSearchIdentity(saved)).not.toBe(savedSearchIdentity({ ...saved, query: "timeout" }));
  expect(savedSearchIdentity(saved)).not.toBe(savedSearchIdentity({ ...saved, filters: { ...saved.filters, project: null } }));
  expect(savedSearchIdentity(saved)).not.toBe(savedSearchIdentity({ ...saved, sort: "relevance" }));
  const duplicate = { id: "123e4567-e89b-42d3-a456-426614174001", name: saved.name, query: saved.query, sort: saved.sort, filters: reordered.filters };
  expect(parseSavedSearches(JSON.stringify({ version: 1, items: [saved, duplicate] })).ok).toBe(false);
});
