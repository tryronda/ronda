import { expect, test } from "vitest";
import { latestPublishedRelease, parseChangelog, releaseAnchor } from "./releases";

test("landing highlights skip unreleased work and preserve dated release anchors", () => {
  const releases = parseChangelog("## [Unreleased]\n### Added\n- Future feature\n## [1.0.1] - 2026-10-02\n### Fixed\n- Transcript refresh\n");
  const latest = latestPublishedRelease(releases)!;
  expect(latest.version).toBe("1.0.1");
  expect(latest.date).toBe("2026-10-02");
  expect(latest.groups[0].items).toEqual(["Transcript refresh"]);
  expect(releaseAnchor(latest)).toBe("v1-0-1");
  expect(latestPublishedRelease(releases.slice(0, 1))).toBeUndefined();
});
