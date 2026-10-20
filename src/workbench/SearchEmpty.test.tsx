// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { SearchEmpty } from "./SearchEmpty";

async function render(props: Partial<Parameters<typeof SearchEmpty>[0]>) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const handlers = { onClearFilters: vi.fn(), onIncludeArchived: vi.fn() };
  await act(async () => root.render(<SearchEmpty activeFilterCount={0} includeArchived={true} {...handlers} {...props} />));
  return { host, handlers, done: async () => { await act(async () => root.unmount()); host.remove(); } };
}

test("names the active filters and offers both actions", async () => {
  const { host, handlers, done } = await render({ activeFilterCount: 3, includeArchived: false });
  expect(host.textContent).toContain("3 filters are active");
  const buttons = Array.from(host.querySelectorAll("button"));
  await act(async () => buttons.find(item => item.textContent === "Clear filters")!.click());
  await act(async () => buttons.find(item => item.textContent === "Include archived")!.click());
  expect(handlers.onClearFilters).toHaveBeenCalledOnce();
  expect(handlers.onIncludeArchived).toHaveBeenCalledOnce();
  await done();
});

test("offers no actions when nothing is filtered", async () => {
  const { host, done } = await render({});
  expect(host.textContent).toContain("No filters are active");
  expect(host.querySelector("button")).toBeNull();
  await done();
});
