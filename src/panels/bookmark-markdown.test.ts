import { expect, test } from "vitest";
import type { MessageBookmark } from "@/workbench/api";
import { bookmarksToMarkdown } from "./bookmark-markdown";

const make = (over: Partial<MessageBookmark>): MessageBookmark => ({
  session_key: "codex:a", seq: 1, note: "", excerpt: "Excerpt", text_hash: "h", created_at: 1, updated_at: 1,
  title: "Alpha", agent: "codex", project_path: null, ...over,
});

test("groups by session title and orders bookmarks by sequence", () => {
  const md = bookmarksToMarkdown({ bookmarks: [
    make({ session_key: "codex:b", title: "Beta", seq: 2, excerpt: "b2" }),
    make({ seq: 9, excerpt: "a9" }), make({ seq: 3, excerpt: "a3" }),
    make({ session_key: "codex:b", title: "Beta", seq: 1, excerpt: "b1" }),
  ] });
  expect(md.indexOf("## Alpha")).toBeLessThan(md.indexOf("## Beta"));
  expect(md.match(/^## /gm)).toHaveLength(2);
  const order = ["#3", "> a3", "#9", "> a9", "## Beta", "#1", "> b1", "#2", "> b2"].map(token => md.indexOf(token));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(order.every(index => index >= 0)).toBe(true);
});

test("omits empty notes and keeps multi-line notes and quotes", () => {
  const md = bookmarksToMarkdown({ bookmarks: [make({ seq: 1, note: "   " }), make({ seq: 2, note: "line one\nline two", excerpt: "x\n\ny" })] });
  expect(md.match(/\*\*Note:\*\*/g)).toHaveLength(1);
  expect(md).toContain("**Note:** line one  \nline two");
  expect(md).toContain("> x\n>\n> y");
});

test("escapes backticks, HTML and block syntax so content cannot change structure", () => {
  const md = bookmarksToMarkdown({ bookmarks: [make({ title: "# Fix `x`\nnext", excerpt: "```js\n# not a heading\n<script>alert(1)</script>", note: "- item *bold*" })] });
  expect(md).toContain("## \\# Fix \\`x\\` next");
  expect(md).not.toMatch(/^```/m);
  expect(md).toContain("> \\`\\`\\`js\n> \\# not a heading\n> \\<script>alert(1)\\</script>");
  expect(md).toContain("**Note:** \\- item \\*bold\\*");
});

test("an empty backup still yields a document", () => {
  expect(bookmarksToMarkdown({ bookmarks: [] })).toBe("# Ronda bookmarks\n\nNo bookmarks saved.\n");
});
