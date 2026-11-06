// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../CHANGELOG.md?raw", () => ({
  default: "# Changelog\n\n## [Unreleased]\n\n## [1.0.1] - 2026-10-02\n\n### Fixed\n- Transcript refresh\n",
}));

import { Changelog } from "./Changelog";

test("an Unreleased section without groups renders no card or nav entry", () => {
  const html = renderToStaticMarkup(<Changelog />);
  expect(html).not.toContain('id="unreleased"');
  expect(html).not.toContain('href="#unreleased"');
  expect(html).toContain('id="v1-0-1"');
});
