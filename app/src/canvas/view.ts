/**
 * What the person sees of the sheet: which part of it, and the two canvases that show that part. The sheet's canvas
 * holds the marks and is redrawn at most once a frame. The stroke the person is making is drawn on a canvas of its
 * own above it, so a move of the pen redraws one stroke and not the whole sheet. A bar along the right edge and one
 * along the bottom edge show where that part is on the sheet.
 */
import type { Box, Point } from "../paint/api.ts";
import { overlaps } from "../paint/box.ts";
import { draw, line, whenDecoded } from "../paint/draw.ts";
import { CLOSEST, START, WIDEST, css } from "../paint/constants.ts";
import type { LinePoint } from "../paint/sheet.ts";
import { looks, present } from "./present.ts";
import { OPEN, sheet } from "./state.ts";

const MARGIN = 40; // how far outside the view a mark may reach and still be drawn, in page units

export const canvas = document.getElementById("sheet") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const top = document.getElementById("live") as HTMLCanvasElement,
  liveCtx = top.getContext("2d")!;
/** An axis of the sheet: x runs across it and y runs down it. */
type Axis = "x" | "y";
/** The bar that scrolls each axis: along the bottom edge for x and along the right edge for y. Its child is its thumb. */
export const bars: Record<Axis, HTMLElement> = {
  x: document.getElementById("barx")!,
  y: document.getElementById("bar")!,
};
// The zoom at the top left: the zoom in percent of the zoom every drawing opens at, and
// the slider that tapping it opens, whose value is 0 at its bottom end, zoomed out fully, and 1 at its top end, zoomed in fully, with each step
// along it zooming by the same factor.
const zoomed = document.getElementById("zoomed")!,
  zoomer = document.getElementById("zoomer") as HTMLInputElement;
const MOST = WIDEST / CLOSEST; // the most zoom
/** The zoom every drawing opens at, which shows as 100%: the window shows as many page units across as it is wide. */
export const OPENING = WIDEST / OPEN;

/** The part of the sheet the person sees. */
export const view = {
  zoom: OPENING, // how far in the person has zoomed: 1 shows WIDEST units across, the furthest out
  scale: 1, // window pixels per page unit
  left: 0, // the x of the left edge of what the person sees
  above: 0, // the y of the top edge of what the person sees
  wide: 0, // how much of the sheet the person sees across, in page units
  tall: 0, // and down
};

/**
 * The drag of a bar's thumb now: which axis it scrolls, how far past the thumb's start the pointer holds it, and how
 * far the bar reached when the drag began.
 */
export const grab = { held: null as { axis: Axis; by: number; reach: number } | null };

/** A stroke the person is making: a line of a CSS colour and an opacity through points of the page. */
interface Stroke {
  color: string;
  opacity: number;
  points: LinePoint[];
}

let stroke: Stroke | null = null; // the stroke the person is making now
const after: (() => void)[] = []; // what runs after each redraw of the sheet
const asked = new Set<() => void>(); // what waits to be drawn at the next frame

// Runs `job` at the next frame, once however often it is asked for before then.
function soon(job: () => void): void {
  if (asked.has(job)) return;
  asked.add(job);
  requestAnimationFrame(() => {
    asked.delete(job);
    job();
  });
}

/** Redraws the sheet at the next frame, however often it is asked for before then. */
export function redraw(): void {
  soon(paint);
}
whenDecoded(redraw); // a picture on the sheet shows once it is decoded

/** Has `fn` called after each redraw of the sheet, to put what lies over the sheet where the sheet now shows. */
export function painted(fn: () => void): void {
  after.push(fn);
}

/** Resolves when the browser is about to paint the next frame, or after a tenth of a second in a hidden window. */
export function nextFrame(): Promise<void> {
  return new Promise((next) => {
    requestAnimationFrame(() => next());
    setTimeout(next, 100);
  });
}

// Draws the part of the sheet the person sees, with each mark as it looks now and the animations' ink above the
// marks. Puts the thumbs of the two bars where that part is on the sheet.
function paint(): void {
  const k = view.scale * devicePixelRatio,
    seen = inView(),
    look = looks();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = css(sheet.paper);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, -view.left * k, -view.above * k);
  for (const m of sheet.marks) {
    const how = look(m);
    if (how.at || overlaps(sheet.box(m), seen, MARGIN)) draw(ctx, m, how); // a moved mark may be far from its box
  }
  for (const m of present.shot?.ink ?? []) draw(ctx, m, look(m));
  drawStroke();
  for (const axis of ["x", "y"] as const) {
    const bar = bars[axis],
      thumb = bar.firstElementChild as HTMLElement,
      far = reach(axis);
    const [length, seen, at] =
      axis === "x" ? [bar.clientWidth, view.wide, view.left] : [bar.clientHeight, view.tall, view.above];
    const size = Math.max(56, (length * seen) / (far + seen));
    thumb.style[axis === "x" ? "width" : "height"] = `${size}px`;
    thumb.style[axis === "x" ? "left" : "top"] = `${((length - size) * at) / far}px`;
  }
  for (const fn of after) fn();
}

/**
 * Draws the stroke the person is making on its own canvas at the next frame, or clears that canvas there if `s` is
 * null, however often it is asked for before then.
 */
export function showStroke(s: Stroke | null): void {
  stroke = s;
  soon(drawStroke);
}

// Draws the stroke the person is making on its own canvas, or clears that canvas if there is none.
function drawStroke(): void {
  liveCtx.setTransform(1, 0, 0, 1, 0, 0);
  liveCtx.clearRect(0, 0, top.width, top.height);
  if (!stroke) return;
  const k = view.scale * devicePixelRatio;
  liveCtx.setTransform(k, 0, 0, k, -view.left * k, -view.above * k);
  liveCtx.globalAlpha = stroke.opacity;
  line(liveCtx, stroke.color, [stroke.points]);
  liveCtx.globalAlpha = 1;
}

/**
 * Returns how far the bar of an axis scrolls: to the farthest ink along that axis, or to one view past where the
 * person is if that is farther. The sheet has no end, so the bar always shows and always has further to go. While
 * its thumb is dragged, the bar stays as far as it was when the drag began.
 */
export function reach(axis: Axis): number {
  if (grab.held?.axis === axis) return grab.held.reach;
  return axis === "x"
    ? Math.max(sheet.rightmost(), view.left + view.wide)
    : Math.max(sheet.lowest(), view.above + view.tall);
}

/** Returns the point of the sheet under the window's point (px, py). */
export function pageAt(px: number, py: number): Point {
  return [view.left + px / view.scale, view.above + py / view.scale];
}

/** Moves what the person sees by (dx, dy) page units, keeping it right of the left edge and below the top. */
export function scroll(dx: number, dy: number): void {
  view.left = Math.max(0, view.left + dx);
  view.above = Math.max(0, view.above + dy);
  redraw();
}

/** Zooms by a factor, while the point of the sheet under the window's point (px, py) stays under it. */
export function zoomAt(px: number, py: number, by: number): void {
  const [x, y] = pageAt(px, py);
  zoomTo(view.zoom * by);
  view.left = x - px / view.scale;
  view.above = y - py / view.scale;
  scroll(0, 0);
}

/** Returns the zoom at a place along the zoom slider, from 0 to 1. */
export function zoomOf(at: number): number {
  return MOST ** at;
}

/**
 * Sets the zoom, within its limits: 1 shows WIDEST units across, and the most shows CLOSEST. Shows it in percent in
 * the magnifier's title and on the slider.
 */
export function zoomTo(zoom: number): void {
  view.zoom = Math.min(MOST, Math.max(1, zoom));
  zoomer.value = String(Math.log(view.zoom) / Math.log(MOST));
  zoomed.textContent = `${Math.round((100 * view.zoom) / OPENING)}%`;
  view.scale = (innerWidth / WIDEST) * view.zoom;
  view.wide = innerWidth / view.scale;
  view.tall = shown() / view.scale;
}

/** Returns how tall the page is now, in pixels: the window less what a phone's keyboard covers. */
const shown = (): number => document.body.clientHeight || innerHeight;

/** Fits the canvases to the page, when it opens and when the window or a phone's keyboard changes it. */
export function fit(): void {
  for (const c of [canvas, top])
    [c.width, c.height] = [innerWidth, shown()].map((n) => Math.round(n * devicePixelRatio));
  zoomTo(view.zoom);
  scroll(0, 0);
}

/** Where the person is on the sheet: the zoom, and the left and top edges of what they see. */
interface Place {
  zoom: number;
  left: number;
  above: number;
}
const PAD = 16; // how far the ink the person saw stays from the edges of the band it is kept in, in pixels
const GLIDE = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200; // how long the view glides, in ms
let typing: Place | null = null; // where the person was before a phone's keyboard moved the view, while it is open
let gliding = 0; // counts the glides, so that a newer one stops an older one

/**
 * Fits the canvases to the page after a phone's keyboard has changed its height, and keeps the ink the person saw in
 * sight. `was` and `now` are the bands of the page that no buttons cover, before and after, as their top and bottom in
 * pixels. The ink kept in sight is every mark that showed in the band before, whole, so that none is cut off; a mark
 * bigger than the page, such as a painted sky, counts only where it showed. When the keyboard opens and some of that
 * ink would be outside the band now, the view glides to put it in the middle of the band, zooming out only as far as it
 * must; otherwise nothing moves. When the keyboard closes, the view glides back to where it was.
 */
export function keyboard(open: boolean, was: [number, number], now: [number, number]): void {
  const saw = {
    x: view.left,
    y: view.above + was[0] / view.scale,
    width: view.wide,
    height: (was[1] - was[0]) / view.scale,
  };
  const spans = sheet.marks
    .map((m) => sheet.box(m))
    .filter((b) => overlaps(b, saw))
    .map((b) =>
      b.width > view.wide || b.height > view.tall
        ? [Math.max(b.y, saw.y), Math.min(b.y + b.height, saw.y + saw.height)]
        : [b.y, b.y + b.height],
    );
  fit();
  if (!open) {
    if (typing) glide(typing);
    typing = null;
    return;
  }
  if (typing || !spans.length) return;
  const ink = { top: Math.min(...spans.map(([t]) => t)), bottom: Math.max(...spans.map(([, b]) => b)) },
    [top, bottom] = [now[0] + PAD, now[1] - PAD];
  if ((ink.top - view.above) * view.scale >= top && (ink.bottom - view.above) * view.scale <= bottom) return;
  typing = { zoom: view.zoom, left: view.left, above: view.above };
  const zoom = view.zoom * Math.min(1, (bottom - top) / ((ink.bottom - ink.top) * view.scale)),
    scale = (view.scale * zoom) / view.zoom;
  glide({
    zoom,
    left: saw.x + saw.width / 2 - innerWidth / 2 / scale,
    above: (ink.top + ink.bottom) / 2 - (top + bottom) / 2 / scale,
  });
}

/** Moves the view to a place over GLIDE ms, easing out, with its zoom changing by the same factor each moment. */
function glide(to: Place): void {
  const from = { ...view },
    start = performance.now(),
    run = ++gliding;
  const step = (time: number): void => {
    if (run !== gliding) return;
    const t = Math.min(1, (time - start) / GLIDE),
      e = t * (2 - t);
    zoomTo(from.zoom * (to.zoom / from.zoom) ** e);
    view.left = from.left + (to.left - from.left) * e;
    view.above = from.above + (to.above - from.above) * e;
    scroll(0, 0);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Puts the middle of the window over (START, START), where every drawing opens, with room above it and to its left.
 */
export function home(): void {
  view.left = START - view.wide / 2;
  view.above = START - view.tall / 2;
  scroll(0, 0);
}

/** Returns the part of the sheet the person sees, as a box. */
export function inView(): Box {
  return { x: view.left, y: view.above, width: view.wide, height: view.tall };
}

/** Brings a box of the sheet into sight: zooms out until the box fits across the view if it does not, and scrolls to it. */
export function sight(b: Box): void {
  if (b.width > view.wide) zoomTo(WIDEST / (b.width + 120));
  if (b.x < view.left || b.x + b.width > view.left + view.wide)
    view.left = Math.max(0, b.x + (b.width - view.wide) / 2);
  if (b.y < view.above) view.above = Math.max(0, b.y - 60);
  else if (b.y + b.height > view.above + view.tall) view.above = b.y + b.height + 60 - view.tall;
  redraw();
}
