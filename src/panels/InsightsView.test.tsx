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

import { InsightsView, heatmapSummary } from "./InsightsView";

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
  expect(button(host, "Show all (12)").getAttribute("aria-expanded")).toBe("false");
  await act(async () => { button(host, "Show all (12)").click(); });
  expect(host.querySelectorAll(".insight-bar")).toHaveLength(12);
  expect(button(host, "Show all (12)").getAttribute("aria-expanded")).toBe("true");
  await act(async () => { button(host, "Show all (12)").click(); });
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

test("the Summary copied message clears when the board changes", async () => {
  const { host, root } = await mount();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async (_text: string) => {}) } });
  await act(async () => { button(host, "Copy summary").click(); });
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Summary copied");
  await act(async () => { tab(host, "Projects").click(); });
  expect(host.textContent).not.toContain("Summary copied");
  await act(async () => root.unmount());
});

test("heatmapSummary reports active days, busiest day, longest streak, and range, and handles empty data", () => {
  const cell = (key: string, count: number) => ({ key, count });
  expect(heatmapSummary([])).toBe("No activity data.");
  expect(heatmapSummary([{ key: "pad-0", count: 0, placeholder: true }, cell("2026-01-01", 0), cell("2026-01-02", 0)])).toBe("No activity from 2026-01-01 to 2026-01-02.");
  expect(heatmapSummary([cell("2026-01-01", 2), cell("2026-01-02", 5), cell("2026-01-03", 0), cell("2026-01-04", 1)]))
    .toBe("3 active days from 2026-01-01 to 2026-01-04. Busiest day: 2026-01-02 with 5 prompts. Longest streak: 2 days.");
  expect(heatmapSummary([cell("2026-01-01", 1)])).toBe("1 active day from 2026-01-01 to 2026-01-01. Busiest day: 2026-01-01 with 1 prompt. Longest streak: 1 day.");
});

test("charts expose a screen-reader summary and label: value lists", async () => {
  const today = new Date(); const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  invoke.mockImplementationOnce(async () => ({ ...data, activity: [[key, 3]] as [string, number][], hours: [[9, 4]] as [number, number][] }));
  const { host, root } = await mount();
  expect(host.querySelector('[data-testid="heatmap-summary"]')?.textContent).toContain(`Busiest day: ${key} with 3 prompts`);
  const summary = host.querySelector('[data-testid="heatmap-summary"]')!;
  expect(summary.classList.contains("sr-only")).toBe(false);
  expect(summary.classList.contains("panel-help")).toBe(true);
  expect(summary.closest("[aria-hidden='true']")).toBeNull();
  const lists = Array.from(host.querySelectorAll("ul.sr-only")).map(list => list.textContent);
  expect(lists).toHaveLength(3);
  expect(lists[0]).toContain("Sunday: ");
  expect(lists[2]).toContain("09:00: 4");
  await act(async () => root.unmount());
});

test("heatmap cell titles and the chart label use singular and plural prompts", async () => {
  const today = new Date(); const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  invoke.mockImplementationOnce(async () => ({ ...data, activity: [[key, 1]] as [string, number][], hours: [[9, 4]] as [number, number][] }));
  const { host, root } = await mount();
  expect(host.querySelector(`.heat-cell[title="${key}: 1 prompt"]`)).not.toBeNull();
  expect(host.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("Activity: 1 prompt");
  expect(host.innerHTML).not.toContain("1 Prompts");
  await act(async () => root.unmount());
});

test("weekday, month, and heatmap totals cover only the last 12 months; headings state their span", async () => {
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = new Date(); const old = new Date(); old.setHours(12); old.setDate(old.getDate() - 400);
  invoke.mockImplementationOnce(async () => ({ ...data, prompts: 99, activity: [[fmt(old), 40], [fmt(today), 3]] as [string, number][], hours: [[9, 4]] as [number, number][] }));
  const { host, root } = await mount();
  const lists = Array.from(host.querySelectorAll("ul.sr-only"));
  const total = (list: Element) => Array.from(list.querySelectorAll("li")).reduce((sum, li) => sum + Number(li.textContent!.split(": ")[1]), 0);
  expect(total(lists[0])).toBe(3);
  expect(total(lists[1])).toBe(3);
  expect(host.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("Activity: 3 prompts");
  expect(host.querySelector('.heat-cell[title$=": 3 prompts"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="heatmap-summary"]')!.textContent).toContain("1 active day");
  const head = (name: string) => Array.from(host.querySelectorAll("h2")).find(h => h.textContent === name)!.parentElement!.textContent;
  expect(head("Weekdays")).toContain("Last 12 months");
  expect(head("Months")).toContain("Last 12 months");
  expect(head("Hours")).toContain("All time");
  await act(async () => root.unmount());
});
