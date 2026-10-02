/** Literal, case-insensitive ranges in the original text, including expanding lowercase characters. */
export function searchRanges(text: string, query: string) {
  let folded = "";
  const starts: number[] = [], ends: number[] = [];
  let offset = 0;
  for (const character of text) {
    const lower = character.toLowerCase();
    folded += lower;
    for (let i = 0; i < lower.length; i++) { starts.push(offset); ends.push(offset + character.length); }
    offset += character.length;
  }
  const ranges: { start: number; end: number }[] = [];
  for (const term of query.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    for (let at = folded.indexOf(term); at >= 0; at = folded.indexOf(term, at + 1)) {
      ranges.push({ start: starts[at], end: ends[at + term.length - 1] });
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function searchSnippet(text: string, query: string) {
  const at = searchRanges(text, query.split(/\s+/)[0])[0]?.start ?? 0;
  const before = Array.from(text.slice(0, at)).slice(-60).join("");
  return Array.from(before + text.slice(at)).slice(0, 260).join("").replaceAll("\n", " ");
}
