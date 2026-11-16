/**
 * The sheet: what is on the page now. It holds the marks, which are the ink, in the order they were made, the
 * animations, and the colour of the paper behind all the ink. A mark is a line, a fill or a brush mark and holds its ink
 * as it is now: erasing cuts ink out of a mark, and moving maps a mark's points, so nothing remembers how a mark came
 * to be as it is. The sheet knows nothing of screens or
 * canvases, so the page and the workers that run the agent's code each use one.
 *
 * Marks made by one call of a drawing function, or by one stroke of the person's pen, share an id. A mark may have a
 * part: the name of the part of a drawing it belongs to, where "tree.leaf3" is inside "tree".
 */
import type { Box, Color, Ink, Point } from "./api.ts";
import type { BrushName } from "./brushapi.ts";
import { type XY, around, corners, holds, overlaps, union, within } from "./box.ts";

type By = "person" | "agent";

interface Common {
  id: number;
  by: By;
  made: string; // the function that made it, such as "ellipse" or "write", or "pen" for the person's pen
  part?: string;
  color: Color;
  opacity: number; // how solid its ink is, from 0 to 1
}
/** A point of a line, and how wide the line's ink is there: x, y and the width, in page units. */
export type LinePoint = [x: number, y: number, width: number];

/** Returns the points of a line that is `width` wide at every one of them. */
export function even(points: Point[], width: number): LinePoint[] {
  return points.map(([x, y]) => [x, y, width]);
}
/**
 * Ink along lines: what is left of one stroke, in pieces. Each point holds the line's width there, so a line can swell
 * and thin along its length, as the person's pen does with pressure and speed; the agent's lines are as wide at every
 * point.
 */
export interface LineMark extends Common {
  kind: "line";
  text?: string; // what was written, for a stroke of handwriting
  crayon?: true; // whether it colours a fill in, as the agent's hand does
  pieces: LinePoint[][];
}
/** Ink over an area: the inside of rings, where a point inside an even number of rings is outside, less its cuts. */
export interface FillMark extends Common {
  kind: "fill";
  rings: Point[][];
  cuts: Cut[];
}
/**
 * Paint laid by p5.brush. It keeps what p5.brush is to paint, not the paint, and the page paints it whenever it shows
 * it, the same each time for the same `seed`. `reach` is how far its paint may lie past its points, in page units, so
 * that the sheet can tell its box without knowing how p5.brush paints. Rubbed-out parts are cuts, as a fill's are.
 */
export interface BrushMark extends Common {
  kind: "brush";
  paint: BrushPaint;
  points: Point[][]; // a stroke's pieces or a wash's rings
  reach: number;
  seed: number;
  cuts: Cut[];
}
/**
 * What p5.brush lays. A stroke runs `brush` along the mark's pieces, `weight` times the brush's own size, in page units.
 * Hatching fills the mark's rings with strokes of `brush`, `distance` page units apart at `angle` degrees on the page,
 * placed at random by `rand`, closer on one side by `gradient`, and joined end to end if `continuous`. Massing fills the
 * rings with layers of curved strokes of `brush`, as an artist builds tone, steadier with `precision`, in more layers
 * with `strength`, and lighter to one side with `gradient`, each from 0 to 1; `scribble` builds it from short
 * back-and-forth strokes instead. A watercolour wash fills the rings with paint that bleeds `bleed` past them, or into
 * them if `inward`, shows the paper's grain `texture`, and dries `border` darker at its edge, each from 0 to 1. A flat
 * wash fills the rings with flat colour. `brush` is one of p5.brush's brushes by name, or a brush the agent's code made.
 * Marks made before massing, flat washes and made brushes existed have no `rand`, `gradient`, `continuous`, `inward`
 * or `border`, and are painted with their defaults.
 */
export type BrushPaint =
  | { kind: "stroke"; brush: Brush; weight: number }
  | {
      kind: "hatch";
      brush: Brush;
      weight: number;
      distance: number;
      angle: number;
      rand?: number;
      gradient?: number;
      continuous?: boolean;
    }
  | { kind: "mass"; brush: Brush; precision: number; strength: number; gradient: number; scribble?: true }
  | { kind: "wash"; bleed: number; texture: number; border?: number; inward?: true }
  | { kind: "flat" };
/** One of p5.brush's brushes, by name, or a brush the agent's code made. */
export type Brush = BrushName | Made;
/**
 * A brush the agent's code made, as p5.brush's add() takes it. Its tip is a pencil-like `default` tip, a `spray` of
 * dots or a flat `marker`, `weight` page units wide at a stroke weight of 1. A stroke wavers `scatter` times its
 * weight to the side, has a `sharpness` from 0, soft, to 1, a `grain` that makes it denser and smoother as it grows,
 * an `opacity` from 0 to 255, and a stamp of the tip every `spacing` page units. `pressure` scales the tip from the
 * stroke's start, through its middle if it has three, to its end, and `rotate` turns the tip not at all, with the
 * stroke, or at random.
 */
export interface Made {
  type: "default" | "spray" | "marker";
  weight: number;
  scatter: number;
  sharpness: number;
  grain: number;
  opacity: number;
  spacing: number;
  pressure: number[];
  rotate: "none" | "natural" | "random";
}
export type Mark = LineMark | FillMark | BrushMark;

/** A part of a fill that is rubbed out: inside a ring, or under the line of the person's eraser. */
export type Cut = { ring: Point[] } | { line: LinePoint[] };

/**
 * An animation as the agent's code made it. `frame` is the source text of its function (t, data) => void, `data` is
 * the value that function is given, `seconds` is how long it runs, or undefined to run until it is stopped, and
 * `sticker` is the emoji of its sticker. `at` is where the sticker lies on the page, once the page has placed it.
 */
export interface Animation {
  name: string;
  frame: string;
  data: unknown;
  seconds?: number;
  sticker: string;
  at?: Point;
}

/** What is on a sheet at one moment, and its next id. */
export interface Snapshot {
  marks: Mark[];
  animations: Map<string, Animation>;
  paper: Color;
  next: number;
}

/** The colour of a new sheet's paper. */
export const WHITE: Color = "white";

/** A region of the page: the box around it, and has(p, d), whether the point p is inside it or less than d from it. */
interface Region {
  box: Box;
  has: (p: XY, d: number) => boolean;
}

export class Sheet {
  marks: Mark[] = [];
  animations = new Map<string, Animation>();
  paper = WHITE;
  next = 1; // the id of the next stroke of the pen or call of a drawing function
  private boxes = new WeakMap<Mark, Box>(); // the box around each mark, until the mark changes

  /** Returns the box around a mark's ink. */
  box(m: Mark): Box {
    let b = this.boxes.get(m);
    if (!b) this.boxes.set(m, (b = boxOf(m)));
    return b;
  }

  /** Returns the x of the rightmost ink on the sheet, or 0 for a blank sheet. */
  rightmost(): number {
    return this.marks.reduce((far, m) => Math.max(far, this.box(m).x + this.box(m).width), 0);
  }

  /** Returns the y of the lowest ink on the sheet, or 0 for a blank sheet. */
  lowest(): number {
    return this.marks.reduce((low, m) => Math.max(low, this.box(m).y + this.box(m).height), 0);
  }

  /** Returns the marks that `which` names: those with one of the ids, or in one of the parts or a part inside it. */
  pick(which: (number | string)[]): Mark[] {
    return this.marks.filter((m) => which.some((w) => (typeof w === "number" ? m.id === w : under(m.part, w))));
  }

  /** Returns everything on the sheet that lies at least partly inside `within`, or all of it: one entry for each id. */
  ink(within?: Box): Ink[] {
    const found = new Map<number, Ink>();
    for (const m of this.marks) {
      const b = this.box(m);
      if (within && !overlaps(b, within)) continue;
      const was = found.get(m.id),
        entry: Ink = was ?? { id: m.id, by: m.by === "agent" ? "you" : "person", made: m.made, box: b };
      if (was) entry.box = union(was.box, b);
      if (m.part !== undefined) entry.part = m.part;
      if (m.opacity < 1) entry.opacity = m.opacity;
      if (m.kind === "fill" || (m.kind === "brush" && m.paint.kind !== "stroke")) entry.fill = m.color;
      else if (m.kind === "brush") entry.color = m.color;
      else {
        entry.color = m.color;
        if (m.text !== undefined) entry.text = m.text;
        if (m.made === "pen")
          entry.points = [...(entry.points ?? []), ...m.pieces.map((p) => simplify(p, 1.5).map(rounded))];
      }
      found.set(m.id, entry);
    }
    return [...found.values()];
  }

  /** Returns the smallest box around marks. */
  around(marks: Mark[]): Box {
    return marks.map((m) => this.box(m)).reduce(union);
  }

  /**
   * Rubs out of every mark what lies inside a box, or under the line of an eraser. A line loses the ink there, and a
   * fill gets a cut. The eraser also takes a line's ink whose edge it touches. A mark with no ink left is taken off the
   * sheet: a line with no pieces, and a fill that lies wholly inside the box.
   */
  rub(what: Box | { line: LinePoint[] }): void {
    const eraser = "line" in what,
      region = eraser ? swept(what.line) : inside(what),
      cut: Cut = eraser ? what : { ring: corners(what) },
      gone = new Set<Mark>();
    for (const m of this.marks) {
      if (!overlaps(this.box(m), region.box)) continue;
      if (m.kind === "line") m.pieces = trimmed(m.pieces, region, eraser);
      else if (!eraser && within(this.box(m), what)) gone.add(m);
      else m.cuts = [...m.cuts, cut];
      if (m.kind === "line" && !m.pieces.length) gone.add(m);
      this.boxes.delete(m);
    }
    this.marks = this.marks.filter((m) => !gone.has(m));
  }

  /** Takes marks off the sheet. */
  drop(marks: Mark[]): void {
    this.marks = this.marks.filter((m) => !marks.includes(m));
  }

  /** Moves marks for good: each point goes where `to` takes it, and each line is `thick` times as wide. */
  move(marks: Mark[], to: (p: Point) => Point, thick: number): void {
    for (const m of marks) {
      if (m.kind === "line") m.pieces = m.pieces.map((p) => movedLine(p, to, thick));
      else if (m.kind === "fill")
        [m.rings, m.cuts] = [m.rings.map((r) => r.map(to)), m.cuts.map((c) => moved(c, to, thick))];
      else
        [m.points, m.paint, m.reach, m.cuts] = [
          m.points.map((p) => p.map(to)),
          movedPaint(m.paint, to, thick),
          m.reach * thick,
          m.cuts.map((c) => moved(c, to, thick)),
        ];
      this.boxes.delete(m);
    }
  }

  /** Returns what is on the sheet now, to go back to with restore(). */
  snapshot(): Snapshot {
    const { paper, next } = this;
    return { marks: this.marks.map((m) => ({ ...m })), animations: new Map(this.animations), paper, next };
  }

  /** Puts back what was on the sheet at a snapshot. */
  restore(s: Snapshot): void {
    [this.marks, this.animations] = [s.marks.map((m) => ({ ...m })), new Map(s.animations)];
    [this.paper, this.next] = [s.paper, s.next];
  }
}

/** Returns the box around a mark's ink, and for a brush mark, around all the paint it may lay. */
export function boxOf(m: Mark): Box {
  if (m.kind === "line") return around(m.pieces.flat(), widest(m.pieces.flat()) / 2);
  if (m.kind === "fill") return around(m.rings.flat());
  return around(m.points.flat(), m.reach);
}

/** Returns the greatest width along a line. */
function widest(points: LinePoint[]): number {
  return points.reduce((w, p) => Math.max(w, p[2]), 0);
}

/** Returns brush paint moved as its points are: its strokes `thick` times as heavy, and its hatching turned with them. */
function movedPaint(paint: BrushPaint, to: (p: Point) => Point, thick: number): BrushPaint {
  if (paint.kind === "wash" || paint.kind === "flat" || paint.kind === "mass") return paint;
  if (paint.kind === "stroke") return { ...paint, weight: paint.weight * thick };
  const [[x0, y0], [x1, y1]] = [to([0, 0]), to([1, 0])],
    turn = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
  return { ...paint, weight: paint.weight * thick, distance: paint.distance * thick, angle: paint.angle + turn };
}

/** Returns whether the part called `part` is the part called `name` or lies inside it: "tree.leaf3" is inside "tree". */
export function under(part: string | undefined, name: string): boolean {
  return part === name || Boolean(part?.startsWith(name + "."));
}

/** Returns the parts a part lies inside, from itself outward: "tree.leaf3" gives "tree.leaf3" and then "tree". */
export function chain(part: string): string[] {
  const words = part.split(".");
  return words.map((_, i) => words.slice(0, words.length - i).join("."));
}

/** Returns a cut with each point taken where `to` takes it, and a line's widths scaled by `thick`. */
export function moved(c: Cut, to: (p: Point) => Point, thick: number): Cut {
  return "ring" in c ? { ring: c.ring.map(to) } : { line: movedLine(c.line, to, thick) };
}

/** Returns the points of a line, each taken where `to` takes it, and each width `thick` times as wide. */
export function movedLine(points: LinePoint[], to: (p: Point) => Point, thick: number): LinePoint[] {
  return points.map(([x, y, w]) => [...to([x, y]), w * thick]);
}

/** Returns the region inside a box. */
function inside(box: Box): Region {
  return { box, has: (p, d) => holds(box, p, d) };
}

/** Returns the region an eraser sweeps along its line: what it rubs out. */
function swept(line: LinePoint[]): Region {
  // how far p lies outside the ink of the segment from a to b, whose width runs from a's to b's
  const outside = ([px, py]: XY, [ax, ay, aw]: LinePoint, [bx, by, bw]: LinePoint) => {
    const dx = bx - ax,
      dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy) - (aw + t * (bw - aw)) / 2;
  };
  return {
    box: around(line, widest(line) / 2),
    has: (p, d) => line.some((a, i) => outside(p, a, line[i + 1] ?? a) < d),
  };
}

/** Returns a line's points with those that bend it less than `tolerance` left out (Ramer-Douglas-Peucker). */
function simplify<P extends XY>(points: P[], tolerance: number): P[] {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]),
    todo: [number, number][] = [[0, points.length - 1]];
  while (todo.length) {
    const [a, b] = todo.pop()!,
      [ax, ay] = points[a],
      [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay);
    let far = 0,
      at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]; // its distance from the line through a and b, or from a if a and b are one point
      const d = len ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay);
      if (d > far) [far, at] = [d, i];
    }
    if (far > tolerance) {
      keep.add(at);
      todo.push([a, at], [at, b]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i]);
}

/** Returns a point's x and y in whole numbers. */
function rounded([x, y]: XY): Point {
  return [Math.round(x), Math.round(y)];
}

/**
 * Returns the pieces of a line with what `region` covers cut away. A point counts as covered when it lies in the
 * region, or, where `edge` is true, when the line's ink at the point reaches the region.
 */
function trimmed(pieces: LinePoint[][], region: Region, edge: boolean): LinePoint[][] {
  const kept: LinePoint[][] = [];
  for (const p of pieces) {
    let piece: LinePoint[] = [];
    const keep = (q: LinePoint) => {
      if (!region.has(q, edge ? q[2] / 2 : 0)) return void piece.push(q);
      if (piece.length > 1) kept.push(piece);
      piece = [];
    };
    keep(p[0]);
    for (let i = 1; i < p.length; i++) {
      // every 2 units along each segment, so a cut ends where the region does, with the width between the two ends
      const [ax, ay, aw] = p[i - 1],
        [bx, by, bw] = p[i],
        n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
      for (let k = 1; k <= n; k++) keep([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, aw + ((bw - aw) * k) / n]);
    }
    if (piece.length > 1 || (piece.length && p.length === 1)) kept.push(piece);
  }
  return kept;
}
