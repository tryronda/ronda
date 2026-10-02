import { expect, test } from "vitest";
import { searchRanges, searchSnippet } from "./search-text";

test("literal highlighting preserves Unicode positions, merges overlaps, and centers excerpts", () => {
  expect(searchRanges("İ ΑΛΦΑ 你好 useEffect( <img>", "i αλφα 你好 useeffect("))
    .toEqual([{start:0,end:1},{start:2,end:6},{start:7,end:9},{start:10,end:20},{start:22,end:23}]);
  expect(searchRanges("banana", "ana")).toEqual([{start:1,end:6}]);
  expect(searchSnippet(`${"あ".repeat(500)}UseEffect( result`, "useeffect(")).toContain("UseEffect( result");
  expect(searchRanges("<img onerror=alert(1)>", "<img")).toEqual([{start:0,end:4}]);
});
