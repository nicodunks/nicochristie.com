/**
 * Reads what the agent's code gave a function. The code is not trusted to give what the contract says, so every
 * value is checked as it is read: each reader returns the value, or throws an Error that names the function and says
 * what the value must be.
 */
import type { Box, Color, Named, Point, Pose } from "./api.ts";
import { COLORS, FAR } from "./constants.ts";

const LONGEST_NAME = 60; // the most characters the name of a part or of an animation may have
const POSE = ["dx", "dy", "scale", "scaleX", "scaleY", "rotate", "opacity"] as const; // a pose's numbers
const ORIGINS = ["center", "top", "bottom", "left", "right"];

/** The readers of one call: `fn` is the function's name, and `given` is what it was called with. */
export class Given {
  private o: Record<string, unknown>;

  constructor(
    private fn: string,
    given: unknown,
  ) {
    this.o = (given && typeof given === "object" ? given : this.fail("takes one object")) as Record<string, unknown>;
  }

  /** Throws an Error that names the function. */
  fail(what: string): never {
    throw new Error(`${this.fn}: ${what}`);
  }

  /** Returns whether the key was given. */
  has(key: string): boolean {
    return this.o[key] !== undefined;
  }

  /** Returns a finite number within FAR of 0, or `fallback` if the key was not given. */
  num(key: string, fallback?: number): number {
    return this.number(this.o[key] ?? fallback, key);
  }

  /** Returns one of the keys of `of`, or `fallback` if the key was not given. */
  one<T extends string>(key: string, of: Record<T, unknown>, fallback?: T): T {
    const v = this.o[key] ?? fallback;
    return typeof v === "string" && Object.hasOwn(of, v)
      ? (v as T)
      : this.fail(`${key} must be one of ${Object.keys(of).join(", ")}`);
  }

  /**
   * Returns a colour: a name of COLORS, or "#rrggbb" in lower case, which is the name if it is a colour of COLORS.
   * Returns `fallback` if the key was not given.
   */
  color(key: string, fallback?: Color): Color {
    const v = this.o[key] ?? fallback;
    if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) {
      const hex = v.toLowerCase();
      return (Object.keys(COLORS) as Named[]).find((name) => COLORS[name] === hex) ?? (hex as Color);
    }
    if (typeof v === "string" && Object.hasOwn(COLORS, v)) return v as Color;
    return this.fail(`${key} must be one of ${Object.keys(COLORS).join(", ")}, or a colour such as "#6b5a3a"`);
  }

  /** Returns how solid ink is, from 0 to 1: the value under `opacity`, or 1 if it was not given. */
  opacity(): number {
    const v = this.num("opacity", 1);
    return v >= 0 && v <= 1 ? v : this.fail("opacity must be from 0 to 1");
  }

  /** Returns a text with something in it. */
  text(key: string): string {
    const v = this.o[key];
    return typeof v === "string" && v.trim() ? v : this.fail(`${key} must be a text with something in it`);
  }

  /** Returns a name: a text of at most LONGEST_NAME characters. */
  name(key: string): string {
    const v = this.text(key);
    return v.length <= LONGEST_NAME ? v : this.fail(`${key} must be at most ${LONGEST_NAME} characters`);
  }

  /** Returns the name of a part, such as "tree" or "tree.leaf3": names joined by dots. Undefined if not given. */
  part(): string | undefined {
    if (!this.has("part")) return undefined;
    const v = this.name("part");
    return v.split(".").every((word) => word.trim()) ? v : this.fail('part must be a name such as "tree.leaf3"');
  }

  /** Returns a box with a width and a height above 0: the value under `key`, or the object itself. */
  box(key?: string): Box {
    const v = key === undefined ? this.o : this.o[key],
      b = (v && typeof v === "object" ? v : this.fail(`${key} must be a box {x, y, width, height}`)) as Record<
        string,
        unknown
      >;
    const box = {
      x: this.number(b.x, "x"),
      y: this.number(b.y, "y"),
      width: this.number(b.width, "width"),
      height: this.number(b.height, "height"),
    };
    return box.width > 0 && box.height > 0 ? box : this.fail("width and height must be more than 0");
  }

  /** Returns a list of at least `least` points. */
  points(key: string, least: number): Point[] {
    const v = this.o[key];
    return Array.isArray(v) && v.length >= least
      ? v.map((p) => this.point(p, key))
      : this.fail(`${key} must be a list of at least ${least} points [x, y]`);
  }

  /** Returns a list of at least one list of at least `least` points. */
  lines(key: string, least: number): Point[][] {
    const v = this.o[key],
      ok = Array.isArray(v) && v.length && v.every((line) => Array.isArray(line) && line.length >= least);
    return ok
      ? (v as unknown[][]).map((line) => line.map((p) => this.point(p, key)))
      : this.fail(`${key} must be a list of lists of at least ${least} points [x, y]`);
  }

  /** Returns a list with something in it, unchecked inside. */
  list(key: string): unknown[] {
    const v = this.o[key];
    return Array.isArray(v) && v.length ? v : this.fail(`${key} must be a list with something in it`);
  }

  /** Returns the ink that the key `key` names, as ids and names of parts: at least one. */
  which(key = "ink"): (number | string)[] {
    const v = this.o[key],
      named = (Array.isArray(v) ? v : [v]).map((w) =>
        w && typeof w === "object" ? (w as { id?: unknown }).id : w,
      ) as unknown[];
    return named.length && named.every((w) => typeof w === "number" || (typeof w === "string" && w))
      ? (named as (number | string)[])
      : this.fail(`${key} must be an id, the name of a part, an entry of ink(), or a list of these`);
  }

  /** Returns a pose with only the fields a pose has: the value under `key`, or the object itself. */
  pose(key?: string): Pose {
    const v = key === undefined ? this.o : this.o[key],
      given = (v && typeof v === "object" ? v : this.fail("the pose must be an object, such as {dx: 10}")) as Record<
        string,
        unknown
      >;
    const pose: Pose = {};
    for (const [k, value] of Object.entries(given)) {
      if (k === "origin")
        pose.origin = ORIGINS.includes(value as string) ? (value as Pose["origin"]) : this.point(value, "origin");
      else if ((POSE as readonly string[]).includes(k)) pose[k as (typeof POSE)[number]] = this.number(value, k);
      else this.fail(`a pose may hold only ${POSE.join(", ")} and origin, not ${k}`);
    }
    return pose;
  }

  /** Returns a finite number within FAR of 0, or undefined if the key was not given. */
  optional(key: string): number | undefined {
    return this.has(key) ? this.num(key) : undefined;
  }

  /** Returns the value under `key` as it is, unchecked. */
  value(key: string): unknown {
    return this.o[key];
  }

  // Returns v if it is a finite number within FAR of 0.
  private number(v: unknown, key: string): number {
    return typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= FAR
      ? v
      : this.fail(`${key} must be a number from -${FAR} to ${FAR}`);
  }

  // Returns v if it is a point [x, y].
  private point(v: unknown, key: string): Point {
    return Array.isArray(v) && v.length === 2
      ? [this.number(v[0], key), this.number(v[1], key)]
      : this.fail(`${key} must be a point [x, y]`);
  }
}
