import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const triple = process.env.CARGO_BUILD_TARGET || execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const extension = process.platform === "win32" ? ".exe" : "";
const release = process.argv.includes("--release");
const args = ["build", "-p", "ronda-core", "--bins", "--target", triple];
if (release) args.push("--release");
execFileSync("cargo", args, { stdio: "inherit" });
mkdirSync("src-tauri/binaries", { recursive: true });
for (const name of ["ronda-cli", "ronda-mcp"]) {
  copyFileSync(join("target", triple, release ? "release" : "debug", name + extension),
    join("src-tauri", "binaries", `${name}-${triple}${extension}`));
}
