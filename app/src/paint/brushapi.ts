/**
 * brush, which your code calls besides p5's and the page's own functions, paints with p5.brush's real media, which
 * leave grain, pressure and bleeding paint. As a p5 shape has a stroke and a fill, a brush shape is painted with up
 * to five media at once, each on until it is turned off, laid in this order:
 * - a flat wash of solid colour inside a closed shape, for a ground or a flat area of colour;
 * - a watercolour wash inside a closed shape, which bleeds past its edge and pools where it dries;
 * - massing inside a closed shape: layers of curved strokes of a brush, for charcoal, pastel or pencil tone;
 * - hatching across the inside of a closed shape, parallel strokes of the stroke's brush, for engraving, shading and
 *   tone; two hatchings at different angles cross-hatch;
 * - a stroke along the shape, with one of eleven brushes: a fine pen, hard to soft pencils, a coloured pencil, a
 *   marker, crayon, charcoal, pastel or spray, or a brush you make with brush.add.
 * Choose the media for the picture's style: a pen drawing with hatched shadows, a soft pencil or charcoal sketch,
 * coloured pencil, pastel or crayon, a marker comic, a watercolour with ink lines, a dark painting lit by light paint,
 * or any mix of them.
 * Paint covers what is under it as far as it is opaque. A flat wash at 255 hides what is under it, a watercolour wash
 * is thin and lets it show, and pale paint shows on a dark paper, so a picture may start from background() in any
 * colour and be painted up from dark to light or from light to dark.
 * brush's shapes follow p5's translate, rotate and scale, take part() and are one ink each, as p5's do. brush starts
 * with a stroke of "HB" in your colour at weight 1 and no other media. push() and pop() keep its settings.
 * Every brush shape is painted on its own, so a picture of thousands of tiny brush shapes is slow: give a stroke many
 * points, or a mass or a hatching a large shape, rather than drawing many little ones. For strokes that flow, as water,
 * wind, hair or grass do, work out each stroke's points along a flow with noise() and draw it with brush.spline.
 * brush's ink animates as any ink does: paint it in parts and pose them in a frame function. In a frame function, draw
 * with p5's shapes, not brush, since each brush shape there would be painted anew for every picture, which is slow.
 * Example: brush.set("rotring", "#222222", 1); brush.hatch(4, 30); brush.circle(200, 200, 60);
 */
import type { Point } from "./api.ts";

/** p5.brush's brushes, from fine to broad: pens, pencils from hard to soft, and dry media. */
export type BrushName =
  "pen" | "rotring" | "2H" | "HB" | "2B" | "cpencil" | "marker" | "crayon" | "charcoal" | "pastel" | "spray";

/**
 * A brush to make with brush.add. Its tip is "default", pencil-like, "spray", a cloud of dots, or "marker", flat and
 * solid. Every amount is optional. A spray's weight is the size of each dot and its scatter is how wide the cloud is,
 * so a soft beam of light is a spray of fine dots, weight 0.3, scattered wide, scatter 12, at a low opacity.
 */
export interface NewBrush {
  type: "default" | "spray" | "marker";
  /** How wide the tip is, or a spray's dots are, in page units at a stroke weight of 1, from 0.05 to 50 (1 if left out). */
  weight?: number;
  /** How far the stroke wavers, or a spray's dots spread, to the side, in page units at a stroke weight of 1, from 0 to 50 (0.5 if left out). */
  scatter?: number;
  /** How hard the tip's edge is, from 0, soft, to 1 (0.5 if left out). */
  sharpness?: number;
  /** How dense the tip's texture is, from 0.1 to 100; a spray needs more for a fuller cloud (10 if left out). */
  grain?: number;
  /** How opaque each stamp of the tip is, from 1 to 255 (150 if left out). */
  opacity?: number;
  /** The gap between stamps of the tip, from 0.02 to 10; smaller is denser and slower (0.3 if left out). */
  spacing?: number;
  /** The tip's size along the stroke: [start, end] or [start, middle, end], each from 0.1 to 5 ([1, 1] if left out). */
  pressure?: number[];
  /** How the tip turns as it goes: "none", with the stroke, "natural", or at random, "random" ("natural" if left out). */
  rotate?: "none" | "natural" | "random";
}

export declare const brush: {
  /** Makes a brush called `name`, which set(), mass() and hatching then use as they use p5.brush's own. */
  add(name: string, made: NewBrush): void;
  /**
   * Strokes from here on with brush `name`, one of BrushName or one you made, in `color`, `weight` times the brush's
   * own width (1 if left out).
   */
  set(name: string, color: string, weight?: number): void;
  /** Draws no stroke from here on; hatching still uses the brush last set. */
  noStroke(): void;
  /**
   * Hatches closed shapes from here on with the brush last set: lines `distance` apart, at `angle` degrees on the page
   * (45 if left out). `rand` from 0 to 1 places the lines unevenly, `gradient` from 0 to 1 spaces them wider toward
   * one side, and `continuous` joins each line to the next, as a hand that does not lift does.
   */
  hatch(distance: number, angle?: number, options?: { rand?: number; gradient?: number; continuous?: boolean }): void;
  /** Hatches nothing from here on. */
  noHatch(): void;
  /**
   * Masses closed shapes from here on with brush `name` in `color`: layers of curved strokes that build tone, as
   * charcoal, pastel or pencil does. `precision` from 0 to 1 makes the strokes steadier (0.5 if left out), `strength`
   * from 0 to 1 lays more layers (1 if left out), and `gradient` from 0 to 1 makes it lighter toward one side (0 if
   * left out). `style` "scribble" builds the tone from short back-and-forth strokes instead of sweeping arcs.
   */
  mass(
    name: string,
    color: string,
    options?: { precision?: number; strength?: number; gradient?: number; style?: "arcs" | "scribble" },
  ): void;
  /** Masses nothing from here on. */
  noMass(): void;
  /** Washes closed shapes from here on with flat, even colour in `color`, `opacity` from 0 to 255 (255 if left out). */
  wash(color: string, opacity?: number): void;
  /** Lays no flat wash from here on. */
  noWash(): void;
  /** Washes closed shapes from here on with watercolour in `color`, `opacity` from 0 to 255 (150 if left out). */
  fill(color: string, opacity?: number): void;
  /** Lays no watercolour from here on. */
  noFill(): void;
  /**
   * How far the watercolour bleeds past its shape, from 0 to 1; it starts at 0.07. `direction` "in" bleeds it into
   * the shape instead of out of it.
   */
  fillBleed(strength: number, direction?: "out" | "in"): void;
  /**
   * How much the watercolour shows the grain of the paper, from 0 to 1; it starts at 0.8. `border` from 0 to 1 is how
   * much darker its edge dries (0.4 if left out).
   */
  fillTexture(strength: number, border?: number): void;
  /** A straight stroke from (x1, y1) to (x2, y2). */
  line(x1: number, y1: number, x2: number, y2: number): number;
  /** A box with its top left at (x, y). */
  rect(x: number, y: number, w: number, h: number): number;
  /** A circle of radius r about (x, y). */
  circle(x: number, y: number, r: number): number;
  /** A closed shape through the points. */
  polygon(points: Point[]): number;
  /** An open stroke through the points, from 0, straight, to 1, round (0.5 if left out). */
  spline(points: Point[], curvature?: number): number;
};
