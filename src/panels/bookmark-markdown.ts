import type { BookmarkBackup, MessageBookmark } from "@/workbench/api";

/** Escapes characters that would change meaning in Markdown, including raw HTML and line-leading block syntax. */
export function escapeMarkdown(text: string): string {
  return text.replace(/\r\n?/g, "\n")
    .replace(/[\\`*_[\]<]/g, match => `\\${match}`)
    .replace(/^(\s*)([#>+-]|\d+[.)])/gm, (_, space: string, mark: string) => `${space}\\${mark}`);
}

const oneLine = (text: string) => escapeMarkdown(text).replace(/\s+/g, " ").trim();
const quote = (text: string) => escapeMarkdown(text).split("\n").map(line => line ? `> ${line}` : ">").join("\n");

/** Builds a readable notes document: sessions sorted by title, bookmarks in message order, empty notes omitted. */
export function bookmarksToMarkdown(backup: Pick<BookmarkBackup, "bookmarks">): string {
  const groups = new Map<string, MessageBookmark[]>();
  for (const bookmark of backup.bookmarks) groups.set(bookmark.session_key, [...(groups.get(bookmark.session_key) ?? []), bookmark]);
  const sessions = [...groups.values()].sort((a, b) =>
    a[0].title.localeCompare(b[0].title) || a[0].session_key.localeCompare(b[0].session_key));
  const parts = ["# Ronda bookmarks"];
  if (!sessions.length) parts.push("No bookmarks saved.");
  for (const group of sessions) {
    const first = group[0];
    const where = [first.agent, first.project_path].filter(Boolean).map(value => oneLine(String(value))).join(" · ");
    parts.push(`## ${oneLine(first.title) || "Untitled session"}${where ? `\n\n${where}` : ""}`);
    for (const bookmark of [...group].sort((a, b) => a.seq - b.seq)) {
      const body = [`### #${bookmark.seq}`];
      if (bookmark.excerpt.trim()) body.push(quote(bookmark.excerpt.trim()));
      if (bookmark.note.trim()) body.push(`**Note:** ${escapeMarkdown(bookmark.note.trim()).replace(/\n/g, "  \n")}`);
      parts.push(body.join("\n\n"));
    }
  }
  return `${parts.join("\n\n")}\n`;
}
