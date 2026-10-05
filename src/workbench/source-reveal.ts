import type { SessionMeta } from "./api";

export function canRevealSource(session: SessionMeta | null | undefined): boolean {
  return !!session
    && session.host == null
    && session.parent_key == null
    && !session.metadata_only
    && session.can_delete
    && session.source_path.length > 0;
}
