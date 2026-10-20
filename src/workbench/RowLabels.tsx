import type { SessionLabel } from "./api";

export const ROW_LABEL_CHIPS = 3;

/** Compact label chips for a library row; ids missing from the catalog are skipped. */
export function RowLabels({ ids, catalog }: { ids: readonly string[] | undefined; catalog: readonly Pick<SessionLabel, "id" | "name">[] }) {
  const names = (ids ?? []).flatMap(id => catalog.find(label => label.id === id)?.name ?? []);
  if (!names.length) return null;
  const shown = names.slice(0, ROW_LABEL_CHIPS), rest = names.slice(ROW_LABEL_CHIPS);
  return <div role="group" className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-[12px]" aria-label={`Labels: ${names.join(", ")}`}>
    {shown.map((name, index) => <span key={index} className="eyebrow-chip max-w-full truncate px-1.5 pt-0.5 pb-1 text-[11px]" title={name}>{name}</span>)}
    {rest.length > 0 && <span className="eyebrow-chip px-1.5 pt-0.5 pb-1 text-[11px]" title={rest.join(", ")}>+{rest.length}</span>}
  </div>;
}
