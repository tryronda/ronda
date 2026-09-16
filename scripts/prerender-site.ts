// Builds the product site, then prerenders each page (landing, changelog, docs, brand, and intelligence) into dist-site
// so search engines and link previews get the full content without running JavaScript.
import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const configFile = fileURLToPath(new URL("../vite.site.config.ts", import.meta.url));
const outDir = fileURLToPath(new URL("../dist-site", import.meta.url));
const ssrDir = fileURLToPath(new URL("../dist-site-ssr", import.meta.url));

await build({ configFile });
await build({ configFile, build: { ssr: "entry-server.tsx", outDir: ssrDir, emptyOutDir: true, copyPublicDir: false } });

try {
  const { pages } = await import(pathToFileURL(`${ssrDir}/entry-server.js`).href) as { pages: Record<string, () => string> };
  for (const [file, render] of Object.entries(pages)) {
    const pageFile = `${outDir}/${file}`;
    const html = await readFile(pageFile, "utf8");
    if (!html.includes("<!--app-html-->")) throw new Error(`dist-site/${file} is missing the <!--app-html--> placeholder`);
    await writeFile(pageFile, html.replace("<!--app-html-->", () => render()));
    console.log(`prerendered dist-site/${file}`);
  }
} finally {
  await rm(ssrDir, { recursive: true, force: true });
}
