// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";
import type { Intelligence } from "./IntelligenceView";

MotionGlobalConfig.skipAnimations = true;

const report: Intelligence = {
  since: null, project: null,
  totals: { sessions: 4, active_ms: 5_400_000, recovery_ms: 1_800_000, tool_calls: 40, tool_errors: 6, failed_sessions: 1, recurring_bugs: 1 },
  time: [{ category: "bugs", label: "Fixing bugs", sessions: 2, active_ms: 3_600_000 }],
  failures: [{ pattern: "edit_loop", label: "Edit loop", sessions: 1, evidence: [{ session_key: "codex:b", seq: 9, title: "Add import" }] }],
  recurring: [{ signature: "abc", message: "Error: database is locked", sessions: 2, agents: ["claude-code", "codex"], projects: ["/repo"],
    first_seen: 1, last_seen: 2, came_back: true, evidence: [{ session_key: "claude-code:a", seq: 3, title: "Fix reindex" }] }],
  stack: [{ tech: "Rust", sessions: 3, share: 75, new: true }],
  outcomes: [{ outcome: "committed", label: "committed", sessions: 3, active_ms: 3_000_000 }, { outcome: "failed", label: "ended failing", sessions: 1, active_ms: 2_400_000 }],
  coverage: [{ agent: "codex", sessions: 2, with_tools: 2, with_time: 2 }, { agent: "antigravity", sessions: 2, with_tools: 0, with_time: 0 }],
  callouts: ["Recovering from failing commands took 30 min (33% of active time)."],
};

const invoke = vi.fn(async (command: string, _args?: unknown) => command === "list_projects" ? [{ path: "/repo" }] : report);
vi.mock("@/lib/tauri", () => ({ invoke: (command: string, args?: unknown) => invoke(command, args), listen: async () => () => {} }));

import { IntelligenceView } from "./IntelligenceView";

test("renders the report, filters by range, and opens evidence", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const onOpen = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<IntelligenceView onOpen={onOpen} />); });

  const text = host.textContent ?? "";
  for (const expected of ["Fixing bugs", "Recovering from failing commands", "Error: database is locked", "came back after a session with a commit command",
    "Rust", "75%", "ended failing", "No tool data from antigravity", "33% of active time"]) expect(text).toContain(expected);
  const monthCall = invoke.mock.calls.find(([command]) => command === "get_intelligence")!;
  expect((monthCall[1] as { since: number }).since).toBeGreaterThan(Date.now() - 31 * 86_400_000);

  await act(async () => { host.querySelector<HTMLButtonElement>(".intel-bug")!.click(); });
  expect(onOpen).toHaveBeenCalledWith("claude-code:a", 3);
  await act(async () => { host.querySelector<HTMLButtonElement>(".intel-evidence button")!.click(); });
  expect(onOpen).toHaveBeenLastCalledWith("codex:b", 9);

  invoke.mockClear();
  const select = host.querySelector<HTMLSelectElement>(".intel-project")!;
  await act(async () => { select.value = "/repo"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(invoke).toHaveBeenCalledWith("get_intelligence", expect.objectContaining({ project: "/repo" }));
  await act(async () => { root.unmount(); });
});

test("shows every recurring error and stack row and copies a Markdown summary", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const big: Intelligence = {
    ...report,
    recurring: Array.from({ length: 11 }, (_, i) => ({ ...report.recurring[0], signature: `s${i}`, message: i === 0 ? "bad | pipe\nline" : `Error ${i}` })),
    stack: Array.from({ length: 12 }, (_, i) => ({ tech: `Tech${i}`, sessions: 1, share: 10, new: false })),
  };
  invoke.mockImplementation(async (command: string) => command === "list_projects" ? [{ path: "/repo" }] : big);
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<IntelligenceView />); });

  expect(host.querySelectorAll(".intel-bug")).toHaveLength(8);
  expect(host.querySelectorAll(".insight-bar")).toHaveLength(10);
  const button = (name: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.startsWith(name))!;
  await act(async () => { button("Show all (11)").click(); });
  expect(host.querySelectorAll(".intel-bug")).toHaveLength(11);
  await act(async () => { button("Show all (12)").click(); });
  expect(host.querySelectorAll(".insight-bar")).toHaveLength(12);
  await act(async () => { button("Show top 8").click(); });
  expect(host.querySelectorAll(".intel-bug")).toHaveLength(8);

  await act(async () => { button("Copy summary").click(); });
  const text = writeText.mock.calls[0][0];
  expect(text).toContain("- Range: 30 days");
  expect(text).toContain("- Project: All projects");
  expect(text).toContain("bad \\| pipe line");
  expect(text).toContain("Error 10");
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Summary copied");

  writeText.mockRejectedValueOnce(new Error("denied"));
  await act(async () => { button("Copy summary").click(); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("denied");
  await act(async () => { root.unmount(); });
});
