import type { SessionMeta } from "./api";

export type FlagPair = { starred: boolean; pinned: boolean };
export type BulkAction = "star" | "unstar" | "pin" | "unpin";
/** Previous star/pin values per session, kept in memory for one level of undo. */
export type BulkUndo = { label: string; previous: [string, boolean, boolean][] };

/** Keys between two rows, inclusive, in list order. Falls back to just the target when the anchor is not loaded. */
export function rangeKeys(order: string[], anchor: string | null, target: string): string[] {
  const to = order.indexOf(target);
  if (to < 0) return [];
  const from = anchor === null ? -1 : order.indexOf(anchor);
  if (from < 0) return [target];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** Change only the flag named by the action; the opposite flag keeps its current value. */
export function nextFlags(action: BulkAction, current: FlagPair): FlagPair {
  if (action === "star") return { ...current, starred: true };
  if (action === "unstar") return { ...current, starred: false };
  if (action === "pin") return { ...current, pinned: true };
  return { ...current, pinned: false };
}

export const bulkMessages: Record<BulkAction, string> = {
  star: "Starred", unstar: "Unstarred", pin: "Pinned", unpin: "Unpinned",
};

export const sessionCount = (count: number) => `${count} session${count === 1 ? "" : "s"}`;

export function BulkTriageBar({ selected, status, busy, canUndo, onAction, onUndo, onClear }: {
  selected: number; status: string; busy: boolean; canUndo: boolean;
  onAction: (action: BulkAction) => void; onUndo: () => void; onClear: () => void;
}) {
  const none = selected === 0;
  const button = "bg-chip px-2 py-1 text-[12px] disabled:opacity-50";
  const shown = !none || canUndo;
  // The live region stays mounted so the result is announced even when the bar first appears with it.
  return <div className={shown || status ? "flex-none border-b border-border px-3 py-2 text-[13px]" : "sr-only"}>
    {shown && <div role="toolbar" aria-label="Bulk session actions" className="flex flex-wrap items-center gap-1.5">
      <strong className="mr-1 font-normal">{selected} selected</strong>
      {(["star", "unstar", "pin", "unpin"] as BulkAction[]).map(action =>
        <button key={action} type="button" className={button} disabled={none || busy} onClick={() => onAction(action)}>
          {action[0].toUpperCase() + action.slice(1)}</button>)}
      <button type="button" className={button} disabled={!canUndo || busy} onClick={onUndo}>Undo</button>
      <button type="button" className={button} disabled={none} onClick={onClear}>Clear selection</button>
    </div>}
    <p role="status" aria-live="polite" className="mt-1 min-h-4 text-[12px] text-muted-foreground">{status}</p>
  </div>;
}

export const flagsOf = (session: SessionMeta): FlagPair => ({ starred: !!session.starred, pinned: !!session.pinned });
