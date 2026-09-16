import { renderToString } from "react-dom/server";
import { App } from "./App";
import { BrandApp } from "./brand/BrandApp";
import { ChangelogApp } from "./changelog/ChangelogApp";
import { DocsApp } from "./docs/DocsApp";
import { IntelligenceApp } from "./intelligence/IntelligenceApp";

/** Renders each page to static HTML so crawlers and link previews see its content without running JavaScript. */
export const pages = {
  "index.html": () => renderToString(<App />),
  "changelog/index.html": () => renderToString(<ChangelogApp />),
  "docs/index.html": () => renderToString(<DocsApp />),
  "brand/index.html": () => renderToString(<BrandApp />),
  "intelligence/index.html": () => renderToString(<IntelligenceApp />),
};
