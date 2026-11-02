import { expect, test } from "vitest";
import { plural } from "./utils";

test("plural puts the count before a singular or plural noun", () => {
  expect(plural(0, "file")).toBe("0 files");
  expect(plural(1, "file")).toBe("1 file");
  expect(plural(2, "file")).toBe("2 files");
  expect(plural(1, "match", "matches")).toBe("1 match");
  expect(plural(3, "match", "matches")).toBe("3 matches");
});
