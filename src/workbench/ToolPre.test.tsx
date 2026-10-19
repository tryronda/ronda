// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { clampInfo, ToolPre } from "./ToolPre";

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

test("clampInfo uses line and character thresholds", () => {
  expect(clampInfo(lines(40))).toEqual({ lines: 40, clamped: false });
  expect(clampInfo(lines(41))).toEqual({ lines: 41, clamped: true });
  expect(clampInfo("x".repeat(4000)).clamped).toBe(false);
  expect(clampInfo("x".repeat(4001)).clamped).toBe(true);
});

test("short output has no toggle; long output toggles with aria and keeps full text", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ToolPre field="a" text="short" />));
    expect(host.querySelector("button")).toBeNull();
    const long = lines(60);
    await act(async () => root.render(<ToolPre field="b" text={long} />));
    const pre = host.querySelector("pre")!, button = host.querySelector("button")!;
    expect(pre.textContent).toBe(long);
    expect(pre.dataset.clamped).toBe("true");
    expect(button.textContent).toBe("Show all 60 lines");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe(pre.id);
    await act(async () => button.click());
    expect(pre.dataset.clamped).toBeUndefined();
    expect(button.textContent).toBe("Show less");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    await act(async () => button.click());
    expect(pre.dataset.clamped).toBe("true");
    await act(async () => { pre.dispatchEvent(new Event("ronda-reveal")); });
    expect(pre.dataset.clamped).toBeUndefined();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
