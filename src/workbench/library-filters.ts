import type { SessionMeta, SessionQuery } from "./api";

export function matchesSession(session: SessionMeta, query: SessionQuery) {
  return (!query.agent || session.agent === query.agent)
    && (!query.project_path || session.project_path === query.project_path)
    && (!query.host || session.host === query.host)
    && (!query.local_only || session.host === null)
    && (!query.model || session.model === query.model)
    && (query.updated_from_ms == null || session.updated_at >= query.updated_from_ms)
    && (query.updated_before_ms == null || session.updated_at < query.updated_before_ms)
    && (!query.starred_only || session.starred)
    && (query.include_archived || !session.archived);
}

/** Inclusive local calendar start, exclusive midnight after the selected end day. */
export function calendarRange(from: string, through: string) {
  const boundary = (value: string, nextDay: boolean) => {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose a valid date");
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    if (year < 1 || date.getFullYear() !== year || date.getMonth() !== month-1 || date.getDate() !== day)
      throw new Error("Choose a valid date");
    if (nextDay) {
      // Build the next midnight independently: DST can make this day 23 or 25 hours, or skip midnight.
      date.setFullYear(year, month - 1, day + 1);
      date.setHours(0, 0, 0, 0);
    }
    return date.getTime();
  };
  const updated_from_ms = boundary(from, false);
  const updated_before_ms = boundary(through, true);
  if (updated_from_ms != null && updated_before_ms != null && updated_from_ms >= updated_before_ms)
    throw new Error("End date must be on or after the start date");
  return {updated_from_ms, updated_before_ms};
}
