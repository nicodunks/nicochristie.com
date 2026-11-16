/**
 * Everything the page knows of p5.brush: the names of its brushes, how far its paint reaches past a mark's points,
 * and how a brush mark is painted. p5.brush lays its paint with WebGL2 on a canvas of its own: thousands of grains
 * for a pencil's stroke or hatching, and dozens of bleeding layers for a watercolour wash. So a brush mark cannot be
 * drawn on the page's 2D canvas as a line or a fill is. Instead this module paints each brush mark once into a picture
 * of the box around it, and keeps the picture until the mark's points change or a finer picture is needed.
 *
 * Paint covers what is under it as far as it is opaque, and watercolour lets more of what is under it through in some
 * colours than in others. p5.brush paints only on a canvas with paper on it, so each mark is painted twice, on white
 * and on black. Paint over paper of colour U is, in each of red, green and blue, B + (W - B) U, where W is the mark
 * painted on white and B on black: the paint itself, B, and the share of the paper that shows through it, W - B. So
 * a picture is the two images `through`, W - B, and `paint`, B, and draw() multiplies what is under the mark by the
 * first and adds the second. A flat wash then hides what is under it, a thin watercolour lets it show, and pale paint
 * shows on dark paper. On white paper and on black, a mark looks just as p5.brush paints it there.
 *
 * p5.brush needs WebGL2 and a real document. The run worker has neither, so picture() returns undefined there, as it
 * does wherever WebGL2 is missing or p5.brush fails to paint a mark, and the caller draws the mark plainly instead.
 */
import * as paint from "p5.brush/standalone";
import type { Box, Point } from "./api.ts";
import type { BrushName } from "./brushapi.ts";
import { around } from "./box.ts";
import { css } from "./constants.ts";
import { type Brush, type BrushMark, type BrushPaint, boxOf } from "./sheet.ts";

/** The names of p5.brush's brushes, as keys; the record has the compiler check that it names every BrushName and no other. */
export const BRUSHES: Record<BrushName, true> = {
  pen: true,
  rotring: true,
  "2H": true,
  HB: true,
  "2B": true,
  cpencil: true,
  marker: true,
  crayon: true,
  charcoal: true,
  pastel: true,
  spray: true,
};

/**
 * Returns how far paint laid along or inside `points` may lie past them, in page units. The widest of p5.brush's own
 * brushes is about 10 times its weight wide; a made brush reaches as p5.brush reckons it, by its scatter and its tip at
 * its greatest pressure; massing sweeps its strokes a little past its shape; and a watercolour wash bleeds out by up to
 * `bleed` of half its size.
 */
export function reach(paint: BrushPaint, points: Point[][]): number {
  const b = around(points.flat()),
    size = Math.max(b.width, b.height);
  const brushed = (brush: Brush, weight: number) =>
    typeof brush === "string"
      ? 5 * weight + 2
      : weight * (1.5 * brush.scatter + 0.75 * brush.weight * 1.3 * Math.max(...brush.pressure)) + 2;
  if (paint.kind === "wash") return paint.bleed * size * 0.5 + 4;
  if (paint.kind === "flat") return 2;
  if (paint.kind === "mass") return 0.1 * size + brushed(paint.brush, 1);
  return brushed(paint.brush, paint.weight);
}

/**
 * A brush mark painted, as two images of the page's box `box` at `k` pixels a page unit: `through`, the share of what
 * is under the mark that shows through it, white where there is no paint, and `paint`, the paint itself, black where
 * there is none.
 */
interface Picture {
  through: OffscreenCanvas;
  paint: OffscreenCanvas;
  box: Box;
  k: number;
}

const MOST = 1 << 21; // the most pixels in one picture, about 1450 by 1450
const CORNERS = 60; // the most corners a ring keeps, since p5.brush deforms each corner of a wash many times over

const pictures = new WeakMap<Point[][], Picture | null>(); // each mark's picture, or null if p5.brush failed to paint it
const added = new Map<string, string>(); // the name under which p5.brush knows each made brush, by its settings
let paper: OffscreenCanvas | null | undefined; // p5.brush's canvas, null where it cannot paint, undefined until tried

/**
 * Returns the picture of a brush mark at about `want` pixels a page unit, or more, or undefined where p5.brush cannot
 * paint it. A picture is painted at a power of two pixels a unit, at most MOST pixels, and kept for later calls.
 */
export function picture(m: BrushMark, want: number): Picture | undefined {
  const box = boxOf(m),
    fits = Math.sqrt(MOST / Math.max(1, box.width * box.height)),
    k = Math.min(fits, 2 ** Math.ceil(Math.log2(Math.max(want, 1 / 16))));
  const had = pictures.get(m.points);
  if (had === null) return undefined;
  if (had && had.k >= k * 0.99) return had;
  const surface = canvas();
  if (!surface) return undefined;
  let made: Picture | null = null;
  try {
    const [w, h] = [Math.max(1, Math.ceil(box.width * k)), Math.max(1, Math.ceil(box.height * k))],
      on = (paper: string) => painted(surface, m, box, k, w, h, paper);
    made = { ...split(on("#ffffff"), on("#000000"), w, h), box, k };
  } catch (e) {
    console.error("p5.brush could not paint a mark", e);
  }
  pictures.set(m.points, made);
  return made ?? undefined;
}

/** Returns p5.brush's canvas, made on the first call, or null where p5.brush cannot paint. */
function canvas(): OffscreenCanvas | null {
  if (paper !== undefined) return paper;
  if ("WorkerGlobalScope" in globalThis || typeof OffscreenCanvas === "undefined") return (paper = null);
  try {
    paper = new OffscreenCanvas(1, 1);
    paint.load(paper);
  } catch {
    paper = null;
  }
  return paper;
}

/** Returns the name under which p5.brush knows `brush`, adding a made brush to p5.brush the first time it is used. */
function nameOf(brush: Brush): string {
  if (typeof brush === "string") return brush;
  const key = JSON.stringify(brush);
  let name = added.get(key);
  if (!name) {
    name = `made${added.size}`;
    paint.add(name, { ...brush, pressure: [...brush.pressure] }); // p5.brush keeps and changes what it is given
    added.set(key, name);
  }
  return name;
}

/**
 * Returns the pixels of a brush mark painted on p5.brush's canvas on paper of colour `on`: the page's box `box` at `k`
 * pixels a page unit, w by h pixels.
 */
function painted(
  surface: OffscreenCanvas,
  m: BrushMark,
  box: Box,
  k: number,
  w: number,
  h: number,
  on: string,
): Uint8ClampedArray {
  [surface.width, surface.height] = [w, h];
  const color = css(m.color),
    p = m.paint;
  paint.load(surface);
  paint.clear(on);
  paint.push();
  try {
    paint.translate(-w / 2, -h / 2); // p5.brush puts (0, 0) in the middle of its canvas, as p5's WEBGL mode does
    paint.scale(k, k);
    paint.translate(-box.x, -box.y);
    paint.seed(m.seed);
    paint.noiseSeed(m.seed);
    const rings = m.points.filter((ring) => ring.length > 2).map((ring) => fewer(ring, CORNERS));
    paint.noStroke(); // p5.brush keeps its settings between marks, so each mark starts from none
    paint.noFill();
    paint.noWash();
    paint.noHatch();
    paint.noMass();
    if (p.kind === "stroke") {
      paint.set(nameOf(p.brush), color, p.weight);
      for (const piece of m.points) if (piece.length > 1) paint.spline(piece, 0);
    } else {
      if (p.kind === "hatch") {
        paint.hatchStyle(nameOf(p.brush), color, p.weight);
        paint.hatch(p.distance, (p.angle * Math.PI) / 180, {
          // p5.brush's standalone build takes radians
          rand: p.rand || false,
          gradient: p.gradient || false,
          continuous: p.continuous ?? false,
        });
      } else if (p.kind === "mass") {
        const { precision, strength, gradient } = p;
        paint.mass(nameOf(p.brush), color, { precision, strength, gradient, style: p.scribble ? "scribble" : "arcs" });
      } else if (p.kind === "flat") paint.wash(color, Math.round(m.opacity * 255));
      else {
        paint.fill(color, Math.round(m.opacity * 255));
        paint.fillBleed(p.bleed, p.inward ? "in" : "out");
        paint.fillTexture(p.texture, p.border ?? 0.4);
      }
      for (const ring of rings) paint.polygon(ring);
    }
  } finally {
    paint.pop();
  }
  paint.render();
  const c = new OffscreenCanvas(w, h).getContext("2d")!;
  c.drawImage(surface, 0, 0);
  return c.getImageData(0, 0, w, h).data;
}

/**
 * Returns the two w by h images of a picture from the pixels of its mark painted on white, `white`, and on black,
 * `black`: `through`, white less black, and `paint`, black.
 */
function split(
  white: Uint8ClampedArray,
  black: Uint8ClampedArray,
  w: number,
  h: number,
): { through: OffscreenCanvas; paint: OffscreenCanvas } {
  const through = new ImageData(w, h);
  for (let i = 0; i < white.length; i++) through.data[i] = i % 4 === 3 ? 255 : white[i] - black[i];
  return { through: image(through), paint: image(new ImageData(new Uint8ClampedArray(black), w, h)) };
}

/** Returns an image of the pixels. */
function image(pixels: ImageData): OffscreenCanvas {
  const out = new OffscreenCanvas(pixels.width, pixels.height);
  out.getContext("2d")!.putImageData(pixels, 0, 0);
  return out;
}

/** Returns at most `most` of a ring's points, evenly spread along it. */
function fewer(ring: Point[], most: number): Point[] {
  if (ring.length <= most) return ring;
  return Array.from({ length: most }, (_, i) => ring[Math.floor((i * ring.length) / most)]);
}
