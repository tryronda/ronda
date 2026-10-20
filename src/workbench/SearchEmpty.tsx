/** Guidance shown under "No matching messages": which filters narrow the search and how to widen it. */
export function SearchEmpty({ activeFilterCount, includeArchived, onClearFilters, onIncludeArchived }: {
  activeFilterCount: number; includeArchived: boolean; onClearFilters: () => void; onIncludeArchived: () => void;
}) {
  const summary = activeFilterCount === 0
    ? "No filters are active. Try different words or a shorter query."
    : `${activeFilterCount} ${activeFilterCount === 1 ? "filter is" : "filters are"} active and may be hiding matches.`;
  return <div className="flex flex-col items-center gap-2 text-[12px] leading-relaxed">
    <p className="m-0">{summary}</p>
    {(activeFilterCount > 0 || !includeArchived) && <div className="flex gap-3">
      {activeFilterCount > 0 && <button type="button" className="underline" onClick={onClearFilters}>Clear filters</button>}
      {!includeArchived && <button type="button" className="underline" onClick={onIncludeArchived}>Include archived</button>}
    </div>}
  </div>;
}
