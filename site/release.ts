import { useEffect, useState } from "react";

export const REPO = "tryronda/ronda";
export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases/latest`;

/** Release assets use version-free names (see the release job in .github/workflows/build.yml), so these links always resolve to the newest build. */
const asset = (name: string) => `${RELEASES_URL}/download/${name}`;
export const ASSETS = {
  macArm: asset("Ronda-macos-arm64.dmg"),
  checksums: asset("SHA256SUMS.txt"),
} as const;

export type MacDownloads = { version: string | null; appleSilicon: string; published: boolean };

const fallback: MacDownloads = { version: null, appleSilicon: RELEASES_URL, published: false };

/**
 * Checks for a published GitHub release. Until one exists, the download button
 * points at the releases page instead of a link that would 404.
 */
export function useMacDownloads(): MacDownloads {
  const [downloads, setDownloads] = useState(fallback);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } })
      .then(response => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then((release: { tag_name: string }) => {
        setDownloads({ version: release.tag_name.replace(/^v/, ""), appleSilicon: ASSETS.macArm, published: true });
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return downloads;
}
