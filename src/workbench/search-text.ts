/** Splits a query into terms; each is a word list, and a quoted span is one phrase. Stray quotes are dropped. */
function queryTerms(query: string) {
  const terms: string[][] = [];
  for (const [, quoted, word] of query.matchAll(/"([^"]*)"|(\S+)/g)) {
    const words = (quoted ?? word.replaceAll('"', "")).toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) terms.push(words);
  }
  return terms;
}

/** Literal, case-insensitive ranges in the original text, including expanding lowercase characters. */
export function searchRanges(text: string, query: string, literal = false) {
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
  if (literal) {
    const term = query.toLowerCase();
    if (term) for (let at = folded.indexOf(term); at >= 0; at = folded.indexOf(term, at + 1)) {
      ranges.push({ start: starts[at], end: ends[at + term.length - 1] });
    }
  } else for (const words of queryTerms(query)) {
    const pattern = new RegExp(`(?=(${words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")}))`, "g");
    for (const match of folded.matchAll(pattern)) {
      ranges.push({ start: starts[match.index], end: ends[match.index + match[1].length - 1] });
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  if (literal) return ranges;
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function searchSnippet(text: string, query: string) {
  const first = queryTerms(query)[0];
  const at = (first ? searchRanges(text, `"${first.join(" ")}"`)[0]?.start : undefined) ?? 0;
  const before = Array.from(text.slice(0, at)).slice(-60).join("");
  return Array.from(before + text.slice(at)).slice(0, 260).join("").replaceAll("\n", " ");
}
