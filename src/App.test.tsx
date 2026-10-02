// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";

MotionGlobalConfig.skipAnimations = true;

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("./workbench/Workbench", () => ({ Workbench: ({onNavigateDetail,location}: {onNavigateDetail?:(detail:unknown)=>void;location?:{kind:string}}) => <div data-testid="workbench">Library state
  <span data-testid="detail-kind">{location?.kind ?? "home"}</span>
  <button onClick={()=>onNavigateDetail?.({kind:"project",path:"/repo",host:"buildbox",local_only:false})}>Test project</button>
  <button onClick={()=>onNavigateDetail?.({kind:"session",key:"codex:fixture",seq:7,project:{path:"/repo",host:"buildbox",local_only:false}})}>Test session</button>
</div> }));
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


test("project and exact session entries share the existing back/forward history",async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  await act(async()=>root.render(<App />));
  const click=async(label:string)=>act(async()=>{Array.from(host.querySelectorAll("button")).find(button=>button.textContent===label || button.title===label)!.click();});
  await click("Test project");expect(host.querySelector('[data-testid="detail-kind"]')!.textContent).toBe("project");
  await click("Test session");expect(host.querySelector('[data-testid="detail-kind"]')!.textContent).toBe("session");
  await click("Back");expect(host.querySelector('[data-testid="detail-kind"]')!.textContent).toBe("project");
  await click("Forward");expect(host.querySelector('[data-testid="detail-kind"]')!.textContent).toBe("session");
  await click("Back");await click("Home");expect(host.querySelector('[data-testid="detail-kind"]')!.textContent).toBe("home");
  expect(host.querySelector<HTMLButtonElement>('button[title="Forward"]')!.disabled).toBe(true);
  await act(async()=>root.unmount());host.remove();
});
