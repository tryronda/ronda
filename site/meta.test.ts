import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { expect, test } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const pages = [
  "./index.html",
  "./docs/index.html",
  "./changelog/index.html",
  "./intelligence/index.html",
  "./brand/index.html",
];

test.each(pages)("%s declares a twitter:image:alt", (page) => {
  expect(read(page)).toMatch(/<meta name="twitter:image:alt" content="[^"]+"/);
});

test("home page JSON-LD lists only macOS on Apple silicon", () => {
  const html = read("./index.html");
  const match = html.match(/"operatingSystem":\s*"([^"]*)"/);
  expect(match).not.toBeNull();
  const os = match![1];
  expect(os).not.toMatch(/Windows/);
  expect(os).not.toMatch(/Linux/);
  expect(os).toContain("Apple silicon");
});
