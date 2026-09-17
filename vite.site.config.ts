import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Product site: a landing with a live preview of the app, plus changelog, docs, brand, and session intelligence pages, deployed to GitHub Pages.
// SITE_BASE defaults to the root of the custom domain (https://tryronda.cloud/).
// SITE_URL is the absolute address used for canonical links, social cards, and the sitemap.
const base = process.env.SITE_BASE ?? "/";
const siteUrl = (process.env.SITE_URL ?? `https://tryronda.cloud${base}`).replace(/\/?$/, "/");
// Google Analytics measurement id for tryronda.cloud. Public, like SITE_URL above: it ships in
// the markup of every page, so it lives here rather than in repo settings. Setting the variable
// to an empty string switches the tag off for a build.
const gaId = (process.env.GA_MEASUREMENT_ID ?? "G-3W8P5D5GYM").trim();

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

/**
 * Adds the Google Analytics tag to every page. One plugin rather than the snippet pasted into
 * five index.html files, which keeps the id and the markup in a single place.
 *
 * The site is five prerendered pages with no client-side router, so each navigation is a full
 * page load and gtag's own page_view covers it. Every download button points at github.com, so
 * GA4's enhanced measurement records those as outbound clicks without any extra code. Note it
 * does not count them as file downloads: that list covers .exe but not .dmg, .deb, or .AppImage.
 */
function analytics(): Plugin {
  return {
    name: "ronda-site-analytics",
    // Build only. The dev server would otherwise report every local page load as real traffic.
    apply: "build",
    transformIndexHtml() {
      if (!gaId) return [];
      // The id is interpolated into a script, so anything but GA's own format is rejected rather
      // than written out: a stray quote would otherwise break every page on the site.
      if (!/^G-[A-Z0-9]+$/i.test(gaId)) {
        this.warn(`GA_MEASUREMENT_ID ${JSON.stringify(gaId)} is not a G-XXXXXXXXXX id; skipping the analytics tag`);
        return [];
      }
      return [
        { tag: "script", attrs: { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${gaId}` }, injectTo: "head" as const },
        {
          tag: "script",
          children: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${gaId}');`,
          injectTo: "head" as const,
        },
      ];
    },
  };
}

/**
 * Preloads the two faces the first screen paints with. Both are only discovered after the
 * stylesheet parses, which costs the headline and body copy a round trip on a cold visit.
 */
function fontPreload(): Plugin {
  const wanted = [/^assets\/newsreader-latin-opsz-normal-.*\.woff2$/, /^assets\/afacad-latin-wght-normal-.*\.woff2$/];
  return {
    name: "ronda-site-font-preload",
    // Post, so the hashed font file names are in the bundle. The dev server has none and skips this.
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const bundle = Object.keys(ctx.bundle ?? {});
        // A build that matches nothing means @fontsource renamed the files; warn rather than quietly drop the hint.
        const files = bundle.filter(file => wanted.some(pattern => pattern.test(file)));
        if (bundle.length > 0 && files.length !== wanted.length) this.warn(`expected ${wanted.length} fonts to preload, matched ${files.length}`);
        return files.map(file => ({ tag: "link", attrs: { rel: "preload", href: `${base}${file}`, as: "font", type: "font/woff2", crossorigin: "" }, injectTo: "head" as const }));
      },
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL("./site", import.meta.url)),
  base,
  plugins: [react(), tailwindcss(), seo(), analytics(), fontPreload()],
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
