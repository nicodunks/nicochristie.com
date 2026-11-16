/** Boxes on the page: the box around points, and how two boxes or a box and a point lie to each other. */
import type { Box, Point } from "./api.ts";

/** A point: its x and y, and perhaps more numbers after them, such as the width of a line at the point. */
export type XY = readonly [x: number, y: number, ...more: number[]];

/** Returns the smallest box around the points, widened by `pad` on every side. */
export function around(points: Iterable<XY>, pad = 0): Box {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  return { x: x0 - pad, y: y0 - pad, width: x1 - x0 + 2 * pad, height: y1 - y0 + 2 * pad };
}

/** Returns the smallest box around both boxes. */
export function union(a: Box, b: Box): Box {
  return around([...corners(a), ...corners(b)]);
}

/** Returns whether two boxes overlap, or come within `pad` of each other. */
export function overlaps(a: Box, b: Box, pad = 0): boolean {
  return (
    a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad
  );
}

/** Returns whether box a lies wholly inside box b. */
export function within(a: Box, b: Box): boolean {
  return a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
}

/** Returns whether the point lies inside the box, or within `pad` of it. */
export function holds(b: Box, [x, y]: XY, pad = 0): boolean {
  return x > b.x - pad && x < b.x + b.width + pad && y > b.y - pad && y < b.y + b.height + pad;
}

/** Returns the middle of a box. */
export function middle(b: Box): Point {
  return [b.x + b.width / 2, b.y + b.height / 2];
}

/** Returns the four corners of a box, clockwise from its top left. */
export function corners(b: Box): Point[] {
  return [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x + b.width, b.y + b.height],
    [b.x, b.y + b.height],
  ];
}
