// Builds nicochristie.com's homepage from this folder into the site's root, where GitHub Pages serves it: index.html,
// with the canvas's styles and elements put in at its markers, and the page and the two workers that run the agent's
// code, bundled, into ../draw/. It also writes the paint contract, the text the agent reads, into
// src/contract/reference.json: api.ts and then brushapi.ts, each without its imports and the keywords export and
// declare, which only TypeScript needs, so each function reads as its signature. The Worker's gateway (../backend/draw/)
// sends that text in the prompt. What it builds is committed, since GitHub Pages builds nothing.
//   node build.mjs            once
//   node build.mjs --watch    again after every change to src/
// The canvas, the paint program, the workers and the contract are /draw's (off-policy-private, draw/src), copied as
// they are but for the few lines marked "This site's"; see README.md.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as esbuild from "esbuild";

const read = (path) => readFileSync(path, "utf8");
const contract = (path) =>
  read(path)
    .replace(/^import .*\n/gm, "")
    .replace(/^export (declare )?/gm, "");
const REFERENCE = "src/contract/reference.json",
  reference = JSON.stringify({ text: contract("src/paint/api.ts") + "\n" + contract("src/paint/brushapi.ts") }) + "\n";
if (!existsSync(REFERENCE) || read(REFERENCE) !== reference) writeFileSync(REFERENCE, reference);

writeFileSync(
  "../index.html",
  read("index.html")
    .replace("/* canvas.css */", () => read("src/canvas/canvas.css"))
    .replace("<!-- canvas.html -->", () => read("src/canvas/canvas.html")),
);

const shared = { outdir: "../draw", bundle: true, target: "es2022", minify: true };
const builds = [
  { ...shared, entryPoints: { app: "src/page/main.ts" }, format: "esm" },
  // classic scripts, because each worker loads the agent's code with importScripts, which a module worker does not
  // have
  { ...shared, entryPoints: { run: "src/run/worker.ts", stage: "src/stage/worker.ts" }, format: "iife" },
];
rmSync("../draw/chunks", { recursive: true, force: true }); // an older build's, which this one makes none of
if (process.argv.includes("--watch")) for (const b of builds) await (await esbuild.context(b)).watch();
else await Promise.all(builds.map((b) => esbuild.build(b)));
