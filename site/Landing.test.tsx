// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Landing } from "./Landing";

test("landing cards mention Markdown notes export, session labels, and saved searches", () => {
  const html = renderToStaticMarkup(<Landing />);
  expect(html).toContain("a Markdown notes file");
  expect(html).toContain("session label");
  expect(html).toContain("save searches");
});
