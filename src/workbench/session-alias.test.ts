import { expect, test } from "vitest";
import {
  aliasMatches, displayTitle, parseSessionAliases, serializeSessionAliases, SESSION_ALIAS_LIMIT, validateAliasInput, withAlias,
} from "./session-alias";

const doc = (titles: Record<string, string>) => JSON.stringify({ version: 1, titles });

test("absent pref is empty; valid document round-trips with Unicode", () => {
  expect(parseSessionAliases(null)).toEqual({ ok: true, aliases: {} });
  const aliases = { "codex:a": "Fix 検索 🔎", "claude:b": "Plain" };
  expect(parseSessionAliases(serializeSessionAliases(aliases))).toEqual({ ok: true, aliases });
});

test("malformed documents fail closed", () => {
  for (const raw of ["", "nope", "[]", "{}", JSON.stringify({ version: 2, titles: {} }), JSON.stringify({ version: 1 }),
    JSON.stringify({ version: 1, titles: {}, extra: 1 }), JSON.stringify({ version: 1, titles: [] }),
    doc({ a: "" }), doc({ a: "  padded " }), doc({ a: "tab\there" }), doc({ "": "x" }), doc({ a: "x".repeat(121) }),
    JSON.stringify({ version: 1, titles: { a: 5 } })]) {
    expect(parseSessionAliases(raw).ok, raw).toBe(false);
  }
});

test("caps: 500 entries, 120 code points", () => {
  const full = Object.fromEntries(Array.from({ length: SESSION_ALIAS_LIMIT }, (_, i) => [`k${i}`, "t"]));
  expect(parseSessionAliases(doc(full)).ok).toBe(true);
  expect(parseSessionAliases(doc({ ...full, extra: "t" })).ok).toBe(false);
  expect(serializeSessionAliases({ ...full, extra: "t" })).toBeNull();
  expect(withAlias(full, "extra", "t")).toBeNull();
  expect(withAlias(full, "k1", "renamed")).toMatchObject({ k1: "renamed" });
  expect(parseSessionAliases(doc({ a: "🔎".repeat(120) })).ok).toBe(true);
  expect(parseSessionAliases(doc({ a: "🔎".repeat(121) })).ok).toBe(false);
  expect(validateAliasInput("   ")).not.toBeNull();
  expect(validateAliasInput("x".repeat(121))).not.toBeNull();
  expect(validateAliasInput("  ok  ")).toBeNull();
});

test("withAlias trims, removes, and displayTitle falls back to the source", () => {
  const set = withAlias({}, "k", "  Mine  ")!;
  expect(set).toEqual({ k: "Mine" });
  expect(displayTitle(set, "k", "Source")).toBe("Mine");
  expect(displayTitle(set, "other", "Source")).toBe("Source");
  expect(withAlias(set, "k", null)).toEqual({});
  expect(displayTitle({}, "__proto__", "Source")).toBe("Source");
});

test("alias search matches alias text only, all terms, case-insensitively", () => {
  const aliases = { k: "Release Checklist" };
  expect(aliasMatches(aliases, "k", "checklist release")).toBe(true);
  expect(aliasMatches(aliases, "k", "missing")).toBe(false);
  expect(aliasMatches(aliases, "k", "  ")).toBe(false);
  expect(aliasMatches(aliases, "other", "release")).toBe(false);
});
