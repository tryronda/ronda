// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { docs } from "./sections";

const text = (id: string) => renderToStaticMarkup(<>{docs.find(section => section.id === id)!.body}</>);

test("the command line docs cover global options and the insights range", () => {
  const cli = text("cli");
  for (const expected of ["--db", "--version", "--since all", "30d", "insights --project"]) expect(cli).toContain(expected);
});

test("the MCP argument table documents ronda_insights since", () => {
  const mcp = text("mcp");
  expect(mcp).toContain("ronda_insights");
  expect(mcp).toContain("30d");
});

test("code blocks are keyboard-focusable regions", () => {
  const html = text("install");
  expect(html).toContain('tabindex="0"');
  expect(html).toContain('aria-label="Code example"');
});

test("the Copy button writes the code to the clipboard", async () => {
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<>{docs.find(section => section.id === "install")!.body}</>); });
  const button = host.querySelector<HTMLButtonElement>(".docs-copy")!;
  await act(async () => { button.click(); });
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining("xattr"));
  expect(button.textContent).toBe("Copied");
  await act(async () => { root.unmount(); });
  host.remove();
});
