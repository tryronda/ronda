import {expect, test} from "vitest";
import {calendarRange} from "./library-filters";

test("calendar ranges include the end day, validate dates, and respect local DST boundaries", () => {
  expect(calendarRange("", "")).toEqual({updated_from_ms:null,updated_before_ms:null});
  const leap = calendarRange("2024-02-29", "2024-02-29");
  expect(new Date(leap.updated_from_ms!).getDate()).toBe(29);
  expect(new Date(leap.updated_before_ms!).getMonth()).toBe(2);
  expect(new Date(leap.updated_before_ms!).getDate()).toBe(1);
  expect(new Date(calendarRange("0001-01-01", "").updated_from_ms!).getFullYear()).toBe(1);
  for (const date of ["2023-02-29", "2024-13-01", "2024-01-32", "2024-2-01", "0000-01-01"]) {
    expect(()=>calendarRange(date, "")).toThrow("valid date");
  }
  expect(()=>calendarRange("2024-03-02", "2024-03-01")).toThrow("End date");
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone === "America/New_York") {
    for (const [date, hours] of [["2024-03-10",23],["2024-11-03",25]] as const) {
      const range = calendarRange(date,date);
      expect((range.updated_before_ms!-range.updated_from_ms!)/3_600_000).toBe(hours);
    }
  }
  if (zone === "America/Sao_Paulo") {
    const range = calendarRange("2018-11-04", "2018-11-04");
    expect(new Date(range.updated_from_ms!).getHours()).toBe(1);
    expect(new Date(range.updated_before_ms!).getHours()).toBe(0);
    expect((range.updated_before_ms!-range.updated_from_ms!)/3_600_000).toBe(23);
  }
});
