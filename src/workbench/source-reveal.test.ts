import { expect, test } from "vitest";
import type { SessionMeta } from "./api";
import { canRevealSource } from "./source-reveal";

const eligible: SessionMeta = {
  key: "codex:one", native_id: "one", agent: "codex", host: null, parent_key: null,
  title: "Synthetic", project_path: null, source_path: "/enabled/session.jsonl",
  created_at: 1, updated_at: 1, model: null, source: "cli", tokens: null,
  archived: false, metadata_only: false, can_delete: true, starred: false, pinned: false,
};

test("source reveal UI eligibility rejects remote, child, metadata-only, and non-file-backed rows", () => {
  expect(canRevealSource(eligible)).toBe(true);
  expect(canRevealSource({ ...eligible, host: "remote" })).toBe(false);
  expect(canRevealSource({ ...eligible, host: "" })).toBe(false);
  expect(canRevealSource({ ...eligible, parent_key: "parent" })).toBe(false);
  expect(canRevealSource({ ...eligible, parent_key: "" })).toBe(false);
  expect(canRevealSource({ ...eligible, metadata_only: true })).toBe(false);
  expect(canRevealSource({ ...eligible, can_delete: false })).toBe(false);
  expect(canRevealSource({ ...eligible, source_path: "" })).toBe(false);
  expect(canRevealSource(null)).toBe(false);
});
