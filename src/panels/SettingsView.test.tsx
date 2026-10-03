// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./DiagnosticsExport", () => ({ DiagnosticsExport: () => null }));
vi.mock("./BookmarkData", () => ({ BookmarkData: () => null }));
import { SettingsView } from "./SettingsView";

afterEach(() => { document.body.innerHTML = ""; invoke.mockReset(); });

test("Settings rebuild announces clean, partial, empty, and failure results without leaking errors; retries replace them", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  invoke.mockImplementation((command: string) => {
    if (command === "list_locations" || command === "list_remote_hosts") return Promise.resolve([]);
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
