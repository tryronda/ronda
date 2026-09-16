import source from "../../CHANGELOG.md?raw";

/** Tag fill for changelog groups. */
export const groupTone: Record<string, string> = {
  Added: "bg-olive text-[#171717]", Changed: "bg-sky text-[#171717]", Performance: "bg-sun text-[#171717]",
  Fixed: "bg-ember text-[#171717]", Removed: "bg-chip text-foreground", Security: "bg-rust text-white",
};

export type ChangeGroup = { kind: string; items: string[] };
export type Release = { version: string; date: string | null; groups: ChangeGroup[] };

/** Parses the headings and items used by CHANGELOG.md. */
export function parseChangelog(markdown: string = source): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let group: ChangeGroup | null = null;
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^## \[([^\]]+)\](?:\s*-\s*(\S+))?/);
    if (heading) {
      release = { version: heading[1], date: heading[2] ?? null, groups: [] };
      releases.push(release);
      group = null;
      continue;
    }
    const kind = line.match(/^### (.+)/);
    if (kind && release) { group = { kind: kind[1].trim(), items: [] }; release.groups.push(group); continue; }
    const item = line.match(/^- (.+)/);
    if (item && group) group.items.push(item[1].trim());
  }
  return releases;
}

export const releaseTitle = (release: Release) => release.version === "Unreleased" ? "Unreleased" : `v${release.version}`;

/** The release date, "in progress" for Unreleased, or null for undated releases. */
export const releaseDate = (release: Release) => release.date ?? (release.version === "Unreleased" ? "in progress" : null);

/** Stable fragment for a release, e.g. `v0-1-0` or `unreleased`. */
export const releaseAnchor = (release: Release) => releaseTitle(release).toLowerCase().replace(/[^a-z0-9]+/g, "-");
