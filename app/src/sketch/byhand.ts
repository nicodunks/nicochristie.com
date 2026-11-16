/**
 * Turns the exact shapes that p5 draws into shapes as a hand draws them. A hand's line drifts a little to either side
 * as it goes, and a hand's circle does not close where it began but runs on past it. A hand colours a shape in with
 * strokes of a crayon, back and forth, that run a little past the outline. So each line here is pushed sideways by a
 * slow wave, a closed line runs on past its start, and each fill becomes a scribble of thick lines that cover it.
 *
 * `hand` says how much: 0 leaves the shapes exact, 1 is a person's pen, and more is looser. The waves are random, but
 * seeded by where the shape is, so the same shape in the same place comes out the same every time.
 */
import type { Point } from "../paint/api.ts";
import { STEP } from "../paint/constants.ts";
import { mulberry } from "../paint/hand.ts";
import type { Shape } from "./canvas.ts";

const MOST_STROKES = 300; // the most strokes that colour in one fill, so a huge fill stays a few thousand points

/** Returns the shapes as a hand draws them, wavering by `hand`; with `hand` 0, the shapes as they are. */
export function byHand(shapes: Shape[], hand: number): Shape[] {
  if (hand <= 0) return shapes;
  return shapes.map((s) => {
    const random = mulberry(seed(s.points));
    if (s.kind === "line") return { ...s, points: s.points.map((p) => wavered(p, hand, random)) };
    const { width, pieces } = coloured(s.points, hand, random);
    return { ...s, kind: "line", crayon: true, width, points: pieces };
  });
}

/**
 * Returns a line's points pushed sideways by a slow wave, as a hand drifts off a line. The wave is two sines along the
 * line, and its height grows with the line's length, up to 3 units at `hand` 1. A closed line runs on past its start.
 */
function wavered(piece: Point[], hand: number, random: () => number): Point[] {
  const along = lengths(piece),
    length = along[along.length - 1];
  if (piece.length < 3 || length < 1) return piece;
  let points = piece;
  const [x0, y0] = piece[0],
    [x1, y1] = piece[piece.length - 1];
  if (Math.hypot(x1 - x0, y1 - y0) < 1e-6) {
    // closed: run on past the start, along the line's own first points
    const over = hand * Math.min(12, 0.08 * length) * (0.3 + 0.7 * random());
    points = piece.slice();
    for (let i = 1; i < piece.length && along[i] < over; i++) {
      points.push(piece[i]);
      along.push(length + along[i]);
    }
  }
  const height = hand * Math.min(3, 0.25 + 0.012 * length),
    long = Math.max(25, Math.min(220, 0.7 * length)) * (0.8 + 0.4 * random()),
    short = long / 2.7,
    [a, b] = [random() * 2 * Math.PI, random() * 2 * Math.PI];
  return points.map(([x, y], i) => {
    const [px, py] = points[Math.max(0, i - 1)],
      [nx, ny] = points[Math.min(points.length - 1, i + 1)],
      d = Math.hypot(nx - px, ny - py) || 1,
      s = along[i],
      off = height * (0.7 * Math.sin((2 * Math.PI * s) / long + a) + 0.3 * Math.sin((2 * Math.PI * s) / short + b));
    return [x - (off * (ny - py)) / d, y + (off * (nx - px)) / d];
  });
}

/**
 * Returns the strokes that colour in the rings, filled even-odd, and their width. The strokes run side by side at one
 * slant, close enough that they cover the inside. Each ends a random length short of the outline or past it, and the
 * whole colouring sits a little off the shape, so that it spills over one side and falls short of another. Where the
 * shape's inside crosses one stroke's path in one stretch, as it does in a convex shape, each stroke turns back into
 * the next, so the strokes are one scribble.
 */
function coloured(rings: Point[][], hand: number, random: () => number): { width: number; pieces: Point[][] } {
  const slant = -0.6 + (random() - 0.5) * 0.5, // radians from across: 34° give or take 14°
    [cos, sin] = [Math.cos(slant), Math.sin(slant)];
  // the rings turned by -slant, so the strokes run along x
  const turned = rings.map((r) => r.map(([x, y]): Point => [x * cos + y * sin, -x * sin + y * cos]));
  const ys = turned.flat().map((p) => p[1]),
    [top, bottom] = [Math.min(...ys), Math.max(...ys)];
  let width = Math.max(2, Math.min(14, Math.sqrt(area(rings)) / 10)),
    gap = 0.65 * width; // close enough that the strokes leave no paper between them
  if ((bottom - top) / gap > MOST_STROKES)
    [gap, width] = [(bottom - top) / MOST_STROKES, (bottom - top) / MOST_STROKES / 0.65];
  const rows = Math.max(1, Math.round((bottom - top) / gap)),
    first = (top + bottom) / 2 - ((rows - 1) * gap) / 2,
    // how far a stroke's end goes past the outline, counting its round cap, which already reaches width / 2 past
    beyond = () => hand * width * (0.6 * random() - 0.25) - width / 2,
    wave = hand * 0.08 * width,
    phase = random() * 2 * Math.PI,
    [dx, dy] = [hand * width * 0.3 * (2 * random() - 1), hand * width * 0.2 * (2 * random() - 1)]; // off the shape

  const pieces: Point[][] = [];
  let open: Point[] | null = null, // the scribble that the next stroke may join
    rightward = true;
  for (let r = 0; r < rows; r++) {
    const y = first + r * gap + (random() - 0.5) * 0.2 * gap * hand + dy,
      runs = crossings(turned, y);
    if (runs.length !== 1) open = null;
    for (const [from, to] of runs) {
      let [left, right] = [from + dx - beyond(), to + dx + beyond()];
      if (left > right) left = right = (from + to) / 2 + dx; // a stretch narrower than a stroke is one dab
      const line: Point[] = [];
      const n = Math.max(1, Math.ceil((right - left) / Math.max(STEP, width)));
      for (let i = 0; i <= n; i++) {
        const x = rightward ? left + ((right - left) * i) / n : right - ((right - left) * i) / n;
        line.push([x, y + wave * Math.sin(x / 23 + phase + r)]);
      }
      if (open && runs.length === 1) open.push(...line);
      else {
        pieces.push(line);
        open = runs.length === 1 ? line : null;
      }
      rightward = !rightward;
    }
  }
  // turned back by slant
  const back = pieces.map((p) => p.map(([x, y]): Point => [x * cos - y * sin, x * sin + y * cos]));
  return { width, pieces: back };
}

/** Returns where the line across at height `y` is inside the rings, filled even-odd, as [from, to] in x, left first. */
function crossings(rings: Point[][], y: number): [number, number][] {
  const xs: number[] = [];
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i],
        [bx, by] = ring[(i + 1) % ring.length];
      if (ay <= y !== by <= y) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
    }
  xs.sort((p, q) => p - q);
  const runs: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) runs.push([xs[i], xs[i + 1]]);
  return runs;
}

/** Returns the area inside the rings, in square page units, counting each ring's area once. */
function area(rings: Point[][]): number {
  let sum = 0;
  for (const ring of rings) {
    let twice = 0;
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i],
        [bx, by] = ring[(i + 1) % ring.length];
      twice += ax * by - bx * ay;
    }
    sum += Math.abs(twice) / 2;
  }
  return sum;
}

/** Returns the distance along the points from the first to each, in page units. */
function lengths(points: Point[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++)
    out.push(out[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return out;
}

/** Returns a seed made from where the shape's pieces start and end, so a shape in one place always wavers the same. */
function seed(points: Point[][]): number {
  let h = 2166136261;
  for (const piece of points)
    for (const [x, y] of [piece[0], piece[piece.length - 1]]) {
      h = Math.imul(h ^ Math.round(x * 8), 16777619);
      h = Math.imul(h ^ Math.round(y * 8), 16777619);
    }
  return h;
}
