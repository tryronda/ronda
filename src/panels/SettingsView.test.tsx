// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ invoke: (...args: unknown[]) => invoke(...args), listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./DiagnosticsExport", () => ({ DiagnosticsExport: () => null }));
vi.mock("./BookmarkData", () => ({ BookmarkData: () => null }));
import { SettingsView } from "./SettingsView";

afterEach(() => { document.body.innerHTML = ""; invoke.mockReset(); });

test("Settings rebuild announces clean, partial, empty, and failure results without leaking errors; retries replace them", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  invoke.mockImplementation((command: string) => {
    if (command === "list_locations" || command === "list_remote_hosts") return Promise.resolve([]);
    if (command === "get_local_source_refresh_health") return Promise.resolve(null);
    if (command === "app_paths") return Promise.resolve(["ronda-mcp", "", "index"]);
    if (command === "get_pref") return Promise.resolve(null);
    return Promise.reject(new Error("Unexpected command: " + command));
  });
  const rootHost = document.createElement("div"); document.body.append(rootHost);
  const root = createRoot(rootHost);
  const click = async (button: HTMLButtonElement) => act(async () => { button.click(); await Promise.resolve(); });
  try {
    await act(async () => root.render(<SettingsView />));
    const dataTab = Array.from(rootHost.querySelectorAll<HTMLButtonElement>('nav button')).find(button => button.textContent?.includes("Data"))!;
    await click(dataTab);
    const run = async (report: unknown) => {
      invoke.mockImplementation((command: string) => command === "scan" ? Promise.resolve(report) : Promise.resolve(null));
      await click(Array.from(rootHost.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Rebuild index"))!);
    };
    await run({ discovered: 9, indexed: 2, unchanged: 5, errors: [] });
    expect(rootHost.querySelector('[role="status"]')?.textContent).toContain("Local scan complete — session sources discovered: 9; sessions indexed: 2; sessions unchanged: 5.");
    await run({ discovered: 1, indexed: 0, unchanged: 0, errors: ["/private/alex/parser-secret"] });
    expect(rootHost.querySelector('[role="status"]')?.textContent).toContain("Partial local scan");
    expect(rootHost.querySelector('[role="status"]')?.textContent).toContain("scan errors: 1");
    expect(rootHost.textContent).not.toMatch(/private|alex|parser-secret/);
    await run({ discovered: 0, indexed: 0, unchanged: 0, errors: [] });
    expect(rootHost.querySelector('[role="status"]')?.textContent).toContain("No local sessions discovered");
    invoke.mockImplementation((command: string) => command === "scan" ? Promise.reject(new Error("scan rejected")) : Promise.resolve(null));
    await click(Array.from(rootHost.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Rebuild index"))!);
    expect(rootHost.querySelector('[role="alert"]')?.textContent).toContain("scan rejected");
    expect(rootHost.querySelector('[role="status"]')?.textContent ?? "").not.toContain("No local sessions discovered");
    await run({ discovered: 4, indexed: 4, unchanged: 0, errors: [] });
    expect(rootHost.querySelector('[role="alert"]')).toBeNull();
    expect(rootHost.querySelector('[role="status"]')?.textContent).toContain("Local scan complete — session sources discovered: 4");
  } finally { await act(async () => root.unmount()); rootHost.remove(); }
});

test("Locations renders saved per-root states, current disabled settings, and omits stale root identities", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const rows = [
    { agent: "codex", path: "/configured/zero", health_id: "zero", enabled: true, custom: false },
    { agent: "claude-code", path: "/configured/partial", health_id: "partial", enabled: true, custom: true },
    { agent: "cursor", path: "/configured/missing", health_id: "missing", enabled: true, custom: false },
    { agent: "gemini", path: "/configured/disabled", health_id: "disabled", enabled: false, custom: false },
    { agent: "opencode", path: "/configured/changed", health_id: "new-id", enabled: true, custom: true },
    { agent: "copilot", path: "/configured/one-issue", health_id: "one-issue", enabled: true, custom: true },
  ];
  invoke.mockImplementation((command: string) => {
    if (command === "list_locations") return Promise.resolve(rows);
    if (command === "list_remote_hosts") return Promise.resolve([]);
    if (command === "app_paths") return Promise.resolve(["ronda-mcp", "", "index"]);
    if (command === "get_pref") return Promise.resolve(null);
    if (command === "get_local_source_refresh_health") return Promise.resolve({
      version: 1, completed_at_ms: 1_760_000_000_000, roots_truncated: true,
      roots: [
        { id: "zero", status: "checked", source_records: 0, issues: 0, counts_truncated: false },
        { id: "partial", status: "partial", source_records: 7, issues: 2, counts_truncated: false },
        { id: "missing", status: "unavailable", source_records: 0, issues: 0, counts_truncated: false },
        { id: "disabled", status: "checked", source_records: 9, issues: 0, counts_truncated: false },
        { id: "old-id", status: "checked", source_records: 99, issues: 0, counts_truncated: false },
        { id: "one-issue", status: "partial", source_records: 1, issues: 1, counts_truncated: false },
      ],
    });
    return Promise.resolve(null);
  });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<SettingsView />));
    const locationsTab = Array.from(host.querySelectorAll<HTMLButtonElement>("nav button")).find(button => button.textContent?.includes("Locations"))!;
    await act(async () => { locationsTab.click(); await Promise.resolve(); });
    const rowsText = Array.from(host.querySelectorAll(".location-row")).map(row => row.textContent ?? "").join("\n");
    expect(host.textContent).toContain("Last completed local scan");
    expect(host.textContent).toContain("zero does not prove that agent data is absent");
    expect(host.textContent).toContain("up to 512 locations; additional locations are omitted");
    expect(rowsText).toContain("Checked · 0 source records found");
    expect(rowsText).toContain("Partial · 2 scan issues · 7 source records found");
    expect(rowsText).toContain("Partial · 1 scan issue · 1 source record found");
    expect(rowsText).toContain("Unavailable");
    expect(rowsText).toContain("Disabled");
    expect(rowsText).toContain("Not scanned yet");
    expect(rowsText).not.toContain("99 source records");
    expect(rowsText).not.toContain("old-id");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
