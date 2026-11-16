/**
 * The animations as the person sees them: their stickers, and the loop that shows them moving. The sheet holds each
 * animation, and the stage worker runs its frame function. While any animation runs, the loop asks the worker before
 * each picture what every running animation shows at its time, joins the answers into one shot, and has the sheet
 * drawn with that shot.
 *
 * Each animation has a sticker: a round button that lies on the sheet at a point of the page. Tapping the sticker
 * stops the animation, and tapping it again runs the animation from its start. Tapping it with the eraser takes the
 * animation off the page.
 */
import type { Point } from "../paint/api.ts";
import type { Done } from "../paint/ops.ts";
import type { Shot } from "../paint/pose.ts";
import { Stage, type Taken } from "../stage/stage.ts";
import { did, watch } from "./history.ts";
import { chosen } from "./pen.ts";
import { present } from "./present.ts";
import { session, sheet } from "./state.ts";
import { inView, nextFrame, redraw } from "./view.ts";

const APART = 44; // how far apart two stickers are put, in page units
const TRIAL = [0, 1, 5]; // the seconds at which a new animation is tried

const strip = document.getElementById("stickers")!;
const stage = new Stage();
/** Each animation that runs, by its name, with when it began in the page's milliseconds. */
const began = new Map<string, number>();
/** Why each animation that was stopped is not running, by its name. */
const stopped = new Map<string, string>();
let ticking = false; // the loop that asks the worker for each picture is going

/**
 * Tries an animation that the agent's code just put on the sheet. The sheet first gets back what it had under that
 * name, so that nothing shows an animation that was not tried. Then the stage worker runs the new frame function at
 * each time of TRIAL. If the function fails, or poses a part that no ink is in, this resolves with what is wrong,
 * for the agent. Otherwise the animation goes on the sheet with its sticker, not running yet.
 */
export async function tried({
  animation: a,
  replaced,
}: Extract<Done, { did: "animated" }>): Promise<string | undefined> {
  if (replaced) sheet.animations.set(a.name, replaced);
  else sheet.animations.delete(a.name);
  const others = [...sheet.animations.values()].filter((o) => o.name !== a.name),
    times = TRIAL.map((t) => Math.min(t, a.seconds ?? t)),
    reply = await stage.shots([...others, a], a.name, times);
  if ("error" in reply) return `animate: ${reply.error}. The animation was not made.`;
  const parts = [...new Set(reply.shots.flatMap((s) => Object.keys(s.poses)))],
    empty = parts.filter((part) => !sheet.pick([part]).length);
  if (empty.length)
    return `animate: no ink is in the part ${empty.map((p) => `"${p}"`).join(" or ")}. Give ink its part as you draw it, or with setPart(), before posing it. The animation was not made.`;
  sheet.animations.set(a.name, { ...a, at: place(parts) });
  began.delete(a.name); // it runs from its start, once the ink before it has appeared
  sync();
  return undefined;
}

/** Runs the animation called `name` from its start. */
export function start(name: string): void {
  if (!sheet.animations.has(name)) return;
  began.set(name, performance.now());
  stopped.delete(name);
  sync();
}

// Stops an animation, because of `why`: its parts go back to where they were drawn.
function stop(name: string, why: string): void {
  began.delete(name);
  stopped.set(name, why);
  sync();
}

/** Forgets which animations run and why the others stopped, for a drawing just opened: none of its animations runs. */
export function forget(): void {
  began.clear();
  stopped.clear();
  sync();
}

/** Makes the stickers and the loop agree with the animations on the sheet, after anything changed them. */
export function sync(): void {
  for (const names of [began, stopped])
    for (const name of names.keys()) if (!sheet.animations.has(name)) names.delete(name);
  strip.replaceChildren(
    ...[...sheet.animations.values()].map((a) => {
      const button = document.createElement("button"),
        [x, y] = a.at ?? [0, 0];
      button.className = began.has(a.name) ? "sticker on" : "sticker";
      button.textContent = a.sticker;
      button.title = a.name;
      [button.style.left, button.style.top] = [`${x}px`, `${y}px`];
      button.addEventListener("click", () => tapped(a.name));
      return button;
    }),
  );
  if (began.size && !ticking) void tick();
  redraw();
}

// The person tapped the sticker of the animation called `name`. The eraser takes the animation off the page, unless
// a turn is with the agent; otherwise the tap stops the animation if it runs, and runs it if it does not.
function tapped(name: string): void {
  if (chosen.tool === "eraser") {
    if (!session.busy) did(`took the animation "${name}" off the page`, () => sheet.animations.delete(name));
  } else if (began.has(name)) stop(name, "the person stopped it");
  else start(name);
}

/** Returns what every animation shows t seconds after its start, as one shot: for a picture of the page then. */
export function shotAt(t: number): Promise<Shot> {
  const lasting = [...sheet.animations.values()].filter((a) => a.seconds === undefined || t <= a.seconds);
  return shown(new Map(lasting.map((a) => [a.name, t])));
}

/** Returns what the agent is told of the animations on the page: each one, and why it is not running if it is not. */
export function described(): string[] {
  const lines = sheet.animations.size ? [`Animations on the page: ${sheet.animations.size}`] : [];
  for (const { name, sticker } of sheet.animations.values()) {
    const state = began.has(name) ? "running" : `not running: ${stopped.get(name) ?? "it is stopped"}`;
    lines.push(`"${name}" ${sticker} is ${state}.`);
  }
  return lines;
}

// Returns where a new animation's sticker goes: the top right corner of the box around the parts it poses, or near
// the top right of what the person sees if it poses none, and then down until it is clear of the other stickers.
function place(parts: string[]): Point {
  const ink = sheet.pick(parts),
    seen = inView(),
    box = ink.length ? sheet.around(ink) : undefined;
  let at: Point = box ? [box.x + box.width, box.y] : [seen.x + seen.width - 2 * APART, seen.y + 2 * APART];
  const taken = [...sheet.animations.values()].flatMap((a) => (a.at ? [a.at] : []));
  while (taken.some(([x, y]) => Math.hypot(x - at[0], y - at[1]) < APART)) at = [at[0], at[1] + APART];
  return at;
}

/**
 * Returns what the animations show, as one shot, when each animation named in `times` is that many seconds after its
 * start. Their poses and ink add up, the oldest animation's first. An animation that another of them plays is left
 * out, since it shows inside that one, on that one's clock. An animation whose frame function fails is stopped, and
 * stays on the page.
 */
async function shown(times: Map<string, number>): Promise<Shot> {
  const all = [...sheet.animations.values()],
    taken = new Map<string, Taken>();
  for (const a of all) {
    const t = times.get(a.name);
    if (t === undefined) continue;
    const reply = await stage.shots(all, a.name, [t]); // one animation at a time, so one that fails is known
    if ("shots" in reply) taken.set(a.name, reply.shots[0]);
    else stop(a.name, `it failed: ${reply.error}`);
  }
  const played = new Set([...taken.values()].flatMap((s) => s.played)),
    shot: Shot = { poses: {}, ink: [] };
  for (const [name, s] of taken) {
    if (played.has(name)) continue;
    for (const [part, poses] of Object.entries(s.poses)) (shot.poses[part] ??= []).push(...poses);
    shot.ink.push(...s.ink);
  }
  return shot;
}

// The loop, once for each picture the browser shows while an animation runs: it stops the animations whose seconds
// are over, asks the worker what the others show now, and has the sheet drawn with that.
async function tick(): Promise<void> {
  ticking = true;
  while (began.size) {
    const now = performance.now(),
      times = new Map<string, number>();
    for (const [name, since] of began) {
      const seconds = sheet.animations.get(name)?.seconds,
        t = (now - since) / 1000;
      if (seconds !== undefined && t > seconds) stop(name, `its ${seconds} seconds were over`);
      else times.set(name, t);
    }
    present.shot = await shown(times);
    redraw();
    await nextFrame();
  }
  present.shot = undefined;
  ticking = false;
  redraw();
}

watch(sync);
