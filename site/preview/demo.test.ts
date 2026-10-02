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
