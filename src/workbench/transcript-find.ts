import { searchRanges } from "./search-text";

export interface TranscriptMatch {
  id: string;
  seq: number;
  range: Range;
}

/** Search rendered text, including Markdown split across inline elements and code tokens. */
export function transcriptMatches(container: HTMLElement, query: string, includeThinking: boolean): TranscriptMatch[] {
  if (!query) return [];
  const matches: TranscriptMatch[] = [];
  for (const field of container.querySelectorAll<HTMLElement>("[data-transcript-field]")) {
    if (field.dataset.transcriptField === "thinking" && !includeThinking) continue;
    const article = field.closest<HTMLElement>("article[id^='message-']");
    if (!article) continue;
    const seq = Number(article.id.slice("message-".length));
    const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement?.closest("button,svg,[aria-hidden='true'],[data-streamdown='code-block-header']")
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let text = "";
    const nodes: { node: Text; start: number; end: number }[] = [];
    let previousBlock: Element | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const block = node.parentElement?.closest("p,pre,li,h1,h2,h3,h4,h5,h6,td,th,blockquote") ?? field;
      if (previousBlock && block !== previousBlock) text += "\n";
      previousBlock = block;
      nodes.push({ node: node as Text, start: text.length, end: text.length + (node.textContent?.length ?? 0) });
      text += node.textContent ?? "";
    }
    searchRanges(text, query, true).forEach(({ start, end }, occurrence) => {
      const first = nodes.find(part => part.start <= start && part.end > start);
      const last = nodes.find(part => part.start < end && part.end >= end);
      if (!first || !last) return;
      const range = document.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, end - last.start);
      matches.push({ id: `${seq}:${field.dataset.transcriptField}:${occurrence}`, seq, range });
    });
  }
  return matches;
}
