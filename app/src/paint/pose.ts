/**
 * Poses, and how a mark looks when it is drawn. A pose scales and turns ink about an origin and then shifts it, which
 * is one affine map of the page, kept as a matrix. Parts are nested by the dots in their names, as elements are in a
 * web page: a mark is moved by the poses of its own part first, and then by the poses of each part around it.
 *
 * Nothing here changes a mark. A look says how to draw a mark at one moment, and draw() draws it that way.
 */
import type { Box, Point, Pose } from "./api.ts";
import { middle } from "./box.ts";
import { type Mark, type Sheet, chain } from "./sheet.ts";

/** An affine map of the page: the point (x, y) goes to (a x + c y + e, b x + d y + f). */
export type Matrix = [a: number, b: number, c: number, d: number, e: number, f: number];

/** The map that leaves every point where it is. */
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/**
 * How a mark is drawn at one moment: each point of its ink is taken through `at`, its ink is `solid` from 0 to 1, and
 * of a line only the first `drawn` of its length shows, from 0 to 1. What is left out is as the mark is.
 */
export interface Look {
  at?: Matrix;
  solid?: number;
  drawn?: number;
}

/** What an animation shows at one moment: for each part it poses, the part's poses in order, and its own ink. */
export interface Shot {
  poses: Record<string, Pose[]>;
  ink: Mark[];
}

/**
 * Returns the map of a pose of ink whose box is `box`: T(p) = o + (dx, dy) + R(rotate) S(scaleX, scaleY) (p - o),
 * where o is the pose's origin, S scales and R turns clockwise.
 */
export function matrix(pose: Pose, box: Box): Matrix {
  const [ox, oy] = origin(pose.origin ?? "center", box),
    sx = (pose.scale ?? 1) * (pose.scaleX ?? 1),
    sy = (pose.scale ?? 1) * (pose.scaleY ?? 1),
    turn = ((pose.rotate ?? 0) * Math.PI) / 180;
  const [a, b, c, d] = [Math.cos(turn) * sx, Math.sin(turn) * sx, -Math.sin(turn) * sy, Math.cos(turn) * sy];
  return [a, b, c, d, ox + (pose.dx ?? 0) - a * ox - c * oy, oy + (pose.dy ?? 0) - b * ox - d * oy];
}

/** Returns the point a pose's origin names: a point of the page, or the middle of the box or of one of its edges. */
function origin(o: NonNullable<Pose["origin"]>, box: Box): Point {
  if (typeof o !== "string") return o;
  const [x, y] = middle(box);
  if (o === "top") return [x, box.y];
  if (o === "bottom") return [x, box.y + box.height];
  if (o === "left") return [box.x, y];
  if (o === "right") return [box.x + box.width, y];
  return [x, y];
}

/** Returns the map that does q first and then p. */
export function after(p: Matrix, q: Matrix): Matrix {
  return [
    p[0] * q[0] + p[2] * q[1],
    p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3],
    p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4],
    p[1] * q[4] + p[3] * q[5] + p[5],
  ];
}

/** Returns the map that undoes m. */
export function inverse([a, b, c, d, e, f]: Matrix): Matrix {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** Returns the function that takes a point through a map. */
export function mapper([a, b, c, d, e, f]: Matrix): (p: Point) => Point {
  return ([x, y]) => [a * x + c * y + e, b * x + d * y + f];
}

/** Returns how much thicker a map makes a line: the square root of how much it scales areas. */
export function thickness([a, b, c, d]: Matrix): number {
  return Math.sqrt(Math.abs(a * d - b * c));
}

/** Returns the pose that is the share k, from 0 to 1, of the way from no pose to `pose`. */
export function partway(pose: Pose, k: number): Pose {
  const to = (v: number | undefined, rest: number) => rest + ((v ?? rest) - rest) * k;
  return {
    origin: pose.origin,
    dx: to(pose.dx, 0),
    dy: to(pose.dy, 0),
    rotate: to(pose.rotate, 0),
    scale: to(pose.scale, 1),
    scaleX: to(pose.scaleX, 1),
    scaleY: to(pose.scaleY, 1),
  };
}

/**
 * Returns the function that gives a mark its look under `poses`, or undefined for a mark that no pose holds. The
 * poses of a part become one map about the box around the part's ink on the sheet.
 */
export function posed(sheet: Sheet, poses: Shot["poses"]): (m: Mark) => Look | undefined {
  const parts = new Map<string, { at: Matrix; solid: number }>(); // each posed part's poses as one map and one opacity
  for (const [part, held] of Object.entries(poses)) {
    const ink = sheet.pick([part]);
    if (!ink.length) continue; // no ink is in this part any more
    const box = sheet.around(ink);
    parts.set(part, {
      at: held.map((pose) => matrix(pose, box)).reduce((done, next) => after(next, done)),
      solid: held.reduce((solid, pose) => solid * Math.max(0, Math.min(1, pose.opacity ?? 1)), 1),
    });
  }
  return (m) => {
    // the mark's own part first, then each part around it
    const held = (m.part ? chain(m.part) : []).flatMap((part) => parts.get(part) ?? []);
    if (!held.length) return undefined;
    return {
      at: held.map((part) => part.at).reduce((done, next) => after(next, done)),
      solid: held.reduce((solid, part) => solid * part.solid, 1),
    };
  };
}
