// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";

MotionGlobalConfig.skipAnimations = true;

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("./workbench/Workbench", () => ({ Workbench: () => <div data-testid="workbench">Library state</div> }));
vi.mock("./panels/InsightsView", () => ({ InsightsView: () => <div>Insights content</div> }));
vi.mock("./panels/IntelligenceView", () => ({ IntelligenceView: () => <div>Intelligence content</div> }));
vi.mock("./panels/SettingsView", () => ({ SettingsView: () => <div>Settings content</div> }));

import App from "./App";

afterEach(() => { document.body.innerHTML = ""; });

test("top bar navigation preserves the library and supports history", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<App />); });
  const library = host.querySelector('[data-testid="workbench"]');
  const click = async (name: string) => { await act(async () => { host.querySelector<HTMLButtonElement>(`button[title^="${name}"]`)!.click(); }); };

  await click("Insights");
  expect(host.textContent).toContain("Insights content");
  expect(host.querySelector('[data-testid="workbench"]')).toBe(library);
  await click("Intelligence");
  expect(host.textContent).toContain("Intelligence content");
  await click("Settings");
  expect(host.textContent).toContain("Settings content");
  expect(host.querySelector('button[title="Settings (Ctrl+4)"], button[title="Settings (⌘4)"]')).not.toBeNull();
  await click("Back");
  expect(host.textContent).toContain("Intelligence content");
  await click("Back");
  expect(host.textContent).toContain("Insights content");
  await click("Back");
  expect(host.querySelector('.workspace-view')?.hasAttribute('hidden')).toBe(false);
  await act(async () => { root.unmount(); });
});
