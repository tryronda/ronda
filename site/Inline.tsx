import { Fragment, type ReactNode } from "react";

/** Renders the inline Markdown used in changelog and docs copy: `code`, **bold**, and [links](url). */
export function Inline({ children }: { children: string }) {
  const parts: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  for (const match of children.matchAll(pattern)) {
    if (match.index > last) parts.push(children.slice(last, match.index));
    if (match[1]) parts.push(<code key={match.index} className="bg-chip px-1 py-px font-mono text-[0.86em]">{match[1]}</code>);
    else if (match[2]) parts.push(<strong key={match.index} className="font-medium text-foreground">{match[2]}</strong>);
    else parts.push(<a key={match.index} href={match[4]} className="underline decoration-stone underline-offset-2 hover:decoration-foreground">{match[3]}</a>);
    last = match.index + match[0].length;
  }
  if (last < children.length) parts.push(children.slice(last));
  return <>{parts.map((part, index) => <Fragment key={index}>{part}</Fragment>)}</>;
}
