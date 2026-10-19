// @vitest-environment happy-dom
import { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";

MotionGlobalConfig.skipAnimations = true;

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("./workbench/Workbench", () => ({ Workbench: ({onNavigateDetail,location,searchFocusToken}: {onNavigateDetail?:(detail:unknown)=>void;location?:{kind:string};searchFocusToken?:number}) => {
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { if (searchFocusToken) search.current?.focus(); }, [searchFocusToken]);
  return <div data-testid="workbench">Library state<input ref={search} aria-label="Mock search" />
  <span data-testid="detail-kind">{location?.kind ?? "home"}</span>
  <button onClick={()=>onNavigateDetail?.({kind:"project",path:"/repo",host:"buildbox",local_only:false})}>Test project</button>
  <button onClick={()=>onNavigateDetail?.({kind:"session",key:"codex:fixture",seq:7,project:{path:"/repo",host:"buildbox",local_only:false}})}>Test session</button>
</div>; } }));
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

test("question mark opens the shortcuts help, Escape closes it, and typing in a field is ignored", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<App />); });
  const press = async (target: Element | Document, key: string) => act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
  expect(host.querySelector("dialog")).toBeNull();

  const field = document.createElement("input"); host.append(field); field.focus();
  await press(field, "?");
  expect(host.querySelector("dialog")).toBeNull();
  field.remove();

  const opener = host.querySelector<HTMLButtonElement>('button[title="Back"]')!; opener.focus();
  await press(document.body, "?");
  const dialog = host.querySelector("dialog")!;
  expect(dialog.textContent).toContain("Keyboard shortcuts");
  expect(dialog.textContent).toContain("Search the library");
  expect(dialog.textContent).toContain("Jump to the previous / next prompt");

  await press(dialog, "Escape");
  expect(host.querySelector("dialog")).toBeNull();

  await act(async () => { host.querySelector<HTMLButtonElement>('button[title^="Keyboard shortcuts"]')!.click(); });
  expect(host.querySelector("dialog")).not.toBeNull();
  await act(async () => { root.unmount(); });
});

test("switching views moves focus into the new view without breaking search focus", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<App />); });
  const press = async (key: string, init: KeyboardEventInit = {}) => act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });
  const regionOf = (text: string) => Array.from(host.querySelectorAll<HTMLElement>(".page-layer")).find(item => item.textContent?.includes(text))!;
  // No focus theft on first mount.
  expect(document.activeElement).toBe(document.body);

  await press("2", { metaKey: true });
  expect(document.activeElement).toBe(regionOf("Insights content"));
  await press("3", { ctrlKey: true });
  expect(document.activeElement).toBe(regionOf("Intelligence content"));

  // Focus inside the departing page follows the navigation.
  const field = host.querySelector<HTMLInputElement>('[aria-label="Mock search"]')!;
  await press("1", { metaKey: true });
  await act(async () => field.focus());
  await press("2", { metaKey: true });
  expect(document.activeElement).toBe(regionOf("Insights content"));

  // Focus on chrome outside any page is left alone.
  const back = host.querySelector<HTMLButtonElement>('button[title="Back"]')!;
  back.focus();
  await press("3", { metaKey: true });
  expect(document.activeElement).toBe(back);

  // Cmd/Ctrl+K still lands on the search field.
  await press("k", { metaKey: true });
  expect(document.activeElement).toBe(field);
  await act(async () => { root.unmount(); });
});
