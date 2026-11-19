/**
 * The paint swirl: three slimes in the pens' sky, purple and pink, oozing over each other and mixing where they
 * overlap, as wet paint does, inside an ink outline that the page shows only when it chooses. Each slime is a smooth closed curve through seven points, and each point drifts in and
 * out on its own slow rhythm, so the shape never repeats. The swirl swells and ripples with a level from 0, quiet, to
 * 1, loud, such as the loudness of the person's voice. Under reduced motion it holds still and only swells.
 */
import { COLORS } from "../paint/constants.ts";

const INK = "#44423d";
const POINTS = 7;
const SLIMES = [
  { color: COLORS.sky, size: 10, at: (t: number) => [-3 + 1.5 * Math.sin(t * 0.3), -1] },
  { color: COLORS.purple, size: 8.5, at: (t: number) => [4, -2 + 1.5 * Math.cos(t * 0.25)] },
  { color: COLORS.pink, size: 8, at: (t: number) => [1 + 1.5 * Math.sin(t * 0.35), 4] },
];

// Each point's rhythm: two phases and two speeds.
const rhythm = () =>
  Array.from({ length: POINTS }, () => ({
    a: Math.random() * 6.28,
    b: Math.random() * 6.28,
    f: 0.35 + 0.25 * Math.random(),
    g: 0.2 + 0.2 * Math.random(),
  }));

/** Returns the SVG path of a slime `size` units across centred at (x, y), at time t, swollen by `level`. */
function slime(beat: ReturnType<typeof rhythm>, size: number, [x, y]: number[], t: number, level: number): string {
  const points = beat.map((p, i) => {
    const angle = (i / POINTS) * 2 * Math.PI,
      r =
        size +
        1.6 * (1.2 * Math.sin(t * p.f + p.a) + 0.8 * Math.sin(t * p.g * 1.7 + p.b)) +
        level * (4 + 3.5 * Math.sin(t * 6 + i * 1.9));
    return [x + Math.cos(angle) * r, y + Math.sin(angle) * r * 0.92 + 1];
  });
  // a closed Catmull-Rom curve through the points, as cubic Béziers
  const at = (i: number) => points[(i + POINTS) % POINTS],
    f = (n: number) => n.toFixed(2);
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 0; i < POINTS; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + "Z";
}

/**
 * Draws the paint swirl in `svg` about 60 times a second, swollen by what `level` returns at each picture, until the
 * returned function is called.
 */
export function swirl(svg: SVGSVGElement, level: () => number): () => void {
  svg.setAttribute("viewBox", "-24 -24 48 48"); // room for the slimes to swell to their loudest
  // the paths are made once and only reshaped, so that a press and its let-go land on the same element
  svg.innerHTML =
    `<g style="isolation:isolate">${SLIMES.map((s) => `<path fill="${s.color}" style="mix-blend-mode:multiply"/>`).join("")}</g>` +
    `<path class="outline" fill="none" stroke="${INK}" stroke-width="2"/>`;
  const paths = [...svg.querySelectorAll("path")],
    beats = SLIMES.map(rhythm),
    outline = rhythm(),
    still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let t = 0,
    swell = 0,
    frame = 0;
  const draw = () => {
    if (!still) t += 1 / 60;
    swell += (level() - swell) * 0.12; // eases toward the level, so the swirl does not jitter
    SLIMES.forEach((s, n) => paths[n].setAttribute("d", slime(beats[n], s.size, s.at(t), t, swell)));
    paths[SLIMES.length].setAttribute("d", slime(outline, 12, [0, 0], t, swell));
    frame = requestAnimationFrame(draw);
  };
  draw();
  return () => cancelAnimationFrame(frame);
}
