import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Product site: a landing with a live preview of the app, plus changelog, docs, brand, and session intelligence pages, deployed to GitHub Pages.
// SITE_BASE defaults to the root of the custom domain (https://tryronda.cloud/).
// SITE_URL is the absolute address used for canonical links, social cards, and the sitemap.
const base = process.env.SITE_BASE ?? "/";
const siteUrl = (process.env.SITE_URL ?? `https://tryronda.cloud${base}`).replace(/\/?$/, "/");

/** Fills %SITE_URL% in index.html and emits robots.txt and sitemap.xml for crawlers. */
function seo(): Plugin {
  return {
    name: "ronda-site-seo",
    transformIndexHtml: html => html.replaceAll("%SITE_URL%", siteUrl),
    generateBundle() {
      if (this.environment.config.build.ssr) return;
      const lastmod = new Date().toISOString().slice(0, 10);
      this.emitFile({ type: "asset", fileName: "robots.txt", source: `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}sitemap.xml\n` });
      this.emitFile({
        type: "asset", fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${["", "intelligence/", "changelog/", "docs/", "brand/"].map(path => `  <url><loc>${siteUrl}${path}</loc><lastmod>${lastmod}</lastmod></url>\n`).join("")}</urlset>\n`,
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL("./site", import.meta.url)),
  base,
  plugins: [react(), tailwindcss(), seo()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL("./dist-site", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./site/index.html", import.meta.url)),
        changelog: fileURLToPath(new URL("./site/changelog/index.html", import.meta.url)),
        docs: fileURLToPath(new URL("./site/docs/index.html", import.meta.url)),
        brand: fileURLToPath(new URL("./site/brand/index.html", import.meta.url)),
        intelligence: fileURLToPath(new URL("./site/intelligence/index.html", import.meta.url)),
      },
    },
  },
  server: { host: "127.0.0.1", port: Number(process.env.PORT) || 1430, strictPort: true },
});
