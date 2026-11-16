/**
 * brush, as the agent's code calls it. p5 draws each brush shape's outline on the pretend page, which turns it into
 * points in page units through p5's transform, and the outline becomes one ink of up to five brush shapes, one for
 * each medium that is on: a flat wash, a watercolour wash, massing, hatching and a stroke, in that order, so that the
 * stroke lies on top. The page paints each brush shape with p5.brush. Brush names and amounts are checked again where
 * the shapes become ink, since the agent's code is not trusted.
 */
import type { Point } from "../paint/api.ts";
import type * as BrushApi from "../paint/brushapi.ts";
import { BRUSHES } from "../paint/brushpaint.ts";
import { AGENT_COLOR, css } from "../paint/constants.ts";
import { madeBrush } from "../paint/ops.ts";
import type { Brush, BrushPaint, Made } from "../paint/sheet.ts";
import type { Shape } from "./canvas.ts";

/** A brush shape, as a "draw" op holds it: what p5.brush is to paint, in which colour, and where, in page units. */
export interface BrushShape {
  kind: "brush";
  paint: BrushPaint;
  color: string;
  opacity: number;
  points: Point[][];
}

/** A colour and an opacity from 0 to 1. */
interface Paint {
  color: string;
  opacity: number;
}

/**
 * brush's settings: the brush last set, which strokes and hatches, and its paint and weight; whether it strokes; its
 * hatching, massing, flat wash and watercolour wash, each if it is on; and how its watercolour bleeds, shows the
 * paper's grain and dries at its edge.
 */
export interface Settings {
  brush: Paint & { brush: Brush; weight: number };
  stroke: boolean;
  hatch?: { distance: number; angle: number; rand: number; gradient: number; continuous: boolean };
  mass?: Paint & { brush: Brush; precision: number; strength: number; gradient: number; scribble: boolean };
  flat?: Paint;
  fill?: Paint;
  bleed: number;
  inward: boolean;
  texture: number;
  border: number;
}

/** brush's settings as a turn starts them: a stroke of "HB" in the agent's colour and no other media. */
export const START: Settings = {
  brush: { brush: "HB", color: css(AGENT_COLOR), opacity: 1, weight: 1 },
  stroke: true,
  bleed: 0.07,
  inward: false,
  texture: 0.8,
  border: 0.4,
};

/** What brush needs of the sketch. */
interface Host {
  /** Calls p5's own function `name`. */
  call(name: string, ...args: unknown[]): unknown;
  /** Returns the shapes p5 drew while `fn` ran, which do not become ink. */
  record(fn: () => void): Shape[];
  /** Makes the brush shapes one call drew into one ink, made by `made`. Returns the ink's id. */
  draw(made: string, shapes: BrushShape[]): number;
  /** Returns a colour the agent gave as "#rrggbb" and an opacity from 0 to 1. Throws if it is not a colour. */
  colorOf(given: unknown): { color: string; alpha: number };
}

/** Returns brush for the agent's code and its settings of the moment, `now`, which the sketch may read and replace. */
export function brushing(host: Host): { brush: typeof BrushApi.brush; now: Settings } {
  const { call } = host;
  let now = START;
  const made: Record<string, Made> = {}; // the brushes the agent's code made, by name, which push() and pop() do not keep

  /** Returns the brush called `name` for brush's function `fn`. Throws if there is none. */
  const named = (fn: string, name: unknown): Brush => {
    if (typeof name === "string" && Object.hasOwn(BRUSHES, name)) return name as keyof typeof BRUSHES;
    if (typeof name === "string" && Object.hasOwn(made, name)) return made[name];
    const all = [...Object.keys(BRUSHES), ...Object.keys(made)].join(", ");
    throw new Error(
      `brush.${fn}: there is no brush ${JSON.stringify(name)}: give one of ${all}, or make it with brush.add`,
    );
  };

  /**
   * Returns the brush function `name`, which has p5 draw an outline with `outline` and makes it one ink of brush
   * shapes. The washes, massing and hatching need a closed outline. Returns undefined if nothing was drawn.
   */
  const shape =
    (name: string, closed: boolean, outline: (...args: never[]) => void) =>
    (...args: never[]): number | undefined => {
      try {
        const lines = host
          .record(() => {
            call("push");
            call("noFill");
            call("stroke", 0);
            call("strokeWeight", 1);
            try {
              outline(...args);
            } finally {
              call("pop");
            }
          })
          .filter((s) => s.kind === "line");
        if (!lines.length) return undefined;
        const { brush: by, stroke, hatch, mass, flat, fill } = now,
          points = lines.flatMap((l) => l.points),
          stretch = lines[0].width, // the outline was 1 wide, so this is how much p5's transform scales
          weight = by.weight * stretch,
          inked = { color: by.color, opacity: by.opacity, points },
          shapes: BrushShape[] = [];
        const add = (paint: BrushPaint, ink: Paint) => shapes.push({ kind: "brush", paint, ...ink, points });
        if (closed && flat) add({ kind: "flat" }, flat);
        if (closed && fill) {
          const { bleed, texture, border, inward } = now;
          add({ kind: "wash", bleed, texture, border, ...(inward && { inward: true as const }) }, fill);
        }
        if (closed && mass) {
          const { brush, precision, strength, gradient, scribble } = mass;
          add(
            { kind: "mass", brush, precision, strength, gradient, ...(scribble && { scribble: true as const }) },
            mass,
          );
        }
        if (closed && hatch)
          add({ kind: "hatch", brush: by.brush, weight, ...hatch, distance: hatch.distance * stretch }, inked);
        if (stroke) add({ kind: "stroke", brush: by.brush, weight }, inked);
        return shapes.length ? host.draw("brush." + name, shapes) : undefined;
      } catch (e) {
        throw new Error(`brush.${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

  /** Has p5 draw a shape through the points: closed, or as a curve that bends `curvature` from 0 to 1. */
  const through = (points: unknown, close: boolean, curvature = 0) => {
    if (!Array.isArray(points) || points.length < 2 || !points.every((p) => Array.isArray(p) && p.length >= 2))
      throw new Error("give a list of at least 2 points [x, y]");
    call("beginShape");
    if (curvature > 0) {
      call("curveTightness", 1 - Math.min(1, curvature));
      const ends = [points[0], ...points, points[points.length - 1]] as Point[];
      for (const [x, y] of ends) call("curveVertex", x, y);
    } else for (const [x, y] of points as Point[]) call("vertex", x, y);
    call("endShape", close ? "close" : undefined); // "close" is p5's CLOSE
  };

  /** Returns a number brush's function `name` was given for `what`, if it lies from `least` to `most`. Throws if not. */
  const number = (name: string, what: string, given: unknown, least: number, most: number): number => {
    if (typeof given !== "number" || !(given >= least && given <= most))
      throw new Error(`brush.${name}: ${what} must be a number from ${least} to ${most}`);
    return given;
  };

  /** Returns the options brush's function `name` was given as an object, or {} if none were. Throws if not an object. */
  const options = (name: string, given: unknown): Record<string, unknown> => {
    if (given === undefined) return {};
    if (given && typeof given === "object" && !Array.isArray(given)) return given as Record<string, unknown>;
    throw new Error(`brush.${name}: its options must be an object, such as {gradient: 0.3}`);
  };

  /** Returns a colour the agent gave, with `opacity` from 0 to 255 for brush's function `name` as a share of 1. */
  const paint = (name: string, color: unknown, opacity: unknown): Paint => ({
    color: host.colorOf(color).color,
    opacity: number(name, "opacity", opacity, 0, 255) / 255,
  });

  const brush = {
    add(name, given) {
      if (typeof name !== "string" || !name) throw new Error("brush.add: give the new brush a name");
      if (Object.hasOwn(BRUSHES, name)) throw new Error(`brush.add: "${name}" is one of p5.brush's own brushes`);
      made[name] = madeBrush("brush.add", given);
    },
    set(name, color, weight = 1) {
      const { color: c, alpha } = host.colorOf(color);
      now = {
        ...now,
        brush: {
          brush: named("set", name),
          color: c,
          opacity: alpha,
          weight: number("set", "weight", weight, 0.01, 100),
        },
        stroke: true,
      };
    },
    noStroke() {
      now = { ...now, stroke: false };
    },
    hatch(distance, angle = 45, given) {
      const o = options("hatch", given);
      if (o.continuous !== undefined && typeof o.continuous !== "boolean")
        throw new Error("brush.hatch: continuous must be true or false");
      now = {
        ...now,
        hatch: {
          distance: number("hatch", "distance", distance, 1, 1000),
          angle: number("hatch", "angle", angle, -360, 360),
          rand: number("hatch", "rand", o.rand ?? 0, 0, 1),
          gradient: number("hatch", "gradient", o.gradient ?? 0, 0, 1),
          continuous: o.continuous === true,
        },
      };
    },
    noHatch() {
      now = { ...now, hatch: undefined };
    },
    mass(name, color, given) {
      const o = options("mass", given),
        { color: c, alpha } = host.colorOf(color);
      if (o.style !== undefined && o.style !== "arcs" && o.style !== "scribble")
        throw new Error('brush.mass: style must be "arcs" or "scribble"');
      now = {
        ...now,
        mass: {
          brush: named("mass", name),
          color: c,
          opacity: alpha,
          precision: number("mass", "precision", o.precision ?? 0.5, 0, 1),
          strength: number("mass", "strength", o.strength ?? 1, 0, 1),
          gradient: number("mass", "gradient", o.gradient ?? 0, 0, 1),
          scribble: o.style === "scribble",
        },
      };
    },
    noMass() {
      now = { ...now, mass: undefined };
    },
    wash(color, opacity = 255) {
      now = { ...now, flat: paint("wash", color, opacity) };
    },
    noWash() {
      now = { ...now, flat: undefined };
    },
    fill(color, opacity = 150) {
      now = { ...now, fill: paint("fill", color, opacity) };
    },
    noFill() {
      now = { ...now, fill: undefined };
    },
    fillBleed(strength, direction = "out") {
      if (direction !== "out" && direction !== "in")
        throw new Error('brush.fillBleed: direction must be "out" or "in"');
      now = { ...now, bleed: number("fillBleed", "strength", strength, 0, 1), inward: direction === "in" };
    },
    fillTexture(strength, border = 0.4) {
      now = {
        ...now,
        texture: number("fillTexture", "strength", strength, 0, 1),
        border: number("fillTexture", "border", border, 0, 1),
      };
    },
    line: shape("line", false, (x1: number, y1: number, x2: number, y2: number) => call("line", x1, y1, x2, y2)),
    rect: shape("rect", true, (x: number, y: number, w: number, h: number) => call("rect", x, y, w, h)),
    circle: shape("circle", true, (x: number, y: number, r: number) => call("circle", x, y, 2 * r)),
    polygon: shape("polygon", true, (points: Point[]) => through(points, true)),
    spline: shape("spline", false, (points: Point[], curvature = 0.5) => through(points, false, curvature)),
  } as typeof BrushApi.brush;
  return {
    brush,
    get now() {
      return now;
    },
    set now(settings) {
      now = settings;
    },
  };
}
