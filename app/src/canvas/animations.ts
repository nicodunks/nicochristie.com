/**
 * The animations as the person sees them: their stickers, and the loop that shows them moving. The sheet holds each
 * animation, and the stage worker runs its frame function. The animations share one clock (see the story's own module
 * for what each shows when), which starts when the drawing opens and starts again whenever the agent makes an
 * animation. While any animation runs, the loop asks the worker before each picture what every running animation shows
 * at the clock's time, joins the answers into one shot, and has the sheet drawn with that shot.
 *
 * Each animation's sticker sits on the page at the top right of the parts it moves, below any sticker already there,
 * and moves with the page as the person scrolls and zooms. Tapping a sticker stops its animation, and its parts go back
 * to where they were drawn; tapping it again lets it run on the shared clock again. Dragging a sticker puts it
 * somewhere else on the page, as one step for Undo. Tapping it with the eraser takes the animation off the page.
 */
import type { Point } from "../paint/api.ts";
import type { Done } from "../paint/ops.ts";
import type { Shot } from "../paint/pose.ts";
import type { Animation } from "../paint/sheet.ts";
import { start as begins, length, timesAt } from "../paint/story.ts";
import { Stage } from "../stage/stage.ts";
import { did, watch } from "./history.ts";
import { hooks } from "./hooks.ts";
import { chosen } from "./pen.ts";
import { present } from "./present.ts";
import { session, sheet } from "./state.ts";
import { inView, nextFrame, painted, redraw, view } from "./view.ts";

const DRAG = 6; // how far, in pixels, a press on a sticker moves before it drags the sticker instead of tapping it
const TRIAL = [0, 1, 5]; // the seconds at which a new animation is tried
const APART = 44; // how far apart two stickers are put, in page units

const strip = document.getElementById("stickers")!;
const stage = new Stage();

let since = performance.now(); // when the shared clock was at 0, in the page's milliseconds
const stopped = new Set<string>(), // the animations the person stopped
  waiting = new Set<string>(), // the animations just made, which start once the ink before them has appeared
  failed = new Map<string, string>(); // why each animation whose frame function failed does not run, by name
let ticking = false; // the loop that asks the worker for each picture is going

/** Returns the animations that run: those not stopped, waiting or failed. */
const running = () =>
  [...sheet.animations.values()].filter((a) => !stopped.has(a.name) && !waiting.has(a.name) && !failed.has(a.name));

/**
 * Tries an animation that the agent's code just put on the sheet. The sheet first gets back what it had under that
 * name, so that nothing shows an animation that was not tried. Then the stage worker runs the new frame function at
 * each time of TRIAL. If the function fails, or poses a part that no ink is in, this resolves with what is wrong,
 * for the agent. Otherwise the animation goes on the sheet with its sticker, and waits to start.
 */
export async function tried({
  animation: a,
  replaced,
}: Extract<Done, { did: "animated" }>): Promise<string | undefined> {
  if (replaced) sheet.animations.set(a.name, replaced);
  else sheet.animations.delete(a.name);
  const reply = await stage.shots(
    a,
    TRIAL.map((t) => Math.min(t, a.seconds ?? t)),
  );
  if ("error" in reply) return `animate: ${reply.error}. The animation was not made.`;
  const parts = [...new Set(reply.shots.flatMap((s) => Object.keys(s.poses)))],
    empty = parts.filter((part) => !sheet.pick([part]).length);
  if (empty.length)
    return `animate: no ink is in the part ${empty.map((p) => `"${p}"`).join(" or ")}. Give ink its part as you draw it, or with setPart(), before posing it. The animation was not made.`;
  sheet.animations.set(a.name, { ...a, place: replaced?.place ?? place(parts) });
  stopped.delete(a.name);
  failed.delete(a.name);
  waiting.add(a.name);
  sync();
  return undefined;
}

// Returns where a new sticker goes: the top right corner of the box around the parts its animation poses, or near the
// top right of what the person sees if it poses none, and then down until it is clear of the other stickers.
function place(parts: string[]): Point {
  const ink = sheet.pick(parts),
    seen = inView(),
    box = ink.length ? sheet.around(ink) : undefined;
  let at = (box ? [box.x + box.width, box.y] : [seen.x + seen.width - 2 * APART, seen.y + 2 * APART]).map(
    Math.round,
  ) as Point;
  const taken = [...sheet.animations.values()].flatMap((a) => (a.place ? [a.place] : []));
  while (taken.some(([x, y]) => Math.hypot(x - at[0], y - at[1]) < APART)) at = [at[0], at[1] + APART];
  return at;
}

/** Starts an animation the agent just made, once the ink before it has appeared, with the shared clock from 0. */
export function start(name: string): void {
  waiting.delete(name);
  since = performance.now();
  sync();
}

/** Starts every animation of a drawing just opened, with the shared clock from 0. */
export function startAll(): void {
  for (const set of [stopped, waiting, failed]) set.clear();
  since = performance.now();
  sync();
}

/** Stops every animation, so that every part shows where it was drawn, as the Select tool needs to move it there. */
export function rest(): void {
  for (const name of sheet.animations.keys()) stopped.add(name);
  sync();
}

/** Makes the stickers and the loop agree with the animations on the sheet, after anything changed them. */
export function sync(): void {
  for (const set of [stopped, waiting, failed])
    for (const name of set.keys()) if (!sheet.animations.has(name)) set.delete(name);
  const on = new Set(running().map((a) => a.name));
  strip.replaceChildren(...[...sheet.animations.values()].map((a) => sticker(a, on.has(a.name))));
  placed();
  if (on.size && !ticking) void tick();
}

// Returns the sticker of animation `a`, lit if it runs.
function sticker(a: Animation, on: boolean): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "sticker";
  b.classList.toggle("on", on);
  b.classList.toggle("off", failed.has(a.name));
  b.dataset.name = a.name;
  b.textContent = a.sticker;
  b.title = a.name;
  b.addEventListener("pointerdown", (e) => press(e, b, a.name));
  b.addEventListener("click", (e) => e.detail === 0 && tapped(a.name)); // a press of Enter or Space
  return b;
}

// Puts each sticker over its place on the page, in the window's pixels.
function placed(): void {
  for (const b of strip.querySelectorAll<HTMLElement>(".sticker")) {
    const at = sheet.animations.get(b.dataset.name!)?.place;
    if (!at || b.classList.contains("dragged")) continue;
    b.style.left = `${(at[0] - view.left) * view.scale}px`;
    b.style.top = `${(at[1] - view.above) * view.scale}px`;
  }
}
painted(placed);

// The person pressed the sticker of the animation called `name`. A press that moves less than DRAG is a tap. One that
// moves further drags the sticker, and where it is let go is its new place on the page.
function press(down: PointerEvent, b: HTMLElement, name: string): void {
  b.setPointerCapture(down.pointerId);
  let dx = 0,
    dy = 0,
    moved = false;
  const move = (e: PointerEvent) => {
    [dx, dy] = [e.clientX - down.clientX, e.clientY - down.clientY];
    if (!moved && Math.hypot(dx, dy) < DRAG) return;
    moved = true;
    b.classList.add("dragged");
    b.style.translate = `${dx}px ${dy}px`;
  };
  const up = (e: PointerEvent) => {
    b.removeEventListener("pointermove", move);
    b.removeEventListener("pointerup", up);
    b.removeEventListener("pointercancel", up);
    if (!moved) return e.type === "pointerup" ? tapped(name) : undefined;
    const a = sheet.animations.get(name);
    if (!a?.place || session.busy || e.type !== "pointerup") return sync();
    const to: Point = [Math.round(a.place[0] + dx / view.scale), Math.round(a.place[1] + dy / view.scale)];
    hooks.track("sticker_moved", { name });
    did(`moved the sticker of the animation "${name}" to (${to[0]}, ${to[1]})`, () =>
      sheet.animations.set(name, { ...a, place: to }),
    );
  };
  b.addEventListener("pointermove", move);
  b.addEventListener("pointerup", up);
  b.addEventListener("pointercancel", up);
}

// The person tapped the sticker of the animation called `name`. The eraser takes the animation off the page, unless
// a turn is with the agent; otherwise the tap stops the animation if it runs, and lets it run again if it does not.
function tapped(name: string): void {
  const erased = chosen.tool === "eraser" && !session.busy;
  hooks.track("sticker_tapped", { name, erased });
  if (chosen.tool === "eraser") {
    if (erased) did(`took the animation "${name}" off the page`, () => sheet.animations.delete(name));
    return;
  }
  if (stopped.has(name) || failed.has(name)) {
    stopped.delete(name);
    failed.delete(name);
  } else stopped.add(name);
  sync();
}

/** Returns what the animations show when the shared clock is at T, as one shot: for a picture of the page then. */
export function shotAt(T: number): Promise<Shot> {
  return shown(T, [...sheet.animations.values()]);
}

/** Returns what the agent is told of the animations on the page: when each runs, and whether it runs. */
export function described(): string[] {
  if (!sheet.animations.size) return [];
  const span = length([...sheet.animations.values()]);
  const lines = [
    `Animations on the page: ${sheet.animations.size}${span ? `; those with seconds start again every ${span} s` : ""}:`,
  ];
  for (const a of sheet.animations.values()) {
    const when =
      a.seconds === undefined ? `from ${begins(a)} s on` : `from ${begins(a)} s to ${begins(a) + a.seconds} s`;
    const state = failed.has(a.name)
      ? `, and does not run: it failed: ${failed.get(a.name)}`
      : stopped.has(a.name)
        ? ", and the person stopped it"
        : "";
    lines.push(`"${a.name}" ${a.sticker} ${when}${state}.`);
  }
  return lines;
}

/**
 * Returns what `animations` show when the shared clock is at T, as one shot. Their poses and ink add up in the order
 * the animations start, so a later one moves a part on from where earlier ones left it. An animation whose frame
 * function fails no longer runs, and stays on the page. An animation saved before stickers had places gets its sticker
 * by the parts it moves.
 */
async function shown(T: number, animations: Animation[]): Promise<Shot> {
  const times = timesAt(animations, T),
    shot: Shot = { poses: {}, ink: [] };
  for (const a of [...animations].sort((a, b) => begins(a) - begins(b))) {
    const t = times.get(a.name);
    if (t === undefined) continue;
    const reply = await stage.shots(a, [t]); // one animation at a time, so one that fails is known
    if ("error" in reply) {
      failed.set(a.name, reply.error);
      continue;
    }
    const poses = reply.shots[0].poses;
    if (!a.place) sheet.animations.set(a.name, { ...a, place: place(Object.keys(poses)) });
    for (const [part, held] of Object.entries(poses)) (shot.poses[part] ??= []).push(...held);
    shot.ink.push(...reply.shots[0].ink);
  }
  return shot;
}

// The loop, once for each picture the browser shows while an animation runs: it asks the worker what the running
// animations show at the shared clock's time, and has the sheet drawn with that.
async function tick(): Promise<void> {
  ticking = true;
  for (let now = running(); now.length; now = running()) {
    const shot = await shown((performance.now() - since) / 1000, now);
    if (!running().length) break; // the animations were stopped while the picture was made
    present.shot = shot;
    redraw();
    await nextFrame();
  }
  present.shot = undefined;
  ticking = false;
  sync();
  redraw();
}

watch(sync);
