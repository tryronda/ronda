// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { backend } from "@/workbench/api";
import { appendDemoMessage, installDemoBackend, uninstallDemoBackend } from "./demo";

afterEach(uninstallDemoBackend);

test("sample messages update the real workbench backend and notify subscribed readers", async () => {
  installDemoBackend();
  const changed = vi.fn();
  const stop = await backend.onLibraryChanged(changed);
  const before = await backend.getTranscript("claude-code:demo-0");
  const originalLength = before.length;
  appendDemoMessage();
  const after = await backend.getTranscript("claude-code:demo-0");
  expect(after).toHaveLength(originalLength + 1);
  expect(after.at(-1)?.text).toContain("Sample update");
  expect(changed).toHaveBeenCalledTimes(1);
  stop(); appendDemoMessage(); expect(changed).toHaveBeenCalledTimes(1);
  await expect(invoke("unknown_preview_command")).rejects.toThrow("Unsupported preview command");
});

test("preview groups title and message matches, sorts, pages, and honors filters", async () => {
  installDemoBackend();
  const { queryDefaults } = await import("@/workbench/api");
  const first = await backend.searchGrouped("pagination", queryDefaults, "relevance", 0, 50);
  expect(first.groups).toHaveLength(50);
  expect(first.total_sessions).toBe(54);
  expect(first.total_message_matches).toBe(78);
  const second = await backend.searchGrouped("pagination", queryDefaults, "recent", 50, 50);
  expect(second.groups).toHaveLength(4);
  expect(new Set([...first.groups,...second.groups].map(group=>group.session.key)).size).toBe(54);
  const matches = await backend.searchSessionMatches("pagination", queryDefaults, "codex:pagination-0", 20, 20);
  expect(matches.total_matches).toBe(25);expect(matches.matches).toHaveLength(5);expect(matches.matches[0].seq).toBe(20);
  const archived = await backend.searchGrouped("pagination", {...queryDefaults,include_archived:true}, "recent", 0, 100);
  expect(archived.total_sessions).toBe(55);
  const title = await backend.searchGrouped("refunds endpoint",queryDefaults,"relevance",0,50);
  expect(title.groups[0].title_match).toBe(true);expect(title.groups[0].message_matches).toBe(0);
  const code = await backend.searchGrouped("USEEFFECT(",queryDefaults,"relevance",0,50);
  expect(code.groups[0].excerpts.length).toBeGreaterThan(1);
  const filter = await backend.searchGrouped("pagination", {...queryDefaults, agent:"cursor"},"recent",0,50);
  expect(filter.total_sessions).toBe(0);
});
