/**
 * How the agent's changes appear to the person: new ink is drawn stroke by stroke as if by hand, moved ink glides to
 * its place, and the view pans to where the agent shows. The sheet already holds each change in full. An effect only
 * writes down, picture by picture, how much of the change shows, and ends with the change showing whole.
 *
 * The effects come in blocks, one for each block of the agent's code, and play one after the other, in the order
 * show() got them. A block plays at the pace of a hand, so the person can follow it. Once the next block is ready, the
 * block that is playing hurries, just enough that it is over within HURRY seconds. Once the agent's turn is over and no
 * more blocks will come, everything still waiting hurries, just enough that it is over within LAST seconds. Stop shows
 * everything at once.
 */
import type { XY } from "../paint/box.ts";
import { WIDEST } from "../paint/constants.ts";
import type { Done } from "../paint/ops.ts";
import { IDENTITY, type Matrix, after, inverse, matrix, partway } from "../paint/pose.ts";
import type { Mark } from "../paint/sheet.ts";
import { draw, lift, rest } from "./nib.ts";
import { present } from "./present.ts";
import { session, sheet } from "./state.ts";
import { nextFrame, redraw, scroll, sight, view, zoomTo } from "./view.ts";

const HURRY = 5; // the most seconds a block still takes once the next block is ready
const LAST = 15; // the most seconds the waiting effects still take once the agent's turn is over
const SPEED = 900; // how fast a hand draws a line, in page units a second
const LONGEST = 0.6; // the most seconds a hand takes over one line: a longer line is drawn faster
const PAUSE = 0.15; // how many seconds a hand waits before a fill appears
const PAN = 0.35; // how many seconds the view takes to pan

type Moved = Extract<Done, { did: "moved" }>;

/**
 * One change waiting to be shown. `seconds` is how long it plays at the pace of a hand. begin() is called when its
 * turn comes, and then step(k) once a picture, as k, the share of the change that shows, goes from 0 to 1.
 */
export interface Effect {
  seconds: number;
  begin?: () => void;
  step: (k: number) => void;
}

const waiting: Effect[][] = []; // the blocks not yet over, each the effects in it not yet over, playing first
let played = 0; // how many of its seconds the first waiting effect has played
let over = Promise.resolve(); // resolves when the effects that wait are over
let end: number | undefined; // when every waiting effect must be over, once the agent's turn is over

/** Plays a block of effects after the blocks that wait. */
export function show(block: Effect[]): void {
  if (!block.length) return;
  waiting.push(block);
  if (waiting.length === 1) over = play();
}

/**
 * Hurries every waiting effect to be over within LAST seconds, because the agent's turn is over and no more will come.
 * Resolves when they are over.
 */
export function finish(): Promise<void> {
  end = performance.now() + LAST * 1000;
  return over;
}

// Once a picture, plays as many seconds of the playing block as the pace gives, until no block waits. The pace is how
// many seconds of effects play in a second: 1, a hand's, until the next block is ready, and from then the pace that
// plays the rest of the block by its deadline, HURRY seconds later, if that is faster. Once the turn is over, the pace
// is also at least the one that plays every waiting effect by the end.
async function play(): Promise<void> {
  let last = performance.now(),
    begun: Effect | undefined,
    deadline: number | undefined; // when the playing block must be over, once the next block is ready
  while (waiting.length) {
    await nextFrame();
    const now = performance.now(),
      block = waiting[0];
    if (waiting.length > 1) deadline ??= now + HURRY * 1000;
    const remaining = block.reduce((sum, e) => sum + e.seconds, -played), // the seconds of the block still to play
      all = waiting.reduce((sum, b) => sum + b.reduce((s, e) => s + e.seconds, 0), -played), // and of every block
      by = (seconds: number, at: number | undefined) => (at === undefined ? 1 : seconds / ((at - now) / 1000)),
      pace = Math.max(1, by(remaining, deadline), by(all, end)),
      late = [deadline, end].some((at) => at !== undefined && now >= at);
    let budget = session.hurry || late ? Infinity : (pace * (now - last)) / 1000;
    last = now;
    while (waiting.length) {
      const effect = waiting[0][0],
        take = Math.min(budget, effect.seconds - played);
      if (begun !== effect) effect.begin?.();
      begun = effect;
      played += take;
      budget -= take;
      if (played < effect.seconds) {
        effect.step(played / effect.seconds);
        break;
      }
      effect.step(1);
      waiting[0].shift();
      played = 0;
      if (waiting[0].length) continue;
      waiting.shift(); // the block is over, and the next starts at a hand's pace
      deadline = undefined;
      if (budget !== Infinity) break;
    }
    redraw();
    rest();
  }
  lift();
}

/** Returns how long the line through the points is. */
function long(p: XY[]): number {
  return p.reduce((d, q, i) => d + (i ? Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
}

/** Hides marks the agent just made, until the effect of reveal() shows each. */
export function hide(marks: Mark[]): void {
  for (const m of marks) present.drawn.set(m, 0);
}

/** Returns the effect that shows one hidden mark, after bringing it into sight: a line is drawn along its length, and a fill appears whole after a pause. */
export function reveal(m: Mark): Effect {
  const length = m.kind === "line" ? m.pieces.reduce((d, piece) => d + long(piece), 0) : 0;
  return {
    seconds: m.kind === "line" ? Math.min(LONGEST, length / SPEED) : PAUSE,
    begin: () => {
      if (!session.hurry && sheet.marks.includes(m)) sight(sheet.box(m));
    },
    step: (k) => {
      if (k === 1) return void present.drawn.delete(m);
      present.drawn.set(m, k);
      draw(m, k); // the tool in the agent's hand, at the tip of the line
    },
  };
}

/** Keeps marks the agent just moved showing where they were, until the effect of glide() plays the move. */
export function hold(move: Moved): void {
  const back = inverse(matrix(move.to, move.about));
  for (const m of move.marks) present.moving.set(m, after(present.moving.get(m) ?? IDENTITY, back));
}

/** Returns the effect that plays a move: its marks glide from where they show into the move's pose, easing in and out. */
export function glide(move: Moved): Effect {
  let from = new Map<Mark, Matrix>();
  return {
    seconds: move.seconds,
    begin: () => void (from = new Map(move.marks.map((m) => [m, present.moving.get(m) ?? IDENTITY]))),
    step: (k) => {
      const eased = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k),
        step = matrix(partway(move.to, eased), move.about);
      for (const [m, start] of from) present.moving.set(m, after(step, start));
    },
  };
}

/** Returns the effect that pans the person's view to the part of the sheet with its left edge at x, its top at y and `width` units wide. */
export function pan({ x, y, width }: { x: number; y: number; width: number }): Effect {
  let was = { ...view };
  return {
    seconds: PAN,
    begin: () => void (was = { ...view }),
    step: (k) => {
      const eased = k * (2 - k),
        zoom = WIDEST / width;
      zoomTo(was.zoom + (zoom - was.zoom) * eased);
      view.left = was.left + (x - was.left) * eased;
      view.above = was.above + (y - was.above) * eased;
      scroll(0, 0);
    },
  };
}

/** Ends every effect: each mark shows whole, where the sheet has it. */
export function settle(): void {
  end = undefined;
  present.drawn.clear();
  present.moving.clear();
  redraw();
}
