// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";

MotionGlobalConfig.skipAnimations = true;

const row = (label: string, n: number) => ({ label, sessions: n, prompts: n * 2, tokens: n * 1000 });
const data = {
  sessions: 15, prompts: 300, tokens: 12345, activity: [] as [string, number][],
  agents: [row("codex", 5), row("claude|code", 9)],
  projects: Array.from({ length: 12 }, (_, i) => row(`/repo/p${i}`, i + 1)),
  models: [],
};
const invoke = vi.fn(async (_command: string) => data);
vi.mock("@/lib/tauri", () => ({ invoke: (command: string) => invoke(command), listen: async () => () => {} }));

import { InsightsView } from "./InsightsView";

const mount = async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<InsightsView />); });
  return { host, root };
};
const button = (host: HTMLElement, text: string) => Array.from(host.querySelectorAll("button")).find(b => b.textContent?.startsWith(text))!;
const tab = (host: HTMLElement, name: string) => Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]')).find(t => t.textContent === name)!;

test("a leaderboard shows ten rows, expands to all, and collapses again", async () => {
  const { host, root } = await mount();
  expect(host.querySelectorAll(".insight-bar")).toHaveLength(2);
  expect(button(host, "Show all")).toBeUndefined();
  await act(async () => { tab(host, "Projects").click(); });
  expect(host.querySelectorAll(".insight-bar")).toHaveLength(10);
  await act(async () => { button(host, "Show all").click(); });
  expect(host.querySelectorAll(".insight-bar")).toHaveLength(12);
  await act(async () => { button(host, "Show top 10").click(); });
  expect(host.querySelectorAll(".insight-bar")).toHaveLength(10);
  await act(async () => root.unmount());
});

test("Copy summary writes Markdown for totals and the current board, and reports failures", async () => {
  const { host, root } = await mount();
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await act(async () => { button(host, "Copy summary").click(); });
  const text = writeText.mock.calls[0][0];
  expect(text).toContain("- Sessions: 15");
  expect(text).toContain("## Agents by sessions");
  expect(text).toContain("| 1 | claude\\|code | 9 | 18 | 9000 |");
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Summary copied");

  await act(async () => { tab(host, "Projects").click(); });
  await act(async () => { tab(host, "Tokens").click(); });
  await act(async () => { button(host, "Copy summary").click(); });
  const projects = writeText.mock.calls[1][0];
  expect(projects).toContain("## Projects by tokens");
  expect(projects).toContain("/repo/p0");

  writeText.mockRejectedValueOnce(new Error("denied"));
  await act(async () => { button(host, "Copy summary").click(); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not copy the summary");
  await act(async () => root.unmount());
});
