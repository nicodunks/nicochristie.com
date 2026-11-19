/**
 * The tool in the agent's hand. While the agent's new ink is revealed, a little hand-drawn tool rides the tip of the
 * line being drawn, as if an unseen hand held it: a pencil while the agent writes or strokes with brush, a crayon
 * while it colours a shape in or washes it with watercolour, and a felt pen for every other line. Each tool is painted in the colour of its ink, held at a slant, and rocks
 * a little as it goes. It lifts and glides when it moves to a new mark, and fades away once no ink is being drawn.
 */
import type { Point } from "../paint/api.ts";
import type { XY } from "../paint/box.ts";
import { css } from "../paint/constants.ts";
import type { Mark } from "../paint/sheet.ts";
import { view } from "./view.ts";

const nib = document.getElementById("nib")!,
  tool = nib.querySelector("use")!;
let held: Mark | undefined, // the mark the tool is drawing
  moved = false; // whether the tool has drawn since the last picture

/**
 * Puts the tool on the mark, at the point a share k of the way along a line, or in the middle of a fill or a brush
 * mark, which appear whole. A brush's washes and massing get the crayon, and its strokes and hatching the pencil.
 */
export function draw(m: Mark, k: number): void {
  const wash =
    m.kind === "fill" ||
    (m.kind === "line" && m.crayon) ||
    (m.kind === "brush" && !["stroke", "hatch"].includes(m.paint.kind));
  const name = wash ? "crayon" : m.made === "write" || m.kind === "brush" ? "pencil" : "pen",
    [x, y] =
      m.kind === "line"
        ? along(m.pieces, k)
        : middle(m.kind === "fill" ? m.rings.flat() : m.kind === "image" ? m.at : m.points.flat());
  if (m !== held) {
    // a new mark: the hand lifts the tool and glides it there
    nib.classList.add("up");
    setTimeout(() => nib.classList.remove("up"), 120);
    held = m;
  }
  tool.setAttribute("href", `#t-${name}`);
  nib.style.color = css(m.color);
  nib.style.transform = `translate(${(x - view.left) * view.scale}px, ${(y - view.above) * view.scale}px)`;
  nib.classList.add("on");
  moved = true;
}

/** Called once a picture: fades the tool away if it drew nothing since the last picture. */
export function rest(): void {
  if (!moved) lift();
  moved = false;
}

/** Fades the tool away. */
export function lift(): void {
  nib.classList.remove("on");
  held = undefined;
}

/** Returns the point a share k of the way along the pieces, by length. */
function along(pieces: XY[][], k: number): Point {
  const steps = pieces.flatMap((p) => p.slice(1).map((q, i): [XY, XY] => [p[i], q])),
    lengths = steps.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
  let left = k * lengths.reduce((s, d) => s + d, 0);
  for (let i = 0; i < steps.length; i++) {
    if (left <= lengths[i]) {
      const [a, b] = steps[i],
        t = lengths[i] ? left / lengths[i] : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    left -= lengths[i];
  }
  const [x, y] = pieces[pieces.length - 1]?.at(-1) ?? [0, 0];
  return [x, y];
}

/** Returns the middle of the box around the points. */
function middle(points: Point[]): Point {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
