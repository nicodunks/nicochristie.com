/**
 * The person's hands on the sheet. With the pen or the eraser, a pen or a mouse draws. A finger draws too until a pen
 * has been seen; after that one finger scrolls. With the hand, any pointer drags the sheet. With Select, a press picks
 * and drags, which select.ts carries out. Two fingers always scroll,
 * and zoom as they move apart or together. The wheel, and a pinch on a trackpad, zoom about the pointer. The zoom at
 * the top right is a magnifier, and tapping it opens a slider that zooms; Ctrl or Cmd with + or - zooms
 * in or out, and Ctrl or Cmd with 0 goes back to the zoom the page opened at. Dragging the thumb of the bar on the
 * right edge scrolls down from the top of the sheet, and the thumb of the bar on the bottom edge scrolls across from
 * the left of the sheet. Each bar reaches the farthest ink, or one view past where the person is if that is farther.
 * While the agent's turn lasts, the person can scroll and zoom but not draw.
 *
 * A stroke of the pen swells and thins as a real pen's line does. A pen that feels pressure, such as an Apple Pencil,
 * sets the width at each point from how hard it presses. A mouse or a finger feels none, so its line is wider where it
 * moves slowly and thinner where it moves fast. The line also follows the pointer a few milliseconds behind, which
 * smooths out the shake of a hand.
 */
import type { XY } from "../paint/box.ts";
import { COLORS, css } from "../paint/constants.ts";
import type { LinePoint } from "../paint/sheet.ts";
import { did } from "./history.ts";
import { chosen } from "./pen.ts";
import { session, sheet } from "./state.ts";
import { abandon, press } from "./select.ts";
import { ready } from "./tools.ts";
import { hooks } from "./hooks.ts";
import {
  OPENING,
  bars,
  canvas,
  grab,
  pageAt,
  reach,
  redraw,
  scroll,
  showStroke,
  view,
  zoomAt,
  zoomOf,
} from "./view.ts";

/**
 * Where a stroke's line has reached: (x, y) in the window, which follows the pointer; the pointer's own last place in
 * the window and the time it was there, in milliseconds; and the pressure there, from 0 to 1.
 */
interface Reached {
  x: number;
  y: number;
  pointerX: number;
  pointerY: number;
  time: number;
  pressure: number;
}

/**
 * The stroke the person is making: which pointer makes it and of what kind, whether it erases, its width where the
 * pressure is 0.5, where its line has reached, and its points so far.
 */
interface Making {
  pointer: number;
  kind: string;
  erasing: boolean;
  width: number;
  reached: Reached;
  points: LinePoint[];
}

// How far behind the pointer the line follows, in milliseconds: the time in which it closes 63% of the gap. A finger
// shakes most and a pen least. Estimates, to tune by feel.
const SMOOTHING: Record<string, number> = { pen: 5, mouse: 10, touch: 15 };
const FAST = 1; // how fast a mouse or a finger moves where its line is thinnest, in window pixels a millisecond
const SETTLING = 60; // how quickly a mouse's or a finger's line widens or thins with its speed, in milliseconds
// How far the wheel zooms: the zoom is multiplied by e to the minus this times the wheel's move down, in pixels. A
// pinch on a trackpad comes as the wheel with Ctrl held, in smaller moves, so it zooms more for each pixel.
const WHEEL = 0.002,
  PINCH = 0.01;

let pen = false; // a pen has been seen, so fingers scroll the sheet and do not draw
// every pointer that holds the sheet to drag it, by pointer, in the window: each finger, and any pointer with the hand
const fingers = new Map<number, { x: number; y: number }>();
let scrolling = false; // the pointers that hold the sheet scroll it, and zoom it if there are two
let held = { x: 0, y: 0, apart: 0 }; // grip() as it was when the fingers last moved
let making: Making | null = null;

/**
 * Draws the stroke the person is making, and after it the `ahead` points the browser predicts the pointer will reach
 * next: the pen in its colour, the eraser as the paper.
 */
function show(ahead: LinePoint[] = []): void {
  if (!making) return showStroke(null);
  const look = making.erasing
    ? { color: css(sheet.paper), opacity: 1 }
    : { color: COLORS[chosen.color], opacity: chosen.opacity };
  showStroke({ ...look, points: [...making.points, ...ahead] });
}

/**
 * Returns where the line reaches once the pointer is at `e`: the line closes part of its gap to the pointer, more the
 * longer since the last place. A pen gives its own pressure; a mouse or a finger is given a pressure that eases toward
 * 1 when it is still and toward 0 at FAST or faster.
 */
function follow(was: Reached, e: PointerEvent, kind: string): Reached {
  const ms = Math.max(1, e.timeStamp - was.time),
    ease = (by: number) => 1 - Math.exp(-ms / by),
    k = ease(SMOOTHING[kind] ?? SMOOTHING.mouse),
    speed = Math.hypot(e.clientX - was.pointerX, e.clientY - was.pointerY) / ms;
  return {
    x: was.x + (e.clientX - was.x) * k,
    y: was.y + (e.clientY - was.y) * k,
    pointerX: e.clientX,
    pointerY: e.clientY,
    time: e.timeStamp,
    pressure:
      kind === "pen" ? e.pressure : was.pressure + (1 - Math.min(1, speed / FAST) - was.pressure) * ease(SETTLING),
  };
}

/**
 * Returns the point of the page where a stroke's line has reached, with the stroke's width there: the eraser's is
 * always its width, and the pen's runs from half its width with no pressure to one and a half times it at the most.
 */
function pointOf(m: Pick<Making, "erasing" | "width">, r: Reached): LinePoint {
  return [...pageAt(r.x, r.y), m.erasing ? m.width : m.width * (0.5 + r.pressure)];
}

/**
 * Returns what the agent is told of where a stroke is: the box around its points, grown by `margin` on each side, in
 * whole page units, written as the agent's functions write a Box. The agent reads a stroke's points with ink().
 */
function boxed(points: XY[], margin = 0): string {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const x = Math.round(Math.min(...xs) - margin),
    y = Math.round(Math.min(...ys) - margin);
  const width = Math.max(1, Math.round(Math.max(...xs) + margin) - x),
    height = Math.max(1, Math.round(Math.max(...ys) + margin) - y);
  return `{x: ${x}, y: ${y}, width: ${width}, height: ${height}}`;
}

// Where the fingers are: the middle of them in the window, and how far apart two of them are, or 0 for one finger.
function grip() {
  const f = [...fingers.values()];
  return {
    x: f.reduce((s, p) => s + p.x, 0) / f.length,
    y: f.reduce((s, p) => s + p.y, 0) / f.length,
    apart: f.length > 1 ? Math.hypot(f[0].x - f[1].x, f[0].y - f[1].y) : 0,
  };
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === "pen") {
    pen = true;
    scrolling = false;
    fingers.clear();
  }
  const hand = chosen.tool === "hand";
  if (e.pointerType === "touch" || hand) {
    if (making?.kind === "pen") return; // a hand laid on the sheet while the pen writes does nothing
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (hand || pen || fingers.size > 1) {
      abandon(); // a second finger scrolls, so Select gives up what the first began
      making = null;
      scrolling = true;
      canvas.classList.add("held");
      held = grip();
      show();
      return;
    }
  }
  const drawing = e.pointerType !== "mouse" || e.button === 0; // a mouse draws with its main button only
  if (chosen.tool === "select") return void (drawing && !scrolling && press(e));
  if (!making && !scrolling && !session.busy && drawing) {
    const { clientX: x, clientY: y } = e,
      erasing = chosen.tool === "eraser",
      tool = { erasing, width: erasing ? chosen.wipe : chosen.pen },
      pressure = e.pointerType === "pen" ? e.pressure : 0.5,
      reached = { x, y, pointerX: x, pointerY: y, time: e.timeStamp, pressure };
    making = { pointer: e.pointerId, kind: e.pointerType, ...tool, reached, points: [pointOf(tool, reached)] };
    show();
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (scrolling && fingers.has(e.pointerId)) {
    const was = held;
    held = grip();
    scroll((was.x - held.x) / view.scale, (was.y - held.y) / view.scale);
    if (was.apart && held.apart) zoomAt(held.x, held.y, held.apart / was.apart);
    return;
  }
  if (!making || e.pointerId !== making.pointer) return;
  const m = making,
    moves = e.getCoalescedEvents?.() ?? []; // every position since the last event, where the browser has them
  for (const c of moves.length ? moves : [e]) {
    m.reached = follow(m.reached, c, m.kind);
    m.points.push(pointOf(m, m.reached));
  }
  // where the browser predicts the pointer will be in the next few milliseconds, shown but not kept
  let ahead = m.reached;
  show((e.getPredictedEvents?.() ?? []).map((c) => pointOf(m, (ahead = follow(ahead, c, m.kind)))));
});

// Ends a pointer's hold of the sheet, or the stroke being made. A stroke of the pen goes on the sheet as a line, and a
// stroke of the eraser rubs out the ink under it.
function lift(e: PointerEvent): void {
  if (fingers.delete(e.pointerId)) {
    if (fingers.size) held = grip();
    else {
      scrolling = false;
      canvas.classList.remove("held");
      ready();
    }
  }
  if (!making || e.pointerId !== making.pointer) return;
  // the line ends where the pointer left the sheet, not behind it
  const { erasing, width, reached } = making,
    points = [...making.points, pointOf(making, { ...reached, x: reached.pointerX, y: reached.pointerY })],
    { color, opacity } = chosen;
  making = null;
  show();
  hooks.tally(erasing ? "erases" : "strokes");
  if (erasing) did(`erased within ${boxed(points, width / 2)}`, () => sheet.rub({ line: points }));
  else {
    const id = sheet.next++;
    did(`drew stroke ${id} within ${boxed(points)}`, () =>
      sheet.marks.push({
        kind: "line",
        id,
        by: "person",
        made: "pen",
        color,
        opacity,
        pieces: [points],
      }),
    );
  }
}
canvas.addEventListener("pointerup", lift);
canvas.addEventListener("pointercancel", lift);

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const down = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 40 : e.deltaY; // Firefox counts lines
    zoomAt(e.clientX, e.clientY, Math.exp(-down * (e.ctrlKey ? PINCH : WHEEL)));
  },
  { passive: false },
);
// Only the sheet zooms, never the browser's page with its buttons.
window.addEventListener("wheel", (e) => e.ctrlKey && e.preventDefault(), { passive: false });
window.addEventListener("gesturestart", (e) => e.preventDefault());
// Tapping the magnifier at the top right grows its card down to show the zoom slider, or shrinks it back; touching
// anywhere else closes it too. The slider zooms about the middle of the window, as Ctrl and + or - do.
const slider = document.getElementById("slider")!,
  zoomer = document.getElementById("zoomer") as HTMLInputElement;
document.getElementById("zoomed")!.addEventListener("click", () => (slider.hidden = !slider.hidden));
window.addEventListener("pointerdown", (e) => {
  if (!(e.target as Element).closest("#zoom")) slider.hidden = true;
});
zoomer.addEventListener("input", () =>
  zoomAt(innerWidth / 2, innerHeight / 2, zoomOf(Number(zoomer.value)) / view.zoom),
);
window.addEventListener("keydown", (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  const by = { "=": 1.25, "+": 1.25, "-": 0.8, _: 0.8, "0": OPENING / view.zoom }[e.key];
  if (by === undefined) return;
  e.preventDefault();
  zoomAt(innerWidth / 2, innerHeight / 2, by);
});

// Dragging a bar's thumb: the start of the bar is the start of the sheet along its axis, and its end is as far as
// the bar reaches. Only the thumb takes the pointer, so a stroke along the edge draws.
for (const axis of ["x", "y"] as const) {
  const bar = bars[axis],
    thumb = bar.firstElementChild as HTMLElement;
  // where a pointer or a box starts along the bar, and how long a box is along it
  const at = (p: { clientX: number; clientY: number }) => (axis === "x" ? p.clientX : p.clientY),
    start = (r: DOMRect) => (axis === "x" ? r.left : r.top),
    long = (r: DOMRect) => (axis === "x" ? r.width : r.height);
  const drag = (e: PointerEvent) => {
    if (grab.held?.axis !== axis) return;
    const r = bar.getBoundingClientRect(),
      travel = long(r) - long(thumb.getBoundingClientRect());
    const to = grab.held.reach * Math.min(1, Math.max(0, (at(e) - start(r) - grab.held.by) / (travel || 1)));
    if (axis === "x") view.left = to;
    else view.above = to;
    redraw();
  };
  const release = () => {
    grab.held = null;
    bar.classList.remove("held");
    redraw();
  };
  thumb.addEventListener("pointerdown", (e) => {
    thumb.setPointerCapture(e.pointerId);
    grab.held = { axis, by: at(e) - start(thumb.getBoundingClientRect()), reach: reach(axis) };
    bar.classList.add("held");
    drag(e);
  });
  thumb.addEventListener("pointermove", drag);
  thumb.addEventListener("pointerup", release);
  thumb.addEventListener("pointercancel", release);
}
