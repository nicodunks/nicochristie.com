/**
 * The model's environment, run client side on the canvas. observe() gives the model what the person did and a picture
 * of the page; wrote(), finish() and answer() run the model's code on the sheet and return what it printed and saw.
 */
import { type Op, apply } from "../paint/ops.ts";
import { type Ran, Run, type RunInput } from "../run/run.ts";
import { described, shotAt, start, sync, tried } from "./animations.ts";
import { type Effect, glide, hide, hold, pan, reveal, show } from "./effects.ts";
import { done } from "./history.ts";
import { hooks } from "./hooks.ts";
import { type Picture, picture } from "./picture.ts";
import { folder, sheet } from "./state.ts";
import { inView, redraw } from "./view.ts";

/** An observation: a picture of what the person sees, the words for the model, and each thing the person did. */
interface Observation {
  seen: Picture;
  words: string;
  acts: string[];
}

/** A piece of an answer: a base64 JPEG, or a caption. */
/**
 * While `view` is true, the model's code cannot move what the person sees: its calls of show() change nothing on the
 * screen. nicochristie.com sets it for the turn that greets a visitor, who did not ask to be moved. (This site's one
 * change to this file.)
 */
export const still = { view: false };

export type Block = { type: "image"; jpeg: string } | { type: "text"; text: string };

/** The answer to one call of run: the lines it printed, the pictures it asked for, and its error. */
export interface Answer {
  lines: string[];
  pictures: Block[];
  error?: string;
}

let run: Run | undefined; // the run worker, started at the first call after the last stop()

/** Returns the lines numbered from 1. */
const numbered = (lines: string[]) => lines.map((line, i) => `${i + 1}. ${line}`);

/** Returns what the person did and said since the model was last told, with a picture of what they see. */
export async function observe(said: string[] = []): Promise<Observation> {
  const acts = done(),
    seen = await picture(inView()),
    low = sheet.lowest(),
    moving = described();
  const words = [
    `The picture shows the page from x = ${seen.left} to x = ${seen.right} and from y = ${seen.top} to y = ${seen.bottom}.`,
    low ? `The lowest ink on the page is at y = ${Math.round(low)}.` : "The page is blank.",
    "",
    ...(said.length ? ["The person said:", ...numbered(said), ""] : []),
    `What the person did on the page since your last turn${acts.length ? ", in order:" : ": nothing."}`,
    ...numbered(acts),
    ...(moving.length ? ["", ...moving] : []),
  ].join("\n");
  return { seen, words, acts };
}

/** Applies a block's ops to the sheet and queues their effects; resolves with the first op's error, if any. */
async function applied(ops: Op[]): Promise<string | undefined> {
  let wrong: string | undefined;
  const block: Effect[] = []; // the block's effects, which play as one block
  for (const op of ops) {
    try {
      const done = apply(sheet, op);
      if (done.did === "drew") {
        hooks.inked();
        hide(done.marks);
        for (const m of done.marks) block.push(reveal(m));
      } else if (done.did === "moved") {
        hold(done);
        block.push(glide(done));
      } else if (done.did === "showed") {
        if (!still.view) block.push(pan(done.view));
      }
      else if (done.did === "animated") {
        const bad = await tried(done);
        if (bad) wrong ??= bad;
        else block.push({ seconds: 0, step: () => start(done.animation.name) });
      }
    } catch (e) {
      wrong ??= e instanceof Error ? e.message : String(e);
    }
  }
  show(block);
  sync();
  redraw();
  return wrong;
}

/** Returns the run worker, starting one if none is running. */
function current(): Run {
  return (run ??= new Run(
    () => sheet.snapshot(),
    folder,
    inView(),
    applied,
    (need) => hooks.serve(need),
  ));
}

/** Runs each block of call `id` that the model has finished writing so far. */
export function wrote(id: string, input: RunInput): void {
  current().wrote(id, input);
}

/** Runs the rest of call `id`, and resolves with what it gave back. */
export function finish(id: string, input: RunInput): Promise<Ran> {
  return current().finish(id, input);
}

/** Returns the answer for the model to a finished call, taking the pictures it asked for now. */
export async function answer(r: Ran): Promise<Answer> {
  const pictures: Block[] = [];
  for (const peek of r.peeks) {
    const p = await picture(peek, peek.t === undefined ? undefined : await shotAt(peek.t)),
      when = peek.t === undefined ? "" : `, with the animations ${peek.t} seconds after they all start`;
    pictures.push(
      { type: "image", jpeg: p.picture },
      { type: "text", text: `The page from x = ${p.left} to ${p.right}, y = ${p.top} to ${p.bottom}${when}.` },
    );
  }
  for (const v of r.views)
    pictures.push({ type: "image", jpeg: v.jpeg }, { type: "text", text: `The file ${v.path}.` });
  return { lines: [...r.printed, ...(r.error ? [`Error: ${r.error}`] : [])], pictures, error: r.error };
}

/** Stops the run worker; what the model's code declared is gone, and the next call starts a fresh one. */
export function stop(why?: string): void {
  run?.stop(why);
  run = undefined;
}
