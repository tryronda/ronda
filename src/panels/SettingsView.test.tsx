// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ invoke: (...args: unknown[]) => invoke(...args), listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./DiagnosticsExport", () => ({ DiagnosticsExport: () => null }));
vi.mock("./BookmarkData", () => ({ BookmarkData: () => null }));
import { SettingsView, validSshHost } from "./SettingsView";

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

test("Connect offers a command-line snippet with the CLI path and copies it", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  invoke.mockImplementation((command: string) => {
    if (command === "list_locations" || command === "list_remote_hosts") return Promise.resolve([]);
    if (command === "app_paths") return Promise.resolve(["/opt/ronda/ronda-mcp", "/opt/ronda/ronda-cli", "index"]);
    return Promise.resolve(null);
  });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<SettingsView />));
    const connect = Array.from(host.querySelectorAll<HTMLButtonElement>("nav button")).find(button => button.textContent?.includes("Connect"))!;
    await act(async () => { connect.click(); await Promise.resolve(); });
    const block = Array.from(host.querySelectorAll(".settings-snippet")).find(el => el.textContent?.includes("Command line"))!;
    expect(block.textContent).toContain("Add to AGENTS.md or CLAUDE.md:");
    expect(block.textContent).toContain('`/opt/ronda/ronda-cli sessions --project "$PWD"`');
    expect(block.textContent).toContain("`/opt/ronda/ronda-cli search <query>`");
    await act(async () => { block.querySelector("button")!.click(); await Promise.resolve(); });
    expect(writeText.mock.calls[0][0]).toContain("`/opt/ronda/ronda-cli show <key>`");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("Data copies the index path; the button stays disabled without one", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  let indexPath = "";
  invoke.mockImplementation((command: string) => {
    if (command === "list_locations" || command === "list_remote_hosts") return Promise.resolve([]);
    if (command === "app_paths") return Promise.resolve(["m", "c", indexPath]);
    return Promise.resolve(null);
  });
  const open = async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<SettingsView />));
    const data = Array.from(host.querySelectorAll<HTMLButtonElement>("nav button")).find(button => button.textContent?.includes("Data"))!;
    await act(async () => { data.click(); await Promise.resolve(); });
    return { host, root, copyButton: () => host.querySelector<HTMLButtonElement>('button[aria-label="Copy index path"]')! };
  };
  const empty = await open();
  expect(empty.copyButton().disabled).toBe(true);
  await act(async () => empty.root.unmount()); empty.host.remove();
  indexPath = "/data/ronda.db";
  const ready = await open();
  try {
    expect(ready.copyButton().disabled).toBe(false);
    await act(async () => { ready.copyButton().click(); await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledWith("/data/ronda.db");
    expect(ready.host.querySelector('[role="status"]')?.textContent).toBe("Copied");
  } finally { await act(async () => ready.root.unmount()); ready.host.remove(); }
});

const mountSettings = async (rows: unknown[], hosts: unknown[], tab: string) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  invoke.mockImplementation((command: string) => {
    if (command === "list_locations") return Promise.resolve(rows);
    if (command === "list_remote_hosts") return Promise.resolve(hosts);
    if (command === "app_paths") return Promise.resolve(["ronda-mcp", "", "index"]);
    return Promise.resolve(null);
  });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SettingsView />));
  const nav = Array.from(host.querySelectorAll<HTMLButtonElement>("nav button")).find(button => button.textContent?.includes(tab))!;
  await act(async () => { nav.click(); await Promise.resolve(); });
  return { host, root };
};
const typeInto = async (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

test("adding an already configured location explains it, keeps the path, and saves nothing", async () => {
  const rows = [
    { agent: "claude-code", path: "/Users/me/.claude/projects", health_id: "a", enabled: true, custom: false },
    { agent: "codex", path: "/work/codex", health_id: "b", enabled: true, custom: true },
    { agent: "gemini", path: "/Users/me/.gemini/tmp", health_id: "c", enabled: false, custom: false },
  ];
  const { host, root } = await mountSettings(rows, [], "Locations");
  try {
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Agent"]')!;
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Absolute folder path"]')!;
    const add = Array.from(host.querySelectorAll<HTMLButtonElement>(".settings-form button")).find(b => b.textContent === "Add")!;
    const attempt = async (agent: string, path: string) => {
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, agent); select.dispatchEvent(new Event("change", { bubbles: true })); });
      await typeInto(input, path);
      await act(async () => { add.click(); await Promise.resolve(); });
    };
    await attempt("claude-code", "/Users/me/.claude/projects/");
    expect(host.querySelector('[role="status"].panel-notice')?.textContent).toBe("Already configured: claude-code · /Users/me/.claude/projects (enabled)");
    expect(input.value).toBe("/Users/me/.claude/projects/");
    await attempt("codex", "/work/codex");
    expect(host.querySelector('.panel-notice')?.textContent).toContain("Already configured: codex · /work/codex (enabled)");
    await attempt("gemini", "/Users/me/.gemini/tmp");
    expect(host.querySelector('.panel-notice')?.textContent).toMatch(/\(disabled; turn it on with its switch/);
    expect(invoke.mock.calls.some(call => call[0] === "set_pref")).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("validSshHost mirrors the core rules", () => {
  for (const ok of ["box", "me@box.example.com", "a_b-c.d", "user@10.0.0.1"]) expect(validSshHost(ok)).toBe(true);
  for (const bad of ["", "-oProxyCommand=x", "a b", "host;rm", "bøx", "a/b"]) expect(validSshHost(bad)).toBe(false);
});

test("remote host entry rejects invalid and duplicate names without calling the backend", async () => {
  const { host, root } = await mountSettings([], [{ host: "box", enabled: false, last_sync_ms: null, last_error: null }], "Remote hosts");
  try {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="SSH host or alias"]')!;
    const add = () => Array.from(host.querySelectorAll<HTMLButtonElement>(".settings-form button")).find(b => b.textContent === "Add")!;
    await typeInto(input, "-oProxyCommand=x");
    await act(async () => { add().click(); await Promise.resolve(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Use letters, numbers, @ . _ - only; cannot start with -");
    await typeInto(input, "box");
    await act(async () => { add().click(); await Promise.resolve(); });
    expect(host.querySelector('.panel-notice')?.textContent).toBe("Already configured: box");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(invoke.mock.calls.some(call => call[0] === "set_remote_host")).toBe(false);
    expect(input.value).toBe("box");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
