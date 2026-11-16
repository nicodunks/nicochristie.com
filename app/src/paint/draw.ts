/**
 * How marks are drawn on a canvas: a line is the outline of each of its pieces, as wide at each point as the point
 * says, with round ends; a fill is the inside of its rings less what was rubbed out of it; and a brush mark is its
 * picture, painted by p5.brush, laid over what is under it. Works on the page's canvas and on an OffscreenCanvas in a worker, where a brush mark, which
 * p5.brush cannot paint there, is drawn plainly as a line or a fill.
 */
import type { Point } from "./api.ts";
import { corners } from "./box.ts";
import { picture } from "./brushpaint.ts";
import { css } from "./constants.ts";
import { type Look, mapper, thickness } from "./pose.ts";
import { type BrushMark, type Cut, type LinePoint, type Mark, even, moved, movedLine } from "./sheet.ts";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Draws one mark on c, in page units under c's transform, as solid as the mark is, and as `look` says: moved,
 * more see-through, or drawn only in part. A fill shows only once it is wholly drawn.
 */
export function draw(c: Ctx, m: Mark, look: Look = {}): void {
  const to = look.at && mapper(look.at),
    thick = look.at ? thickness(look.at) : 1,
    drawn = look.drawn ?? 1;
  if (drawn <= 0 || (m.kind !== "line" && drawn < 1)) return;
  if (m.kind === "brush") return brushed(c, m, look);
  c.globalAlpha = (look.solid ?? 1) * m.opacity;
  if (m.kind === "fill") {
    const [rings, cuts] = to
      ? [m.rings.map((r) => r.map(to)), m.cuts.map((x) => moved(x, to, thick))]
      : [m.rings, m.cuts];
    filled(c, css(m.color), rings, cuts);
  } else {
    let pieces = to ? m.pieces.map((p) => movedLine(p, to, thick)) : m.pieces;
    if (drawn < 1) {
      let more = Math.ceil(drawn * pieces.reduce((n, p) => n + p.length, 0)); // how many points still show
      pieces = pieces.map((p) => {
        const some = p.slice(0, Math.max(0, more));
        more -= p.length;
        return some;
      });
    }
    line(c, css(m.color), pieces);
  }
  c.globalAlpha = 1;
}

/**
 * Draws a brush mark's picture through the look's matrix: it multiplies what is under the mark by the share that shows
 * through the paint, and adds the paint, as paint covers paper. So it needs the paper under it, on the same canvas.
 * With cuts, each image is laid on a layer of its own first and the cuts are taken out of the layer, where a
 * see-through pixel changes nothing under it. A wash's opacity, flat or watercolour, is already in its picture, as how
 * much paint p5.brush laid; the opacity of a stroke, a hatching or massing is laid here. Where there is no picture,
 * the mark is drawn plainly: a stroke as a line, and anything else as a fill.
 */
function brushed(c: Ctx, m: BrushMark, look: Look): void {
  const t = c.getTransform(),
    k = Math.hypot(t.a, t.b) * (look.at ? thickness(look.at) : 1), // pixels a page unit, where the mark lands
    p = picture(m, k);
  if (!p) {
    const { paint } = m,
      plain: Mark =
        paint.kind === "stroke"
          ? { ...m, kind: "line", pieces: m.points.map((p) => even(p, Math.max(1, paint.weight))) }
          : { ...m, kind: "fill", rings: m.points };
    return draw(c, plain, look);
  }
  const { box } = p;
  c.save();
  if (look.at) c.transform(...look.at);
  c.globalAlpha = (look.solid ?? 1) * (m.paint.kind === "wash" || m.paint.kind === "flat" ? 1 : m.opacity);
  for (const [image, how] of [
    [p.through, "multiply"],
    [p.paint, "lighter"],
  ] as const) {
    c.globalCompositeOperation = how;
    const lay = (l: Ctx) => l.drawImage(image, box.x, box.y, box.width, box.height);
    if (!m.cuts.length) lay(c);
    else
      layered(c, [corners(box)], 0, (l) => {
        lay(l);
        rubOut(l, m.cuts);
      });
  }
  c.restore();
}

// Takes the cuts out of what is on l.
function rubOut(l: Ctx, cuts: Cut[]): void {
  l.globalCompositeOperation = "destination-out";
  for (const cut of cuts) {
    if ("line" in cut) {
      line(l, "#000", [cut.line]);
      continue;
    }
    l.beginPath();
    cut.ring.forEach(([px, py], i) => (i ? l.lineTo(px, py) : l.moveTo(px, py)));
    l.closePath();
    l.fill();
  }
}

/**
 * Lays a line down along each piece, in a colour: fills each piece's outline, as wide at each point as the point says,
 * but never thinner than one of the canvas's pixels.
 */
export function line(c: Ctx, color: string, pieces: LinePoint[][]): void {
  const least = 1 / Math.hypot(c.getTransform().a, c.getTransform().b); // page units per pixel
  c.fillStyle = color;
  for (const p of pieces) {
    if (!p.length) continue;
    c.beginPath();
    outline(c, p, least);
    c.fill();
  }
}

/** A disc of ink around a point of a line: its centre and its radius, in page units. */
type Disc = [x: number, y: number, r: number];
/** A direction: a vector one unit long. */
type Direction = [x: number, y: number];

/**
 * Traces the outline of a piece of a line on c, to fill by the nonzero rule. Around each point lies a disc as wide as
 * the line is there, and at least `least` wide; the ink is every disc and the band between each two neighbouring
 * discs. The outline runs down the left side of the piece and back up the right. Along each segment it follows the
 * straight edge of the band. On the outer side of a turn it follows the disc at the turn, and on the inner side it
 * passes through the turn's point, so the edge folds back over ink and every part of the ink is wound the same way.
 * Each end is the far half of its disc.
 */
function outline(c: Ctx, piece: LinePoint[], least: number): void {
  const discs = discsOf(piece, least),
    n = discs.length - 1; // how many segments
  const on = ([x, y, r]: Disc, [dx, dy]: Direction): [number, number] => [x + r * dx, y + r * dy],
    angle = ([dx, dy]: Direction) => Math.atan2(dy, dx),
    round = ([x, y, r]: Disc, from: Direction, to: Direction) => c.arc(x, y, r, angle(from), angle(to), true);
  if (!n) return void c.arc(discs[0][0], discs[0][1], discs[0][2], 0, 2 * Math.PI); // a dot: the whole disc
  const sides = discs.slice(1).map((b, i) => edges(discs[i], b)),
    left = sides.map(([l]) => l),
    right = sides.map(([, r]) => r);
  // at disc d, from the edge that touches it at `from` to the edge that touches it at `to`
  const turn = (d: Disc, from: Direction, to: Direction) => {
    const outer = from[0] * to[1] - from[1] * to[0] < 0;
    if (outer) return round(d, from, to);
    c.lineTo(d[0], d[1]);
    c.lineTo(...on(d, to));
  };
  c.moveTo(...on(discs[0], left[0]));
  for (let i = 0; i < n; i++) {
    c.lineTo(...on(discs[i + 1], left[i]));
    if (i + 1 < n) turn(discs[i + 1], left[i], left[i + 1]);
  }
  round(discs[n], left[n - 1], right[n - 1]); // the far end
  for (let i = n - 1; i >= 0; i--) {
    c.lineTo(...on(discs[i], right[i]));
    if (i > 0) turn(discs[i], right[i], right[i - 1]);
  }
  round(discs[0], right[0], left[0]); // the near end
  c.closePath();
}

// Returns the discs around the points of a piece, at least `least` wide, less each disc that lies inside a neighbour's
// and so adds no ink.
function discsOf(piece: LinePoint[], least: number): Disc[] {
  const discs: Disc[] = [],
    within = ([ax, ay, ar]: Disc, [bx, by, br]: Disc) => Math.hypot(bx - ax, by - ay) + ar <= br; // a lies in b
  for (const [x, y, w] of piece) {
    const d: Disc = [x, y, Math.max(w, least) / 2];
    while (discs.length && within(discs[discs.length - 1], d)) discs.pop();
    if (!discs.length || !within(d, discs[discs.length - 1])) discs.push(d);
  }
  return discs;
}

/**
 * Returns where the left and the right edge of the band between discs a and b touch them, as directions from each
 * centre: an edge touches both discs in the same direction n. For the direction u from a to b, a distance d, the edge
 * makes n·u = (ra - rb) / d, so n is that much along u and the rest of one unit across it.
 */
function edges([ax, ay, ar]: Disc, [bx, by, br]: Disc): [Direction, Direction] {
  const d = Math.hypot(bx - ax, by - ay),
    [ux, uy] = [(bx - ax) / d, (by - ay) / d],
    along = (ar - br) / d,
    across = Math.sqrt(1 - along * along);
  return [
    [along * ux - across * uy, along * uy + across * ux],
    [along * ux + across * uy, along * uy - across * ux],
  ];
}

// Fills the rings, less the cuts. With cuts, the fill is drawn on a layer of its own, so that the cuts take away only
// the fill and not the ink under it.
function filled(c: Ctx, color: string, rings: Point[][], cuts: Cut[]): void {
  const fill = (x: Ctx) => {
    x.fillStyle = color;
    x.beginPath();
    for (const r of rings) {
      x.moveTo(r[0][0], r[0][1]);
      for (const [px, py] of r) x.lineTo(px, py);
      x.closePath();
    }
    x.fill("evenodd");
  };
  if (!cuts.length) return fill(c);
  layered(c, rings, 0, (l) => {
    fill(l);
    rubOut(l, cuts);
  });
}

// Has `paint` draw on a layer of its own, which covers `points` widened by `pad` page units, and then lays the layer
// on c at c's own opacity. So where `paint` draws over its own ink or rubs ink out, only the layer changes.
function layered(c: Ctx, points: Point[][], pad: number, paint: (l: Ctx) => void): void {
  // the layer's box on the canvas, in the canvas's pixels
  const t = c.getTransform(),
    grow = pad * Math.hypot(t.a, t.b);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of points)
    for (const [px, py] of p) {
      const x = t.a * px + t.c * py + t.e,
        y = t.b * px + t.d * py + t.f;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
  [x0, y0] = [Math.max(0, Math.floor(x0 - grow)), Math.max(0, Math.floor(y0 - grow))];
  [x1, y1] = [Math.min(c.canvas.width, Math.ceil(x1 + grow)), Math.min(c.canvas.height, Math.ceil(y1 + grow))];
  if (x1 <= x0 || y1 <= y0) return;
  const layer = new OffscreenCanvas(x1 - x0, y1 - y0),
    l = layer.getContext("2d")!;
  l.setTransform(t.a, t.b, t.c, t.d, t.e - x0, t.f - y0);
  paint(l);
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(layer, x0, y0);
  c.restore();
}
