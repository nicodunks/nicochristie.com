/**
 * The stage worker: it runs the animations' frame functions, which the agent wrote, for as long as the page is open.
 * It is a Web Worker shut in like the worker that runs the agent's code, and apart from it. So an animation goes on
 * after the agent's turn ends, a frame function sees nothing of the agent's code, and stopping either worker leaves
 * the other running.
 *
 * The page asks what one animation shows at some times, and sends every animation on the page with the ask. The
 * worker makes each frame function from its source text the first time it meets that text, calls the asked one as
 * frame(t, data) for each time, and answers with one shot for each time: the poses the function held parts in, the
 * ink it drew, and the names of the animations it played. It answers with an error if the function throws.
 *
 * A frame function draws with p5, as the agent's code does, on a p5 sketch of the worker's own. Each picture starts
 * with the sketch's settings as they were at the start, and with no part.
 */
import type * as Api from "../paint/api.ts";
import { ink } from "../paint/ops.ts";
import { Given } from "../paint/read.ts";
import type { Animation } from "../paint/sheet.ts";
import { answer, expose, shut, value } from "../sandbox/lockdown.ts";
import { sketch } from "../sketch/sketch.ts";
import type { Ask, Reply, Taken } from "./stage.ts";

type Run = (t: number, data: unknown) => void;

const made = new Map<string, Run>(); // each frame function met so far, by its source text
let cast = new Map<string, Animation>(), // the animations of the ask being answered, by name
  shot: Taken = { poses: {}, ink: [], played: [] }; // what the frame function that is running has shown so far

/** Returns the frame function of an animation. Throws if its source text is not a function. */
function frame(a: Animation): Run {
  let run = made.get(a.frame);
  if (run) return run;
  try {
    run = value(a.frame) as Run;
  } catch (e) {
    throw new Error(`frame must be written as an arrow function, (t, data) => { ... }: ${String(e)}`);
  }
  if (typeof run !== "function") throw new Error("frame must be a function, (t, data) => { ... }");
  made.set(a.frame, run);
  return run;
}

/** Returns the ink op `fn` as a frame function makes it: its ink goes in the shot, above the page's. */
const draws = (fn: "draw" | "write") => (given: unknown) => {
  const id = -1 - shot.ink.length; // below every id on the page
  shot.ink.push(...ink(fn, given, id));
  return id;
};

/** Returns a function that only the agent's code may call, not a frame function. */
const notInFrame = (name: string) => (): never => {
  throw new Error(`${name}: call it in your code, not in a frame function`);
};

const drawing = sketch({
  draw: draws("draw"),
  write: draws("write"),
  background: notInFrame("background"),
  view: () => {
    throw new Error("width and height are the person's view, which a frame function cannot see: pass them in data");
  },
});
shut();

// The contract as a frame function sees it: p5 draws ink for one picture, and pose and play pose parts and play
// animations.
Object.assign(self, drawing.p5);
expose(drawing.own, {
  pose: (part, how) => {
    const name = new Given("pose", { part }).part()!;
    (shot.poses[name] ??= []).push(new Given("pose", how).pose());
  },
  play: (name, t) => {
    const a = cast.get(name);
    if (!a) throw new Error(`play: there is no animation called "${name}"`);
    shot.played.push(name);
    if (t >= 0 && (a.seconds === undefined || t <= a.seconds)) drawing.apart(() => frame(a)(t, a.data));
  },
} satisfies Pick<typeof Api, "pose" | "play">);

/** Returns what animation `a` shows t seconds after its start. Throws an Error that says when and why it failed. */
function shoot(a: Animation, t: number): Taken {
  const run = frame(a);
  shot = { poses: {}, ink: [], played: [] };
  try {
    drawing.apart(() => run(t, a.data));
  } catch (e) {
    const sees = "frame sees only t, data and what it declares inside itself, so pass the value in data";
    const why = e instanceof ReferenceError ? `${e.message}: ${sees}` : e instanceof Error ? e.message : String(e);
    throw new Error(`at t = ${t}, frame stopped with ${why}`);
  }
  return shot;
}

self.onmessage = ({ data }: MessageEvent<Ask>) => {
  cast = new Map(data.animations.map((a) => [a.name, a]));
  let reply: Reply;
  try {
    reply = { shots: data.times.map((t) => shoot(cast.get(data.name)!, t)) };
  } catch (e) {
    reply = { error: e instanceof Error ? e.message : String(e) };
  }
  answer(reply);
};
