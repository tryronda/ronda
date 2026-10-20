// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { RowLabels } from "./RowLabels";

const catalog = ["a", "b", "c", "d", "e"].map(id => ({ id, name: `Label ${id}` }));
async function html(ids: string[] | undefined) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<RowLabels ids={ids} catalog={catalog} />));
  const group = host.querySelector<HTMLElement>('[role="group"]');
  const result = { group, chips: Array.from(host.querySelectorAll(".eyebrow-chip")).map(chip => chip.textContent), titles: Array.from(host.querySelectorAll(".eyebrow-chip")).map(chip => chip.getAttribute("title")), empty: host.innerHTML === "" };
  await act(async () => root.unmount()); host.remove();
  return result;
}

test("renders nothing without labels", async () => {
  expect((await html([])).empty).toBe(true);
  expect((await html(undefined)).empty).toBe(true);
});

test("shows three labels as chips", async () => {
  const view = await html(["a", "b", "c"]);
  expect(view.chips).toEqual(["Label a", "Label b", "Label c"]);
  expect(view.group!.getAttribute("aria-label")).toBe("Labels: Label a, Label b, Label c");
});

test("collapses the rest into a +N chip whose title lists them", async () => {
  const view = await html(["a", "b", "c", "d", "e"]);
  expect(view.chips).toEqual(["Label a", "Label b", "Label c", "+2"]);
  expect(view.titles[3]).toBe("Label d, Label e");
  expect(view.group!.getAttribute("aria-label")).toBe("Labels: Label a, Label b, Label c, Label d, Label e");
});

test("skips ids missing from the catalog", async () => {
  const view = await html(["gone", "a", "also-gone"]);
  expect(view.chips).toEqual(["Label a"]);
  expect(view.group!.getAttribute("aria-label")).toBe("Labels: Label a");
  expect((await html(["gone"])).empty).toBe(true);
});
