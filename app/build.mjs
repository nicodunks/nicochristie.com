// Builds the homepage from this folder into the site's root, where GitHub Pages serves it: index.html as it is, and
// the page and the two workers that run the agent's code, bundled, into draw/. It also writes the paint contract as
// the texts the agent reads into backend/draw/reference.json: `text` from api.ts, and `brush`, which only brush mode
// shows, from brushapi.ts. Each is its file without its imports and the keywords export and declare, which only
// TypeScript needs, so each function reads as its signature. What it builds is committed, since GitHub Pages builds
// nothing.
//   node build.mjs            once
//   node build.mjs --watch    again after every change to src/
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as esbuild from "esbuild";

const contract = (path) =>
  readFileSync(path, "utf8")
    .replace(/^import .*\n/gm, "")
    .replace(/^export (declare )?/gm, "");
const REFERENCE = "../backend/draw/reference.json",
  reference = JSON.stringify({ text: contract("src/paint/api.ts"), brush: contract("src/paint/brushapi.ts") }) + "\n";
if (!existsSync(REFERENCE) || readFileSync(REFERENCE, "utf8") !== reference) writeFileSync(REFERENCE, reference);
copyFileSync("index.html", "../index.html");

const shared = { outdir: "../draw", bundle: true, target: "es2022", minify: true };
// the chunks of an earlier build have other names, so they would pile up
rmSync("../draw/chunks", { recursive: true, force: true });
const builds = [
  { ...shared, entryPoints: { app: "src/page/main.ts" }, format: "esm" },
  // classic scripts, because each worker loads the agent's code with importScripts, which a module worker does not
  // have
  { ...shared, entryPoints: { run: "src/run/worker.ts", stage: "src/stage/worker.ts" }, format: "iife" },
];
if (process.argv.includes("--watch")) for (const b of builds) await (await esbuild.context(b)).watch();
else await Promise.all(builds.map((b) => esbuild.build(b)));
