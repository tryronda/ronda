import { expect, test, vi } from "vitest";
import { plural, timeLabel } from "./utils";

test("plural puts the count before a singular or plural noun", () => {
  expect(plural(0, "file")).toBe("0 files");
  expect(plural(1, "file")).toBe("1 file");
  expect(plural(2, "file")).toBe("2 files");
  expect(plural(1, "match", "matches")).toBe("1 match");
  expect(plural(3, "match", "matches")).toBe("3 matches");
});

test("timeLabel formats same-year, other-year and empty times, reusing two formatters", () => {
  const now = new Date();
  const same = new Date(now.getFullYear(), 0, 5, 9, 7).getTime();
  const other = new Date(now.getFullYear() - 2, 2, 3, 14, 30).getTime();
  expect(timeLabel(0)).toBe("");
  expect(timeLabel(same)).toBe("Jan 5, 09:07 AM");
  expect(timeLabel(other)).toBe(`Mar 3, ${now.getFullYear() - 2}, 02:30 PM`);
  const real = Intl.DateTimeFormat;
  const ctor = vi.fn((...args: ConstructorParameters<typeof Intl.DateTimeFormat>) => new real(...args));
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(ctor as never);
  try {
    for (let i = 0; i < 100; i++) timeLabel(i % 2 ? same : other);
    expect(ctor.mock.calls.length).toBeLessThanOrEqual(2);
  } finally { vi.restoreAllMocks(); }
});
