/** Downloadable brand PNGs, rendered by scripts/render-brand-assets.ts into site/public. Paths are relative to the site root. */
export type BrandAssetKind = "mark" | "avatar" | "banner" | "card";

export type BrandAsset = {
  file: string;
  label: string;
  use: string;
  width: number;
  height: number;
  kind: BrandAssetKind;
  dark?: boolean;
  /** Where the plate sits on a banner: centred, or pushed right to clear a profile photo in the bottom-left. */
  align?: "center" | "end";
};

export const logoAssets: BrandAsset[] = [
  { file: "brand/ronda-mark.png", label: "Mark", use: "Transparent, for light backgrounds", width: 1024, height: 1024, kind: "mark" },
  { file: "brand/ronda-mark-reversed.png", label: "Mark reversed", use: "Transparent, for dark backgrounds", width: 1024, height: 1024, kind: "mark", dark: true },
];

export type Platform = "everywhere" | "x" | "linkedin" | "github";

export const platforms: { id: Platform; title: string; note: string }[] = [
  { id: "everywhere", title: "Everywhere", note: "Profile pictures and posts that work on X, LinkedIn, GitHub, Bluesky and Mastodon." },
  { id: "x", title: "X", note: "Also fits Bluesky and Mastodon headers, which use the same 3:1 shape." },
  { id: "linkedin", title: "LinkedIn", note: "The personal banner sits right so the profile photo does not cover the headline." },
  { id: "github", title: "GitHub", note: "Upload the social preview under the repository's Settings → General; the app logo under the GitHub App's settings, with #171717 as the badge background." },
];

export const socialAssets: (BrandAsset & { platform: Platform })[] = [
  { platform: "everywhere", file: "brand/ronda-avatar.png", label: "Profile picture", use: "Light, safe for circle crops", width: 400, height: 400, kind: "avatar" },
  { platform: "everywhere", file: "brand/ronda-avatar-dark.png", label: "Profile picture, dark", use: "Dark, safe for circle crops", width: 400, height: 400, kind: "avatar", dark: true },
  { platform: "everywhere", file: "og.png", label: "Link card", use: "Open Graph link previews", width: 1200, height: 630, kind: "card" },
  { platform: "everywhere", file: "brand/ronda-post-square.png", label: "Square post", use: "Feed posts on any network", width: 1080, height: 1080, kind: "card" },
  { platform: "x", file: "brand/ronda-x-header.png", label: "Header", use: "Profile banner", width: 1500, height: 500, kind: "banner", align: "center" },
  { platform: "x", file: "brand/ronda-x-post.png", label: "Post image", use: "Landscape image in a post, 16:9", width: 1600, height: 900, kind: "card" },
  { platform: "linkedin", file: "brand/ronda-linkedin-banner.png", label: "Personal banner", use: "Profile background", width: 1584, height: 396, kind: "banner", align: "end" },
  { platform: "linkedin", file: "brand/ronda-linkedin-cover.png", label: "Page cover", use: "Company page cover", width: 1128, height: 191, kind: "banner", align: "center" },
  { platform: "linkedin", file: "brand/ronda-linkedin-post.png", label: "Post image", use: "Landscape image in a post", width: 1200, height: 627, kind: "card" },
  { platform: "github", file: "brand/ronda-github-social-preview.png", label: "Repository social preview", use: "Shown when the repository is shared", width: 1280, height: 640, kind: "card" },
  { platform: "github", file: "brand/ronda-github-app-logo.png", label: "App logo", use: "GitHub App or OAuth app", width: 512, height: 512, kind: "avatar", dark: true },
  { platform: "github", file: "brand/ronda-github-avatar.png", label: "Organization avatar", use: "Organization or bot account", width: 500, height: 500, kind: "avatar" },
];
