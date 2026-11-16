/**
 * The agent's handwriting: it writes a line of text with the pen, letter by letter, and lays out maths given in
 * LaTeX notation. No two letters come out the same, as with a hand.
 */
import type { Box, Point } from "./api.ts";
import HAND from "../../hand.json";
import { flatten } from "./path.ts";

// For each character: w, how far the pen moves on after it, and d, its pen strokes as SVG paths. In these paths a
// capital is 100 high, the line the letters stand on is at y = 100, and the tail of a g or a y reaches down to y = EM.
type Letter = { w: number; d: string[] };
const LETTERS = HAND as Record<string, Letter>;
const EM = 135;

// The LaTeX names of characters in the handwriting. A name that is not here is written out, as \log is.
const NAMES: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  eta: "η",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  phi: "φ",
  omega: "ω",
  Delta: "Δ",
  Sigma: "Σ",
  Omega: "Ω",
  sum: "∑",
  prod: "∏",
  int: "∫",
  infty: "∞",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  pm: "±",
  cdot: "·",
  times: "×",
  div: "÷",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  partial: "∂",
  nabla: "∇",
  in: "∈",
  ldots: "...",
  dots: "...",
  cdots: "...",
  quad: "  ",
};

/** A written line: the points along each stroke of the pen, and the width of the pen's line. */
interface Written {
  pieces: Point[][];
  width: number;
}

// A laid-out box of letters, in letter units with the line the letters stand on at y = 0: w is its width, up how far
// it reaches above the line and down how far below. Each part is one character or one drawn sign: the strokes
// l.d, moved to (x, y) and scaled by s.
interface Laid {
  w: number;
  up: number;
  down: number;
  parts: { l: Letter; x: number; y: number; s: number }[];
}

/** Returns the strokes that write a line of text in its box: as large as fits, and centred in it. */
export function written(text: string, b: Box, seed: number): Written {
  const line = laid(text),
    tall = line.up + line.down;
  const k = Math.min(b.height / tall, line.w ? b.width / line.w : Infinity); // page units per letter unit
  const left = b.x + (b.width - line.w * k) / 2,
    base = b.y + (b.height - tall * k) / 2 + line.up * k;
  const random = mulberry(seed),
    vary = (by: number) => (random() * 2 - 1) * by; // the same wobble every time for the same seed
  const pieces: Point[][] = [];
  for (const p of line.parts) {
    const grow = (1 + vary(0.08)) * p.s,
      lean = 0.08 + vary(0.07),
      drop = vary(4) * p.s;
    for (const d of p.l.d) {
      const wave = vary(4),
        step = 2 / (k * p.s); // one point every 2 page units
      for (const piece of flatten(d, step))
        pieces.push(
          piece.map(([px, py], n): Point => {
            const far = n * step; // how far along the stroke, in letter units
            const lx = p.x + (px + (100 - py) * lean + 1.8 * Math.sin(wave + far / 24)) * grow;
            const ly = p.y + (py - 100 + 1.8 * Math.cos(wave * 1.7 + far / 31)) * grow + drop;
            return [left + lx * k, base + ly * k];
          }),
        );
    }
  }
  return { pieces, width: Math.max(1, Math.min(3, (k * EM) / 14)) };
}

// Lays out one line of text that may hold maths in LaTeX notation: x^2, z_i, \frac{a}{b}, \sqrt{x}, \hat{y}, \bar{x}
// and names such as \alpha and \sum.
function laid(text: string): Laid {
  const chars = [...text];
  let i = 0;
  const SHORT = new Set(" acegmnopqrsuvwxyzαγεημπρστω.,:;-+=~·"), // the characters that are 62 high, not 100
    TAILED = new Set("gjpqyβγημρφ,;()[]|∫∑∏"); // the characters that reach below the line
  const letter = (ch: string): Laid => ({
    w: (LETTERS[ch] ?? LETTERS[" "]).w,
    up: SHORT.has(ch) ? 62 : 100,
    down: TAILED.has(ch) ? 35 : 0,
    parts: [{ l: LETTERS[ch] ?? LETTERS[" "], x: 0, y: 0, s: 1 }],
  });
  const sign = (d: string) => [{ l: { w: 0, d: [d] }, x: 0, y: 0, s: 1 }]; // one drawn stroke, as parts
  const put = (b: Laid, dx: number, dy: number, s: number) =>
    b.parts.map((p) => ({ l: p.l, x: dx + p.x * s, y: dy + p.y * s, s: p.s * s }));
  const row = (boxes: Laid[]): Laid =>
    boxes.reduce<Laid>(
      (r, b) => ({
        w: r.w + b.w,
        up: Math.max(r.up, b.up),
        down: Math.max(r.down, b.down),
        parts: [...r.parts, ...put(b, r.w, 0, 1)],
      }),
      { w: 0, up: 0, down: 0, parts: [] },
    );
  const word = (s: string) => row([...s].map(letter));

  // base with a smaller box above its right shoulder, below its right foot, or both
  function scripted(base: Laid, above?: Laid, below?: Laid): Laid {
    const S = 0.6,
      b: Laid = { w: 0, up: base.up, down: base.down, parts: [...base.parts] };
    if (above) {
      const dy = -base.up / 2;
      b.parts.push(...put(above, base.w + 3, dy, S));
      b.w = above.w * S;
      b.up = Math.max(b.up, above.up * S - dy);
    }
    if (below) {
      const dy = Math.max(22, base.down - 13);
      b.parts.push(...put(below, base.w + 3, dy, S));
      b.w = Math.max(b.w, below.w * S);
      b.down = Math.max(b.down, below.down * S + dy);
    }
    b.w += base.w + 6;
    return b;
  }

  // top over bottom, with a bar between them at the height of a minus sign
  function fraction(top: Laid, bottom: Laid): Laid {
    const S = 0.75,
      BAR = -38,
      w = Math.max(top.w, bottom.w) * S + 20;
    const ty = BAR - 18 - top.down * S,
      by = BAR + 18 + bottom.up * S;
    const parts = [
      ...put(top, (w - top.w * S) / 2, ty, S),
      ...put(bottom, (w - bottom.w * S) / 2, by, S),
      ...sign(`M 4 62 L ${w - 4} 62`),
    ];
    return { w, up: top.up * S - ty, down: bottom.down * S + by, parts };
  }

  // inner under a root sign
  function root(inner: Laid): Laid {
    const top = 88 - inner.up,
      w = inner.w + 46;
    const d = `M 0 66 L 8 58 L 20 ${96 + inner.down} L 34 ${top} L ${w - 2} ${top}`;
    return { w, up: inner.up + 14, down: inner.down, parts: [...sign(d), ...put(inner, 38, 0, 1)] };
  }

  // inner with a hat or a bar over it
  function capped(inner: Laid, hat: boolean): Laid {
    const y = 90 - inner.up,
      mid = inner.w / 2;
    const d = hat ? `M ${mid - 14} ${y} L ${mid + 2} ${y - 14} L ${mid + 18} ${y}` : `M 6 ${y} L ${inner.w - 2} ${y}`;
    return { ...inner, up: inner.up + 26, parts: [...inner.parts, ...sign(d)] };
  }

  // one character, one {group} or one \command with what it takes
  function piece(): Laid {
    if (i >= chars.length) return row([]);
    const ch = chars[i++];
    if (ch === "{") return upTo("}");
    if (ch !== "\\") return letter(ch);
    const name = /^[a-zA-Z]+/.exec(chars.slice(i).join(""))?.[0];
    if (!name) return letter(" ,;:!".includes(chars[i]) ? (i++, " ") : (chars[i++] ?? " ")); // \, is a space, \_ is _
    i += name.length;
    if (name === "frac") return fraction(piece(), piece());
    if (name === "sqrt") return root(piece());
    if (name === "hat" || name === "bar") return capped(piece(), name === "hat");
    if (["text", "mathrm", "mathbf", "mathit", "operatorname"].includes(name)) return piece();
    if (name === "left" || name === "right") return row([]);
    return word(NAMES[name] ?? name);
  }

  // every piece up to the closing character, or up to the end of the text
  function upTo(close?: string): Laid {
    const boxes: Laid[] = [];
    while (i < chars.length && chars[i] !== close) {
      if (chars[i] !== "^" && chars[i] !== "_") {
        boxes.push(piece());
        continue;
      }
      const base = boxes.pop() ?? row([]),
        script: Record<string, Laid> = {};
      while (chars[i] === "^" || chars[i] === "_") script[chars[i++]] = piece();
      boxes.push(scripted(base, script["^"], script["_"]));
    }
    i++;
    return row(boxes);
  }

  const line = upTo(undefined);
  return { ...line, up: Math.max(line.up, 100), down: Math.max(line.down, 35) }; // plain lines are all one height
}

/** Returns a function that gives the same numbers from 0 to 1 every time for the same seed (mulberry32). */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
