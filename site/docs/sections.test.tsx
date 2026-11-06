// @vitest-environment happy-dom
import { expect, test } from "vitest";
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
