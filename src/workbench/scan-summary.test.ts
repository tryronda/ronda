import { describe, expect, test } from "vitest";
import { scanSummary } from "./scan-summary";

describe("scan summary", () => {
  test("reports the local source and session counts without suggesting they add up", () => {
    expect(scanSummary({ discovered: 11, indexed: 3, unchanged: 6, errors: [] }))
      .toBe("Local scan complete — session sources discovered: 11; sessions indexed: 3; sessions unchanged: 6.");
  });

  test("reports only an aggregate scan error count and never exposes error details", () => {
    const summary = scanSummary({ discovered: 2, indexed: 1, unchanged: 0,
      errors: ["/Users/alex/private/session.jsonl parser failed: token=secret-canary", "buildbox /home/alex/other.jsonl"] });
    expect(summary).toBe("Partial local scan — session sources discovered: 2; sessions indexed: 1; sessions unchanged: 0; scan errors: 2.");
    expect(summary).not.toMatch(/alex|private|secret-canary|buildbox|parser/);
  });

  test("distinguishes an empty local result without claiming roots or remote sessions are absent", () => {
    expect(scanSummary({ discovered: 0, indexed: 0, unchanged: 0, errors: [] }))
      .toBe("No local sessions discovered. Local scan complete — session sources discovered: 0; sessions indexed: 0; sessions unchanged: 0.");
  });
});
