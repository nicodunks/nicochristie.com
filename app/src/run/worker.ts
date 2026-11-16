/**
 * The worker that runs the agent's code, one block at a time. It is a Web Worker shut in by the lockdown: it cannot
 * touch the page, and the page stops it if a block runs too long. The agent's code is p5, so the worker starts a p5
 * sketch whose ink becomes ops, before it shuts itself in.
 *
 * The page sends each block of the agent's code with the sheet and the agent's folder as the page has them. The
 * worker puts them in place of its own and runs the block as a script of its own, so that what one block declares at
 * its top level the blocks after it can use and can declare again. A block may wait, with await, for a search, a
 * download or a picture's pixels; the worker asks the page for the searches and downloads. Once the block is done,
 * the worker answers with the ops the block made, the files it wrote, what it printed, each picture it asked for, the
 * part the person sees, and the error that stopped it, if one did.
 */
import type { Box } from "../paint/api.ts";
import { type Op, type Peek, painter } from "../paint/ops.ts";
import { Sheet } from "../paint/sheet.ts";
import { answer, expose, run, shut } from "../sandbox/lockdown.ts";
import { sketch } from "../sketch/sketch.ts";
import { script } from "./block.ts";
import { disk, folderFunctions, seen } from "./files.ts";
import type { Answer, Ask, Need, Viewed } from "./run.ts";

const sheet = new Sheet();
let ops: Op[] = [],
  printed: string[] = [],
  peeks: Peek[] = [],
  looked: string[] = [];

// What the worker has asked the page for and not yet been given, by the number of the ask.
const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (e: Error) => void }>();
let asked = 0;

/** Returns what the page gives for a need, once the page has done it. */
function need(n: Need): Promise<unknown> {
  const id = ++asked;
  answer({ need: n, id });
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
}

/** Returns a function that says `name` is a function for an animation's frame function only. */
const onlyInFrame = (name: string) => (): never => {
  throw new Error(`${name}: call it only inside the frame function of animate`);
};

// What the agent's code reaches besides the sheet. The view is set from each message, and show moves it.
const host = {
  view: { x: 0, y: 0, width: 1, height: 1 } as Box,
  applied: (op: Op) => void ops.push(op),
  print: (...values: unknown[]) =>
    void printed.push(values.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" ")),
  look: (peek: Peek) => void peeks.push(peek),
};
const { paint, inking } = painter(sheet, host),
  drawing = sketch({ ...inking, view: paint.view });
shut();
// The agent's code may take p5's names for its own values, as p5's global mode lets a sketch, but not the page's own
// names. The page's erase, copy and print take the place of p5's.
Object.assign(self, drawing.p5);
expose(drawing.own, paint, folderFunctions(need), {
  // look({path}) asks to see a picture in the folder; any other look asks for a picture of the page
  look: (o?: { path?: unknown }) =>
    o && typeof o === "object" && "path" in o ? void looked.push(String(o.path)) : paint.look(o as object),
  pose: onlyInFrame("pose"),
  play: onlyInFrame("play"),
});

/** Returns what block `n` of a call, which threw `e` after making `made`, is told. */
function failure(n: number, e: unknown, made: Op[]): string {
  const error = `block ${n} stopped with ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}.`;
  if (!made.length) return error;
  // the calls before the error have changed the page, so the agent must not make them again
  const ran = made.map((o) => (o.fn === "draw" ? (o.given as { made: string }).made : o.fn)).join(", ");
  return `${error} Before the error, these calls in the block ran, and what they made is on the page: ${ran}. Make only what is still missing.`;
}

/** Runs block `n` of a call, and returns the error that stopped it, if one did. */
async function block(code: string, n: number): Promise<string | undefined> {
  drawing.restart();
  try {
    run(script(code));
    const scope = self as unknown as { __block?: Promise<void>; setup?: unknown; draw?: unknown };
    const done = scope.__block;
    delete scope.__block;
    await done;
    // a sketch's habit, which would draw nothing here
    if (scope.setup !== undefined || scope.draw !== undefined) {
      scope.setup = scope.draw = undefined;
      throw new Error("there is no setup() or draw() here: call the drawing functions at the top level");
    }
  } catch (e) {
    return failure(n, e, ops);
  }
}

/** Returns the pictures in the folder that the block asked to see, and an error for each one that is not a picture. */
async function views(): Promise<{ views: Viewed[]; errors: string[] }> {
  const views: Viewed[] = [],
    errors: string[] = [];
  for (const path of looked)
    await seen(path).then(
      (jpeg) => views.push({ path, jpeg }),
      (e: unknown) => errors.push(`look: ${e instanceof Error ? e.message : String(e)}`),
    );
  return { views, errors };
}

self.onmessage = async ({ data }: MessageEvent<Ask | { got: number; value?: unknown; error?: string }>) => {
  if ("got" in data) {
    const w = waiting.get(data.got);
    waiting.delete(data.got);
    if (data.error === undefined) w?.resolve(data.value);
    else w?.reject(new Error(data.error));
    return;
  }
  sheet.restore(data.sheet);
  host.view = data.view;
  Object.assign(disk, { folder: data.folder, wrote: {} });
  let error = await block(data.code, data.block);
  const seenFiles = await views();
  if (seenFiles.errors.length) error = [error, ...seenFiles.errors].filter(Boolean).join("\n");
  answer({
    ops,
    wrote: disk.wrote,
    printed,
    peeks,
    views: seenFiles.views,
    view: host.view,
    error,
  } satisfies Answer);
  [ops, printed, peeks, looked] = [[], [], [], []];
};
