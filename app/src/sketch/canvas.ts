/**
 * A canvas that records shapes instead of painting pixels. p5 draws every shape by calling a 2D canvas's own
 * commands: begin a path, move, draw lines and curves along it, then fill it or stroke it. This module gives p5 a
 * context with those commands that keeps each path as points in page units, taken through the transform of the
 * moment, as a real canvas would place them. Each fill() then records a fill shape, and each stroke() a line shape.
 *
 * Anything that works on pixels, such as drawing an image, reading pixels, text or blending, throws, because the
 * page keeps shapes and not pixels.
 */
import type { Point } from "../paint/api.ts";
import { STEP } from "../paint/constants.ts";
import { spaced } from "../paint/path.ts";

/**
 * A shape as the canvas recorded it, in page units. A line holds the pieces it runs along and is `width` wide; a fill
 * holds its rings. `color` is "#rrggbb", and `opacity` runs from 0 to 1. `crayon` marks a line that colours a fill in.
 */
export interface Shape {
  kind: "line" | "fill";
  crayon?: true;
  color: string;
  opacity: number;
  width: number;
  points: Point[][];
}

/** An affine map [a, b, c, d, e, f]: the point (x, y) goes to (a x + c y + e, b x + d y + f), as a canvas has it. */
type Matrix = [number, number, number, number, number, number];

const PIXELS = "draws pixels, which the page does not keep: draw with shapes";

/** A path's commands, kept as they were given, so that a context can follow them under its own transform. */
export class RecordedPath {
  commands: [string, number[]][] = [];

  constructor(from?: RecordedPath) {
    if (from instanceof RecordedPath) this.commands = from.commands.slice();
  }
  addPath(other: RecordedPath): void {
    this.commands.push(...other.commands);
  }
}
for (const name of ["moveTo", "lineTo", "closePath", "quadraticCurveTo", "bezierCurveTo", "arc", "ellipse", "rect"])
  Object.defineProperty(RecordedPath.prototype, name, {
    value(this: RecordedPath, ...args: number[]) {
      this.commands.push([name, args]);
    },
  });

/** A piece of a path: its points in page units, and whether closePath() closed it. */
type Piece = Point[] & { closed?: boolean };

/**
 * The part of CanvasRenderingContext2D that p5 uses to draw shapes. The shapes it records go to `sink`. Each
 * property p5 reads and this class does not have is a command that works on pixels, and calling it throws.
 */
export class Recorder {
  fillStyle = "#ffffff";
  strokeStyle = "#000000";
  lineWidth = 1;
  lineCap = "round";
  lineJoin = "round";
  globalAlpha = 1;
  miterLimit = 10;
  font = "10px sans-serif";
  textAlign = "start";
  textBaseline = "alphabetic";
  imageSmoothingEnabled = true;
  private m: Matrix = [1, 0, 0, 1, 0, 0];
  private path: Piece[] = [];
  private piece: Piece | null = null;
  private saved: { m: Matrix; style: Record<string, unknown> }[] = [];
  private static STYLE = ["fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "globalAlpha"] as const;

  constructor(
    readonly canvas: object,
    private sink: (shape: Shape) => void,
  ) {
    return new Proxy(this, {
      get: (t, k) => (k in t ? t[k as keyof Recorder] : refuse(k)),
      set: (t, k, v) => {
        if (k === "globalCompositeOperation" && v !== "source-over") throw new Error(PIXELS);
        if (k === "filter" && v !== "none") throw new Error(PIXELS);
        (t as unknown as Record<string | symbol, unknown>)[k] = v;
        return true;
      },
    });
  }

  save(): void {
    this.saved.push({ m: [...this.m], style: Object.fromEntries(Recorder.STYLE.map((k) => [k, this[k]])) });
  }
  restore(): void {
    const top = this.saved.pop();
    if (!top) return;
    this.m = top.m;
    Object.assign(this, top.style);
  }
  setTransform(a: number | DOMMatrix2DInit, b = 0, c = 0, d = 1, e = 0, f = 0): void {
    this.m = typeof a === "number" ? [a, b, c, d, e, f] : [a.a ?? 1, a.b ?? 0, a.c ?? 0, a.d ?? 1, a.e ?? 0, a.f ?? 0];
  }
  resetTransform(): void {
    this.m = [1, 0, 0, 1, 0, 0];
  }
  getTransform(): DOMMatrix2DInit {
    const [a, b, c, d, e, f] = this.m;
    return { a, b, c, d, e, f };
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const [p, q, r, s, t, u] = this.m;
    this.m = [p * a + r * b, q * a + s * b, p * c + r * d, q * c + s * d, p * e + r * f + t, q * e + s * f + u];
  }
  translate(x: number, y: number): void {
    this.transform(1, 0, 0, 1, x, y);
  }
  rotate(angle: number): void {
    this.transform(Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0);
  }
  scale(x: number, y: number): void {
    this.transform(x, 0, 0, y, 0, 0);
  }

  beginPath(): void {
    this.path = [];
    this.piece = null;
  }
  moveTo(x: number, y: number): void {
    this.piece = [this.at(x, y)];
    this.path.push(this.piece);
  }
  lineTo(x: number, y: number): void {
    if (!this.piece) this.moveTo(x, y);
    else this.piece.push(this.at(x, y));
  }
  closePath(): void {
    if (!this.piece?.length) return;
    this.piece.closed = true;
    this.piece = [this.piece[0]];
    this.path.push(this.piece);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    const [x0, y0] = this.from();
    this.curve([x0, y0, cx, cy, x, y], (t) => {
      const u = 1 - t;
      return [u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y];
    });
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    const [x0, y0] = this.from();
    this.curve([x0, y0, c1x, c1y, c2x, c2y, x, y], (t) => {
      const u = 1 - t,
        [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      return [a * x0 + b * c1x + c * c2x + d * x, a * y0 + b * c1y + c * c2y + d * y];
    });
  }
  arc(x: number, y: number, r: number, from: number, to: number, ccw = false): void {
    this.ellipse(x, y, r, r, 0, from, to, ccw);
  }
  ellipse(x: number, y: number, rx: number, ry: number, turn: number, from: number, to: number, ccw = false): void {
    let sweep = to - from;
    if (Math.abs(sweep) >= 2 * Math.PI) sweep = ccw ? -2 * Math.PI : 2 * Math.PI;
    else if (!ccw && sweep < 0) sweep += 2 * Math.PI;
    else if (ccw && sweep > 0) sweep -= 2 * Math.PI;
    const n = this.steps(Math.abs(sweep) * Math.max(rx, ry)),
      [cos, sin] = [Math.cos(turn), Math.sin(turn)];
    for (let i = 0; i <= n; i++) {
      const t = from + (sweep * i) / n,
        [ex, ey] = [rx * Math.cos(t), ry * Math.sin(t)];
      this.lineTo(x + ex * cos - ey * sin, y + ex * sin + ey * cos);
    }
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }
  /**
   * Adds a box with round corners to the path. `radii` is one radius for every corner, or a list of 1 to 4 as a
   * canvas takes it: [all], [top-left and bottom-right, the other two], [top-left, top-right and bottom-left,
   * bottom-right] or [top-left, top-right, bottom-right, bottom-left]. No radius is more than half the box's side.
   */
  roundRect(x: number, y: number, w: number, h: number, radii: number | number[] = 0): void {
    if (w < 0) [x, w] = [x + w, -w];
    if (h < 0) [y, h] = [y + h, -h];
    const [a, b = a, c = a, d = b] = typeof radii === "number" ? [radii] : radii,
      [tl, tr, br, bl] = [a, b, c, d].map((r) => Math.max(0, Math.min(r, w / 2, h / 2))),
      q = Math.PI / 2;
    this.moveTo(x + tl, y);
    this.ellipse(x + w - tr, y + tr, tr, tr, 0, -q, 0);
    this.ellipse(x + w - br, y + h - br, br, br, 0, 0, q);
    this.ellipse(x + bl, y + h - bl, bl, bl, 0, q, 2 * q);
    this.ellipse(x + tl, y + tl, tl, tl, 0, 2 * q, 3 * q);
    this.closePath();
  }

  /** Records the inside of the path, or of `given`, as a fill shape. */
  fill(given?: RecordedPath | string): void {
    if (given instanceof RecordedPath) return this.follow(given, () => this.fill());
    const rings = this.path.filter((p) => p.length > 2);
    if (rings.length) this.record("fill", this.fillStyle, 0, rings);
  }
  /** Records the line along the path, or along `given`, as a line shape. */
  stroke(given?: RecordedPath): void {
    if (given instanceof RecordedPath) return this.follow(given, () => this.stroke());
    const pieces = this.path.filter((p) => p.length > 1).map((p) => spaced(p.closed ? [...p, p[0]] : p, STEP));
    // a point, which p5 draws as a line too short to see, is a dot as wide as the line
    if (!pieces.length && this.path.some((p) => p.length)) pieces.push([this.path[0][0], this.path[0][0]]);
    if (pieces.length) this.record("line", this.strokeStyle, this.lineWidth * this.stretch(), pieces);
  }
  /** Records a box filled with fillStyle, as a fill shape. */
  fillRect(x: number, y: number, w: number, h: number): void {
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
    this.beginPath();
  }
  clearRect(): void {} // the page has no pixels to clear
  clip(): void {
    throw new Error("clips, which the page cannot do: draw only what should show");
  }
  setLineDash(): void {}
  getLineDash(): number[] {
    return [];
  }

  // Returns the point (x, y) under the transform of the moment.
  private at(x: number, y: number): Point {
    const [a, b, c, d, e, f] = this.m;
    return [a * x + c * y + e, b * x + d * y + f];
  }
  // Returns the last point of the path, back in the units of the transform of the moment.
  private from(): Point {
    if (!this.piece) return [0, 0];
    const [a, b, c, d, e, f] = this.m,
      det = a * d - b * c,
      [x, y] = this.piece[this.piece.length - 1];
    return [(d * (x - e) - c * (y - f)) / det, (a * (y - f) - b * (x - e)) / det];
  }
  // Returns how many times longer the transform makes a length, on average over directions.
  private stretch(): number {
    const [a, b, c, d] = this.m;
    return Math.sqrt(Math.abs(a * d - b * c));
  }
  // Returns how many straight steps to draw a curve `length` long with, in the units of the transform.
  private steps(length: number): number {
    return Math.min(400, Math.max(8, Math.ceil((length * this.stretch()) / 2)));
  }
  // Adds a curve to the path, with at(t) its point at t from 0 to 1, and its control points as [x0, y0, x1, ...].
  private curve(controls: number[], at: (t: number) => Point): void {
    let length = 0;
    for (let i = 2; i < controls.length; i += 2)
      length += Math.hypot(controls[i] - controls[i - 2], controls[i + 1] - controls[i - 1]);
    const n = this.steps(length);
    for (let i = 1; i <= n; i++) this.lineTo(...at(i / n));
  }
  // Has `paint` paint a recorded path, followed under the transform of the moment, and keeps the context's own path.
  private follow(given: RecordedPath, paint: () => void): void {
    const [path, piece] = [this.path, this.piece];
    this.beginPath();
    for (const [name, args] of given.commands) (this[name as keyof this] as (...a: number[]) => void)(...args);
    paint();
    [this.path, this.piece] = [path, piece];
  }
  // Sends a shape to the sink, in its colour, as solid as the colour and globalAlpha make it.
  private record(kind: Shape["kind"], style: string, width: number, points: Point[][]): void {
    const { color, alpha } = solid(style);
    const shape = { kind, color, opacity: alpha * this.globalAlpha, width, points: points.map((p) => p.slice()) };
    if (shape.opacity > 0) this.sink(shape);
  }
}

// Throws for a command of a real canvas that the recorder does not have: every one of them works on pixels.
function refuse(k: string | symbol): never {
  throw new Error(`${PIXELS} (it called ${String(k)})`);
}

/**
 * Returns a CSS colour as p5 gives it, "#rgb", "#rrggbb", "rgb(r, g, b)" or "rgba(r, g, b, a)", as "#rrggbb" and how
 * solid it is from 0 to 1. Throws for any other colour, such as a gradient.
 */
export function solid(style: unknown): { color: string; alpha: number } {
  const s = String(style).trim().toLowerCase(),
    hex = (n: number) =>
      Math.round(Math.max(0, Math.min(255, n)))
        .toString(16)
        .padStart(2, "0");
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return { color: `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`, alpha: 1 };
  if (/^#[0-9a-f]{6}$/.test(s)) return { color: s, alpha: 1 };
  m = /^rgba?\(([^,]+),([^,]+),([^,)]+)(?:,([^)]+))?\)$/.exec(s);
  if (m) {
    const [r, g, b, a] = m.slice(1).map((v) => (v === undefined ? 1 : Number(v)));
    if ([r, g, b, a].every(Number.isFinite))
      return { color: `#${hex(r)}${hex(g)}${hex(b)}`, alpha: Math.max(0, Math.min(1, a)) };
  }
  throw new Error(`the colour ${String(style)} is not one the page can draw: give a colour such as "#6b5a3a"`);
}
