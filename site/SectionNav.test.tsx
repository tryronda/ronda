// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SectionNav } from "./Chrome";

test("the active link scrolls into view when the active section changes", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let callback: IntersectionObserverCallback = () => {};
  vi.stubGlobal("IntersectionObserver", class { constructor(cb: IntersectionObserverCallback) { callback = cb; } observe() {} disconnect() {} });
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  document.body.innerHTML = '<div id="a"></div><div id="b"></div><div id="host"></div>';
  const root = createRoot(document.getElementById("host")!);
  const sections = [{ id: "a", title: "A" }, { id: "b", title: "B" }];
  await act(async () => { root.render(<SectionNav label="Test" sections={sections} />); });
  scroll.mockClear();
  await act(async () => { callback([{ isIntersecting: true, target: document.getElementById("b")!, boundingClientRect: { top: 0 } } as unknown as IntersectionObserverEntry], {} as IntersectionObserver); });
  expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "center" });
  expect(scroll.mock.contexts[0]).toBe(document.querySelector('a[href="#b"]'));
  await act(async () => { root.unmount(); });
  vi.unstubAllGlobals();
});
