// Renders the brand PNGs listed in site/brand/assets.ts into site/public: transparent marks, and profile pictures,
// banners and post images for X, LinkedIn and GitHub, including the link card (og.png). Each image is laid out in HTML with the bundled
// Newsreader font and the pixel field's own tile layout, then captured by headless Chrome at its exact size.
// Set CHROME to the browser binary if it is not in the default macOS location.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toneAt } from "../src/components/brand/pixel-field";
import { logoAssets, socialAssets, type BrandAsset } from "../site/brand/assets";

const HEADLINE = "All your agent sessions in one place.";

// Morning --px-* tokens, plus paper, ink and sky-deep from src/index.css; the night pair for dark variants.
const px = { base: "#a9dbff", light: "#fff8f0", olive: "#a3b34f", warm: "#8c7049" };
const light = { paper: "#ffffff", ink: "#171717" }, dark = { paper: "#171717", ink: "#ededed" }, skyDeep = "#8bcfff";

const root = fileURLToPath(new URL("..", import.meta.url));
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const newsreader = `file://${join(root, "node_modules/@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2")}`;

function field(width: number, height: number, cell: number, seed: number) {
  const cols = Math.ceil(width / cell), rows = Math.ceil(height / cell);
  const rects: string[] = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const tone = toneAt(col, row, cols, rows, seed), x = col * cell, y = row * cell;
    rects.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${tone === "trail" ? px.base : px[tone]}"/>`);
    if (tone === "trail") {
      const inset = cell * 0.12, inner = cell * 0.42;
      rects.push(`<rect x="${x + inset}" y="${y + inset}" width="${cell - inset * 2}" height="${cell - inset * 2}" fill="${px.olive}"/>`);
      rects.push(`<rect x="${x + (cell - inner) / 2}" y="${y + (cell - inner) / 2}" width="${inner}" height="${inner}" fill="${px.warm}"/>`);
    }
    rects.push(`<rect x="${x + cell - 1}" y="${y}" width="1" height="${cell}" fill="${px.olive}" fill-opacity="0.7"/>`);
  }
  return `<svg class="field" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects.join("")}</svg>`;
}

/** The mark: seven ink cells, an open centre and a sky corner, with gaps at 1/16 of its size. */
function mark(size: number, ink: string) {
  const cells = [1, 1, 1, 1, 0, 1, 1, 1, 2].map(cell => `<i style="background:${cell === 0 ? "transparent" : cell === 2 ? skyDeep : ink}"></i>`).join("");
  return `<div class="mark" style="width:${size}px;height:${size}px;gap:${size / 16}px">${cells}</div>`;
}

/** Mark beside a one-line headline, the mark as tall as the capitals and sitting on the baseline (see RondaLockup). */
const lockupLine = (fontSize: number) =>
  `<div class="line" style="font-size:${fontSize}px">${mark(fontSize * 0.717, light.ink).replace('class="mark"', 'class="mark inline"')}<h1>${HEADLINE}</h1></div>`;

function body(asset: BrandAsset) {
  const { width, height } = asset;
  switch (asset.kind) {
    case "mark":
      return mark(width, asset.dark ? dark.ink : light.ink);
    case "avatar": {
      const theme = asset.dark ? dark : light;
      return `<div class="center" style="background:${theme.paper}">${mark(Math.round(width * 0.46), theme.ink)}</div>`;
    }
    case "banner": {
      // Scale the one-line lockup to the banner: about 13% of the height, capped so the line fits 72% of the width.
      const fontSize = Math.round(Math.min(height * 0.2, (width * 0.62) / 17.5));
      const pad = Math.round(fontSize * 0.7);
      const cell = Math.max(14, Math.round(height / 16));
      const place = asset.align === "end" ? `right:${Math.round(width * 0.06)}px` : `left:50%;transform:translate(-50%,-50%)`;
      return `${field(width, height, cell, 7)}<div class="plate" style="top:50%;${asset.align === "end" ? "transform:translateY(-50%);" : ""}${place};padding:${pad}px">${lockupLine(fontSize)}</div>`;
    }
    case "card": {
      // Laid out for 1200 × 630 and scaled with the width; squares get a third line and larger type.
      const square = width === height, scale = width / 1200;
      const inset = Math.round(width * 0.053);
      const fontSize = Math.round((square ? 120 : 88) * (square ? width / 1080 : scale));
      const markSize = Math.round((square ? 112 : 64) * (square ? width / 1080 : scale));
      const lines = square ? ["All your", "agent sessions", "in one place."] : ["All your agent sessions", "in one place."];
      return `${field(width, height, Math.round(26 * Math.max(1, scale)), 7)}<div class="plate card" style="inset:${inset}px;padding:${inset}px ${inset}px ${Math.round(inset * 1.12)}px">${mark(markSize, light.ink)}<h1 style="font-size:${fontSize}px">${lines.join("<br>")}</h1></div>`;
    }
  }
}

const page = (asset: BrandAsset) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Newsreader"; src: url("${newsreader}") format("woff2"); font-weight: 200 800; }
html, body { margin: 0; width: ${asset.width}px; height: ${asset.height}px; overflow: hidden; background: transparent; }
/* Headless Chrome keeps the viewport at least 500px wide, so position against the body, not the viewport. */
body { position: relative; }
.field { position: absolute; inset: 0; }
.center { position: absolute; inset: 0; display: grid; place-items: center; }
.mark { display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr); flex: none; }
.mark i { display: block; }
.plate { position: absolute; background: ${light.paper}; box-shadow: 0 1px 4px #0000001a, 0 0 0 1px #0000000d; box-sizing: border-box; }
.plate.card { display: flex; flex-direction: column; justify-content: space-between; }
h1 { margin: 0; font-family: "Newsreader", Georgia, serif; font-variation-settings: "opsz" 72; font-weight: 400;
  line-height: 1.04; letter-spacing: -0.015em; color: ${light.ink}; white-space: nowrap; }
/* Equal padding on every side; the 0.02em nudge balances the ascender of "l" against the descenders of "y", "g" and "p". */
.line { display: flex; align-items: flex-start; gap: 0.36em; position: relative; top: 0.02em; }
.line h1 { font-size: inherit; line-height: 1; }
.line .mark.inline { margin-top: 0.02em; gap: max(1px, 0.05em) !important; }
</style></head><body>${body(asset)}</body></html>`;

const dir = await mkdtemp(join(tmpdir(), "ronda-brand-"));
try {
  for (const asset of [...logoAssets, ...socialAssets]) {
    const html = join(dir, "page.html");
    await writeFile(html, page(asset));
    const output = join(root, "site/public", asset.file);
    const run = Bun.spawnSync([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
      "--default-background-color=00000000", "--allow-file-access-from-files", "--virtual-time-budget=5000",
      `--window-size=${asset.width},${asset.height}`, `--screenshot=${output}`, `file://${html}`]);
    if (run.exitCode !== 0) throw new Error(`Chrome exited with ${run.exitCode} on ${asset.file}: ${run.stderr.toString()}`);
    console.log(`wrote site/public/${asset.file} (${asset.width} × ${asset.height})`);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
