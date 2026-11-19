/**
 * The Select tool: the person picks things on the sheet, then moves, resizes or deletes them. It works on the agent's
 * ink, the person's ink and pictures alike.
 *
 * A press on ink picks the smallest thing it belongs to: for the agent's ink, the part the agent named it with, such as
 * the tree; for the person's, the stroke. Holding on and dragging moves it at once. Tapping what is picked again picks
 * the part around it, the tree's planet, and after the outermost the smallest again. With a mouse, the thing a press
 * would pick shows a faint outline as the pointer passes over it. A drag that starts on empty paper draws a rectangle,
 * and picks everything it touches. A press on empty paper, or Escape, lets go. While animations run, parts are not
 * where they were drawn, so a press first stops them all, and the next press picks.
 *
 * What is picked shows a dashed frame: dragging inside it moves it, the knob at its bottom right corner resizes it
 * about its top left corner and keeps its shape, and the bin by its top right corner deletes it, as Delete or Backspace
 * does. Picked ink lifts a little while it is dragged, and settles when it is let go, where it is moved for good, as
 * one step for Undo, and the agent is told. The frame hides while a turn is with the agent or an animation runs,
 * since then the ink may not be where the frame would show.
 */
import type { Box, Point } from "../paint/api.ts";
import { overlaps } from "../paint/box.ts";
import { type Matrix, after, mapper, matrix, thickness } from "../paint/pose.ts";
import { type Mark, chain, pictureCorners, under } from "../paint/sheet.ts";
import { rest } from "./animations.ts";
import { did, watch } from "./history.ts";
import { labelled } from "./icons.ts";
import { chosen } from "./pen.ts";
import { present } from "./present.ts";
import { session, sheet } from "./state.ts";
import { canvas, pageAt, painted, redraw, view } from "./view.ts";

const NEAR = 10; // how near a press must come to a line to pick it, in pixels
const STILL = 4; // how far a press may move and still be a press, not a drag, in pixels
const SMALLEST = 24; // the narrowest a thing may be resized to, in page units
const LIFT = 1.03; // how much larger picked ink shows while it is dragged
const SETTLE = 180; // how long dropped ink takes to settle, in milliseconds
const ROOM = 52; // the pixels above the frame the bin needs; with less, it goes below the frame
const calm = matchMedia("(prefers-reduced-motion: reduce)");

const frames = document.getElementById("frames")!;
const frame = element("div", "frame picked"),
  knob = element("button", "knob", "Resize"),
  bin = element("button", "bin", "Delete"),
  band = element("div", "band"),
  hover = element("div", "hover");
labelled(bin, "bin");
frame.append(knob, bin);

let picked = new Set<number>(); // the ids of the ink picked
let held = false; // whether a drag is under way, which places the frame or the rectangle itself
let fresh = false; // whether the frame shows what was just picked, which it greets with a small pop

/** Returns the marks picked, as the sheet holds them now. */
const marks = (): Mark[] => sheet.marks.filter((m) => picked.has(m.id));

/** Picks the ink with these ids, and nothing else. */
export function pick(ids: number[]): void {
  picked = new Set(ids);
  fresh = true;
  redraw();
}

/** Lets go of what is picked. */
export function letGo(): void {
  if (!picked.size) return;
  picked = new Set();
  redraw();
}

// Undo, Redo and the agent's turns change the sheet, so what is picked is only what is still on it.
watch(() => {
  const ids = new Set(sheet.marks.map((m) => m.id));
  picked = new Set([...picked].filter((id) => ids.has(id)));
});

// After each redraw, puts the frame around what is picked, or takes it away while it would mislead.
painted(() => {
  if (held) return;
  const shown = marks();
  if (!shown.length || chosen.tool !== "select" || session.busy || present.shot) return void frame.remove();
  const b = sheet.around(shown);
  place(frame, b);
  bin.classList.toggle("below", (b.y - view.above) * view.scale < ROOM);
  if (!frame.isConnected) frames.append(frame);
  if (fresh && !calm.matches)
    frame.animate(
      [
        { opacity: 0, outlineOffset: "2px" },
        { opacity: 1, outlineOffset: "6px" },
      ],
      {
        duration: 160,
        easing: "ease-out",
      },
    );
  fresh = false;
});

frame.addEventListener("pointerdown", (e) => e.target === frame && drag(e, frame, "move", outward));
knob.addEventListener("pointerdown", (e) => drag(e, frame, "resize"));
bin.addEventListener("click", remove);

// With a mouse or a pen held over the sheet, outlines what a press there would pick.
canvas.addEventListener("pointermove", (e) => {
  const hit =
    e.pointerType !== "touch" && !e.buttons && chosen.tool === "select" && !session.busy && !present.shot
      ? inkAt(pageAt(e.clientX, e.clientY))
      : undefined;
  if (!hit || picked.has(hit.id)) return hover.remove();
  place(hover, sheet.around(thing(hit)));
  if (!hover.isConnected) frames.append(hover);
});
canvas.addEventListener("pointerleave", () => hover.remove());

/**
 * Starts what a press of the Select tool on the sheet does: on ink, picks its thing and drags it; on empty paper,
 * draws a rectangle that picks what it touches when let go, or lets go of everything if it did not move.
 */
export function press(down: PointerEvent): void {
  hover.remove();
  if (session.busy) return;
  if (present.shot) return rest();
  const hit = inkAt(pageAt(down.clientX, down.clientY));
  if (hit) {
    pick(thing(hit).map((m) => m.id));
    return drag(down, canvas, "move");
  }
  let moved = false;
  const move = (e: PointerEvent) => {
    moved ||= Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) > STILL;
    if (!moved) return;
    held = true;
    frame.remove();
    place(band, between(down, e));
    if (!band.isConnected) frames.append(band);
  };
  const up = (e: PointerEvent) => {
    stop();
    held = false;
    band.remove();
    if (!moved || e.type === "pointercancel") return letGo();
    const b = between(down, e);
    pick(sheet.marks.filter((m) => overlaps(sheet.box(m), b)).map((m) => m.id));
  };
  const stop = listen(canvas, move, up);
  cancel = () => up(new PointerEvent("pointercancel"));
}

let cancel = (): void => {}; // gives up the press under way

/** Gives up the press under way, as when a second finger lands to scroll. */
export function abandon(): void {
  cancel();
}

// Deletes what is picked, as one step for Undo, and tells the agent.
function remove(): void {
  const gone = marks();
  if (!gone.length || session.busy) return;
  picked = new Set();
  did(`deleted ${named(gone)}`, () => sheet.drop(gone));
}

// Delete or Backspace deletes what is picked, and Escape lets go, unless the person is typing.
document.addEventListener("keydown", (e) => {
  if (!picked.size || chosen.tool !== "select" || (e.target as Element).closest("input, textarea")) return;
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    remove();
  } else if (e.key === "Escape") letGo();
});

// Picks, at a tap on what is picked, the part around what is picked of the ink there, or the smallest again after the
// outermost.
function outward(tap: PointerEvent): void {
  const hit = inkAt(pageAt(tap.clientX, tap.clientY));
  if (hit?.part === undefined) return;
  const levels = chain(hit.part), // innermost first
    now = levels.findIndex((l) => same(sheet.marks.filter((m) => under(m.part, l))));
  pick(sheet.marks.filter((m) => under(m.part, levels[now + 1] ?? levels[0])).map((m) => m.id));
}

// Returns whether the marks are just what is picked.
function same(ms: Mark[]): boolean {
  return ms.length > 0 && ms.every((m) => picked.has(m.id)) && new Set(ms.map((m) => m.id)).size === picked.size;
}

/**
 * Drags what is picked from the press `down` on `on`: moving it, lifted a little, or resizing it about its top left
 * corner, keeping its shape. Shows it where the drag would put it, and puts it there on let go, where it settles; a
 * drag the browser cancels, as when a second finger lands, leaves it where it was. A press that does not move is a
 * tap, given to `tapped`.
 */
function drag(down: PointerEvent, on: HTMLElement, how: "move" | "resize", tapped?: (e: PointerEvent) => void): void {
  if (session.busy) return;
  down.preventDefault();
  down.stopPropagation();
  on.setPointerCapture(down.pointerId);
  const moving = marks(),
    b = sheet.around(moving),
    lift = how === "move" && !calm.matches ? LIFT : 1;
  let to: Matrix | undefined; // the map from where the ink is to where the drag would put it, once it moves
  const move = (e: PointerEvent) => {
    const dx = (e.clientX - down.clientX) / view.scale,
      dy = (e.clientY - down.clientY) / view.scale;
    if (!to && Math.hypot(dx, dy) * view.scale < STILL) return;
    held = true;
    // the knob follows the pointer along the box's diagonal, so that the ink keeps its shape
    const k = Math.max(
      SMALLEST / Math.max(b.width, 1),
      (b.width * (b.width + dx) + b.height * (b.height + dy)) / (b.width ** 2 + b.height ** 2 || 1),
    );
    const there =
      how === "move" ? { ...b, x: b.x + dx, y: b.y + dy } : { ...b, width: b.width * k, height: b.height * k };
    to = how === "move" ? matrix({ dx, dy }, b) : matrix({ scale: k, origin: [b.x, b.y] }, b);
    const shows = after(matrix({ scale: lift }, there), to);
    for (const m of moving) present.moving.set(m, shows);
    place(frame, there);
    redraw();
  };
  const up = (e: PointerEvent) => {
    stop();
    held = false;
    if (!to || e.type === "pointercancel") {
      for (const m of moving) present.moving.delete(m);
      return !to && e.type === "pointerup" && tapped ? tapped(e) : redraw();
    }
    const there = mapper(to),
      thick = thickness(to),
      [[x, y], [right, bottom]] = [there([b.x, b.y]), there([b.x + b.width, b.y + b.height])],
      landed = { x, y, width: right - x, height: bottom - y };
    // from here the ink shows where it lands, still lifted, so that it is never shown moved twice
    for (const m of moving) present.moving.set(m, matrix({ scale: lift }, landed));
    did(`${how === "move" ? "moved" : "resized"} ${named(moving)} to ${boxed(landed)}`, () =>
      sheet.move(moving, there, thick),
    );
    settle(moving, landed, lift);
  };
  const stop = listen(on, move, up);
  cancel = () => up(new PointerEvent("pointercancel"));
}

// Shows marks that were just put down at the box `b` shrinking from `lift` times their size to their own, easing out.
function settle(ms: Mark[], b: Box, lift: number): void {
  const began = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - began) / SETTLE),
      scale = 1 + (lift - 1) * (1 - k) ** 3;
    for (const m of ms) {
      if (k < 1) present.moving.set(m, matrix({ scale }, b));
      else present.moving.delete(m);
    }
    redraw();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Listens to a pointer's moves and its let go on `on`; returns what stops listening.
function listen(on: HTMLElement, move: (e: PointerEvent) => void, up: (e: PointerEvent) => void): () => void {
  const stop = () => {
    on.removeEventListener("pointermove", move);
    on.removeEventListener("pointerup", up);
    on.removeEventListener("pointercancel", up);
    cancel = () => {};
  };
  on.addEventListener("pointermove", move);
  on.addEventListener("pointerup", up);
  on.addEventListener("pointercancel", up);
  return stop;
}

// Returns the topmost mark whose ink is at the point of the page, or undefined.
function inkAt(p: Point): Mark | undefined {
  const near = NEAR / view.scale;
  for (let i = sheet.marks.length - 1; i >= 0; i--) {
    const m = sheet.marks[i];
    if (!overlaps(sheet.box(m), { x: p[0], y: p[1], width: 0, height: 0 }, near)) continue;
    if (m.kind === "line" && m.pieces.some((piece) => along(piece, p, (w) => w / 2 + near))) return m;
    if (m.kind === "fill" && inside(m.rings, p)) return m;
    if (m.kind === "image" && inside([pictureCorners(m.at)], p)) return m;
    if (m.kind === "brush") {
      const stroke = m.paint.kind === "stroke";
      if (stroke ? m.points.some((piece) => along(piece, p, () => m.reach + near)) : inside(m.points, p)) return m;
    }
  }
  return undefined;
}

// Returns the marks of the smallest thing a mark belongs to: the agent's part it was named with, and the parts inside
// that, or else the mark's own ink.
function thing(m: Mark): Mark[] {
  return sheet.marks.filter((n) => (m.part === undefined ? n.id === m.id : under(n.part, m.part)));
}

// Returns how the agent is told of marks: by the largest parts that are wholly among them, and the rest by ink id.
function named(ms: Mark[]): string {
  const among = new Set(ms),
    whole = (part: string) => sheet.marks.filter((m) => under(m.part, part)).every((m) => among.has(m)),
    parts = [
      ...new Set(ms.flatMap((m) => (m.part === undefined ? [] : [chain(m.part).filter(whole).at(-1) ?? m.part]))),
    ],
    ids = [...new Set(ms.filter((m) => m.part === undefined).map((m) => m.id))];
  const said = [
    ...parts.map((p) => `the part "${p}"`),
    ...(ids.length ? [`${ids.length === 1 ? "ink" : "inks"} ${ids.join(", ")}`] : []),
  ];
  return said.join(" and ");
}

// Returns whether the point is within reach(width) of a line's points, along its segments.
function along(points: readonly (readonly number[])[], [x, y]: Point, reach: (width: number) => number): boolean {
  for (let i = 0; i < points.length; i++) {
    const [ax, ay, aw = 0] = points[i],
      [bx, by] = points[Math.min(i + 1, points.length - 1)],
      [dx, dy] = [bx - ax, by - ay],
      t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
    if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= reach(aw)) return true;
  }
  return false;
}

// Returns whether the point is inside the rings, filled even-odd.
function inside(rings: readonly (readonly number[])[][], [x, y]: Point): boolean {
  let odd = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[i],
        [bx, by] = ring[j];
      if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) odd = !odd;
    }
  return odd;
}

// Returns the box of the page between where a press began and where the pointer is now.
function between(down: PointerEvent, now: PointerEvent): Box {
  const [[x0, y0], [x1, y1]] = [pageAt(down.clientX, down.clientY), pageAt(now.clientX, now.clientY)];
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

// Puts an element over a box of the sheet, in the window's pixels.
function place(el: HTMLElement, b: Box): void {
  Object.assign(el.style, {
    left: `${(b.x - view.left) * view.scale}px`,
    top: `${(b.y - view.above) * view.scale}px`,
    width: `${b.width * view.scale}px`,
    height: `${b.height * view.scale}px`,
  });
}

// Returns a new element of the class given, with a title if given.
function element<K extends "div" | "button">(tag: K, className: string, title?: string): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), { className, ...(title && { title }) });
}

// Returns a box as the agent is told one, in whole page units.
function boxed(b: Box): string {
  const [x, y, width, height] = [b.x, b.y, b.width, b.height].map(Math.round);
  return `{x: ${x}, y: ${y}, width: ${width}, height: ${height}}`;
}
