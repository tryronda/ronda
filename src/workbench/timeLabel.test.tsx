import { afterEach, expect, test, vi } from "vitest";
import { timeLabel } from "./Workbench";

afterEach(() => vi.useRealTimers());

test("timeLabel omits the year for the current year and includes it otherwise", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 5, 15, 12, 0));
  expect(timeLabel(0)).toBe("");
  expect(timeLabel(new Date(2026, 0, 3, 9, 5).getTime())).not.toContain("2026");
  expect(timeLabel(new Date(2025, 11, 31, 23, 30).getTime())).toContain("2025");
  expect(timeLabel(new Date(2027, 0, 1, 0, 30).getTime())).toContain("2027");
  vi.setSystemTime(new Date(2027, 0, 2));
  expect(timeLabel(new Date(2026, 0, 3, 9, 5).getTime())).toContain("2026");
});
