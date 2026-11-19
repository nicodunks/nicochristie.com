/**
 * The paint contract carried out on a sheet. Each change to the page is an op: the name of what changes it, the id
 * the change was given, and the object that says what to do. apply() checks an op, changes the sheet, and returns what
 * it did, so that whoever shows the sheet can show the change.
 *
 * Most ops are calls of the contract's functions, such as erase or move, with the object the agent's code gave. The
 * agent's drawing is not: p5 works out each shape in the worker, so a "draw" op holds the shapes one call of a p5
 * function drew, and "write" and "background" ops hold the colours p5 had at that moment.
 *
 * The worker that runs the agent's code applies each op to its own copy of the sheet as the code calls it, and sends
 * the ops to the page, which applies them to the real sheet. Both sheets hold the same before the ops and apply the
 * same ops in the same order, so they come out the same. The page checks every op again, since it does not trust
 * the worker.
 */
import type * as Api from "./api.ts";
import type { Box, Pose } from "./api.ts";
import { colorAt } from "./color.ts";
import { BRUSHES, reach } from "./brushpaint.ts";
import { CLOSEST, WIDEST } from "./constants.ts";
import { written } from "./hand.ts";
import { mapper, matrix, thickness } from "./pose.ts";
import { Given } from "./read.ts";
import type { BrushName } from "./brushapi.ts";
import {
  type Animation,
  type Brush,
  type BrushMark,
  type BrushPaint,
  type Made,
  type Mark,
  type Sheet,
  even,
  under,
} from "./sheet.ts";

const LONGEST_MOVE = 10; // the most seconds a move may take
const LONGEST_STICKER = 16; // the most UTF-16 units a sticker's emoji may have
const PICTURE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/; // a picture as a data URL

/** The ops that make ink without needing the sheet: the shapes of a p5 call, handwriting, and a picture. */
type Inks = "draw" | "write" | "image";

/** The names of the ops: what changes the page. */
export type Fn =
  | Inks
  | "background"
  | "erase"
  | "move"
  | "copy"
  | "setPart"
  | "arrange"
  | "animate"
  | "retime"
  | "removeAnimation"
  | "show";

/** One call of a function that changes the page: `id` is the id of the ink it makes, if it makes ink. */
export interface Op {
  fn: Fn;
  id: number;
  given: unknown;
}

/**
 * What an op did to the sheet. "drew" put marks on it. "moved" took marks into the pose `to` about the box `about`,
 * which was the box around them before, to be shown over `seconds`. "showed" asks for the person's view to go to
 * `view`. "animated" put an animation on it, in place of `replaced` if one had its name. "changed" is anything else.
 */
export type Done =
  | { did: "drew"; marks: Mark[] }
  | { did: "moved"; marks: Mark[]; to: Pose; about: Box; seconds: number }
  | { did: "showed"; view: Pick<Box, "x" | "y" | "width"> }
  | { did: "animated"; animation: Animation; replaced?: Animation }
  | { did: "changed" };

/**
 * A picture of the page that the agent's code asked for: of the box with its left edge at `x`, its top at `y`, `width`
 * units wide and `height` units tall, with the animations as they show `t` seconds after they all start, or with the
 * ink at rest if `t` is left out.
 */
export interface Peek extends Box {
  t?: number;
}

/**
 * Each op that makes ink without the sheet: returns the marks it makes as ink `id`.
 *
 * "draw" is given what one call of a p5 function drew: `made`, the function's name, `part`, and `shapes`, each
 * {kind: "line" | "fill", color, opacity, width, points, crayon?} in page units, or a brush shape, as brushMark()
 * reads it. A line runs along its points' pieces, and a fill fills its points' rings. crayon: true marks a line that
 * colours a fill in. "write" is given a box, the text, and its colour, opacity
 * and part. "image" is given a box, `src`, the picture as a PNG, JPEG or WebP data URL, and its opacity and part.
 */
const INK: Record<Inks, (g: Given, id: number) => Mark[]> = {
  draw: (g, id) => {
    const made = g.name("made"),
      part = g.part();
    return g.list("shapes").map((given, i): Mark => {
      const s = new Given(made, given),
        mark = { id, by: "agent" as const, made, part, color: s.color("color"), opacity: s.opacity() },
        kind = s.one("kind", { line: 1, fill: 1, brush: 1 });
      if (kind === "fill") return { kind: "fill", ...mark, rings: s.lines("points", 3), cuts: [] };
      if (kind === "brush") return brushMark(made, s, { ...mark, seed: id * 1000 + i });
      const width = s.num("width");
      if (width <= 0) s.fail("its line must be wider than 0: give strokeWeight() more than 0");
      const crayon = s.has("crayon") && s.value("crayon") === true;
      return {
        kind: "line",
        ...mark,
        pieces: s.lines("points", 1).map((p) => even(p, width)),
        ...(crayon && { crayon: true as const }),
      };
    });
  },
  write: (g, id) => {
    const text = g.text("text"),
      { pieces, width } = written(text, g.box(), id);
    if (!pieces.length) return [];
    const mark = { id, by: "agent" as const, made: "write", part: g.part(), opacity: g.opacity() };
    return [{ kind: "line", ...mark, color: g.color("color"), text, pieces: pieces.map((p) => even(p, width)) }];
  },
  image: (g, id) => {
    const src = g.text("src"),
      { x, y, width, height } = g.box();
    if (!PICTURE.test(src)) g.fail("src must be a PNG, JPEG or WebP picture as a data URL");
    return [
      {
        kind: "image",
        id,
        by: "agent",
        made: "image",
        part: g.part(),
        color: "black",
        opacity: g.opacity(),
        src,
        at: [
          [x, y],
          [x + width, y],
          [x, y + height],
        ],
        cuts: [],
      },
    ];
  },
};

/**
 * Returns the brush mark a "draw" op's shape `s` holds: {kind: "brush", color, opacity, points, paint}, where paint is
 * a BrushPaint: a stroke along the pieces `points`, or a flat wash, a watercolour wash, massing or hatching inside the
 * rings `points`. `made` names the function in what an error says.
 */
function brushMark(
  made: string,
  s: Given,
  mark: Omit<BrushMark, "kind" | "paint" | "points" | "reach" | "cuts">,
): BrushMark {
  const p = new Given(made, s.value("paint")),
    kind = p.one("kind", { stroke: 1, hatch: 1, mass: 1, wash: 1, flat: 1 });
  const share = (key: string, fallback?: number) => between(p, key, 0, 1, fallback),
    brush = () => brushOf(made, p.value("brush")),
    flag = (key: string) => p.has(key) && p.value(key) === true;
  const paint: BrushPaint =
    kind === "flat"
      ? { kind }
      : kind === "wash"
        ? {
            kind,
            bleed: share("bleed"),
            texture: share("texture"),
            border: share("border", 0.4),
            ...(flag("inward") && { inward: true as const }),
          }
        : kind === "mass"
          ? {
              kind,
              brush: brush(),
              precision: share("precision"),
              strength: share("strength"),
              gradient: share("gradient"),
              ...(flag("scribble") && { scribble: true as const }),
            }
          : kind === "stroke"
            ? { kind, brush: brush(), weight: between(p, "weight", 0.01, 100) }
            : {
                kind,
                brush: brush(),
                weight: between(p, "weight", 0.01, 100),
                distance: between(p, "distance", 1, 1000),
                angle: p.num("angle"),
                rand: share("rand", 0),
                gradient: share("gradient", 0),
                continuous: flag("continuous"),
              };
  const points = s.lines("points", kind === "stroke" ? 2 : 3);
  return { kind: "brush", ...mark, paint, points, reach: reach(paint, points), cuts: [] };
}

/** Returns the number under `key`, or `fallback` if it was not given, if it lies from `least` to `most`. Throws if not. */
function between(g: Given, key: string, least: number, most: number, fallback?: number): number {
  const v = g.num(key, fallback);
  return v >= least && v <= most ? v : g.fail(`${key} must be from ${least} to ${most}`);
}

/** Returns a brush a shape was given: the name of one of p5.brush's brushes, or a brush the agent's code made. */
function brushOf(made: string, given: unknown): Brush {
  if (given && typeof given === "object") return madeBrush(made, given);
  if (typeof given === "string" && Object.hasOwn(BRUSHES, given)) return given as BrushName;
  throw new Error(`${made}: brush must be one of ${Object.keys(BRUSHES).join(", ")}, or a brush made with brush.add`);
}

/**
 * Returns the brush that brush.add was given, with every amount it left out at its default. `fn` names the function in
 * what an error says. The least pressure and the most grain keep a spray's dots a step to a few thousand, and the
 * least spacing keeps a stroke's stamps few enough to paint.
 */
export function madeBrush(fn: string, given: unknown): Made {
  const g = new Given(fn, given),
    pressure = g.has("pressure") ? g.value("pressure") : [1, 1];
  if (
    !Array.isArray(pressure) ||
    pressure.length < 2 ||
    pressure.length > 3 ||
    !pressure.every((v) => typeof v === "number" && v >= 0.1 && v <= 5)
  )
    g.fail("pressure must be [start, end] or [start, middle, end], each from 0.1 to 5");
  return {
    type: g.one("type", { default: 1, spray: 1, marker: 1 }),
    weight: between(g, "weight", 0.05, 50, 1),
    scatter: between(g, "scatter", 0, 50, 0.5),
    sharpness: between(g, "sharpness", 0, 1, 0.5),
    grain: between(g, "grain", 0.1, 100, 10),
    opacity: between(g, "opacity", 1, 255, 150),
    spacing: between(g, "spacing", 0.02, 10, 0.3),
    pressure: pressure as number[],
    rotate: g.one<Made["rotate"]>("rotate", { none: 1, natural: 1, random: 1 }, "natural"),
  };
}

/** Returns the marks the op `fn` makes from `given`, as ink `id`. Throws if `given` is malformed. */
export function ink(fn: Inks, given: unknown, id: number): Mark[] {
  return INK[fn](new Given(fn, given), id);
}

/** Returns the marks that the key `key` names. Throws if one of its ids or parts names no ink. */
function picked(sheet: Sheet, g: Given, key = "ink"): Mark[] {
  const which = g.which(key);
  for (const w of which)
    if (!sheet.pick([w]).length)
      g.fail(`${typeof w === "number" ? `no ink has the id ${w}` : `no ink is in the part "${w}"`}: read ink()`);
  return sheet.pick(which);
}

/**
 * Returns the part a mark in `part` goes to when the ink `which` is put in the part `to`. When `which` is the name
 * of one part, a mark in a part inside it stays as deep inside `to`: "tree.leaf3" in "tree" goes to "oak.leaf3".
 */
function renamed(part: string | undefined, which: (number | string)[], to: string | undefined): string | undefined {
  const [root] = which;
  const whole = to !== undefined && which.length === 1 && typeof root === "string" && part !== undefined;
  return whole && under(part, root) ? to + part.slice(root.length) : to;
}

/** Puts marks on the sheet. Returns what that did. */
function drew(sheet: Sheet, marks: Mark[]): Done {
  sheet.marks.push(...marks);
  return { did: "drew", marks };
}

/** Each other op: checks what it was given, changes the sheet, and returns what it did. */
const ACTS: Record<Exclude<Fn, Inks>, (sheet: Sheet, g: Given, id: number) => Done> = {
  background: (sheet, g) => {
    sheet.paper = g.color("color");
    return { did: "changed" };
  },
  erase: (sheet, g) => {
    if (g.has("ink")) sheet.drop(picked(sheet, g));
    else sheet.rub(g.box());
    return { did: "changed" };
  },
  move: (sheet, g) => {
    const marks = picked(sheet, g),
      to = g.pose("to"),
      seconds = Math.min(LONGEST_MOVE, Math.max(0, g.num("seconds", 0)));
    if (to.opacity !== undefined) g.fail("to cannot hold opacity");
    const about = sheet.around(marks),
      map = matrix(to, about);
    if (thickness(map) < 1e-3) g.fail("scale, scaleX and scaleY must not be 0");
    sheet.move(marks, mapper(map), thickness(map));
    return { did: "moved", marks, to, about, seconds };
  },
  copy: (sheet, g, id) => {
    const [dx, dy] = [g.num("dx"), g.num("dy")],
      [which, part] = [g.which(), g.part()];
    const copies = picked(sheet, g).map((m): Mark => ({ ...m, id, by: "agent", part: renamed(m.part, which, part) }));
    sheet.move(copies, ([x, y]) => [x + dx, y + dy], 1);
    return drew(sheet, copies);
  },
  setPart: (sheet, g) => {
    const part = g.part() ?? g.fail("part must be given"),
      which = g.which();
    for (const m of picked(sheet, g)) m.part = renamed(m.part, which, part);
    return { did: "changed" };
  },
  // takes the picked marks out of the stack and puts them back, in their own order, at the top, the bottom, or just
  // above or below the marks of other ink
  arrange: (sheet, g) => {
    const places = ["to", "above", "below"].filter((k) => g.has(k));
    if (places.length !== 1) g.fail("give one of to, above and below");
    const [place] = places,
      marks = new Set(picked(sheet, g)),
      rest = sheet.marks.filter((m) => !marks.has(m));
    let at: number;
    if (place === "to") at = g.one("to", { front: 1, back: 1 }) === "front" ? rest.length : 0;
    else {
      const others = new Set(picked(sheet, g, place)),
        found = rest.flatMap((m, i) => (others.has(m) ? [i] : []));
      if (!found.length) g.fail(`${place} names only ink that is being arranged`);
      at = place === "above" ? found[found.length - 1] + 1 : found[0];
    }
    rest.splice(at, 0, ...marks);
    sheet.marks = rest;
    return { did: "changed" };
  },
  animate: (sheet, g) => {
    const animation: Animation = {
      name: g.name("name"),
      frame: g.has("frame") ? g.text("frame") : g.fail("frame must be a function, (t, data) => { ... }"),
      data: g.value("data"),
      at: g.optional("at"),
      seconds: g.optional("seconds"),
      sticker: g.has("sticker") ? g.text("sticker") : "✨",
    };
    if (animation.at !== undefined && animation.at < 0) g.fail("at must be 0 or more");
    if (animation.seconds !== undefined && animation.seconds <= 0) g.fail("seconds must be more than 0");
    if (animation.sticker.length > LONGEST_STICKER) g.fail("sticker must be one emoji");
    const replaced = sheet.animations.get(animation.name);
    sheet.animations.set(animation.name, animation);
    return { did: "animated", animation, replaced };
  },
  retime: (sheet, g) => {
    const name = g.name("name"),
      was = sheet.animations.get(name) ?? g.fail(`there is no animation called "${name}"`),
      at = g.optional("at") ?? was.at,
      seconds = g.optional("seconds") ?? was.seconds;
    if (at !== undefined && at < 0) g.fail("at must be 0 or more");
    if (seconds !== undefined && seconds <= 0) g.fail("seconds must be more than 0");
    sheet.animations.set(name, { ...was, at, seconds });
    return { did: "changed" };
  },
  removeAnimation: (sheet, g) => {
    const name = g.name("name");
    if (!sheet.animations.delete(name)) g.fail(`there is no animation called "${name}"`);
    return { did: "changed" };
  },
  show: (_, g) => {
    const width = Math.min(WIDEST, Math.max(CLOSEST, g.num("width")));
    return { did: "showed", view: { x: g.num("x"), y: g.num("y"), width } };
  },
};

/**
 * Checks an op, which the agent's code made, and carries it out on the sheet. Returns what it did. Throws an Error that names the
 * function and says what is wrong if the op is malformed; then the sheet is as it was.
 */
export function apply(sheet: Sheet, op: Op): Done {
  if (!Number.isSafeInteger(op.id)) throw new Error(`${op.fn}: its id must be a whole number`);
  const g = new Given(op.fn, op.given);
  let done: Done;
  if (Object.hasOwn(INK, op.fn)) done = drew(sheet, INK[op.fn as Inks](g, op.id));
  else if (Object.hasOwn(ACTS, op.fn)) done = ACTS[op.fn as keyof typeof ACTS](sheet, g, op.id);
  else return g.fail("is not a function that changes the page");
  if (done.did === "drew") sheet.next = Math.max(sheet.next, op.id + 1); // only ink uses up an id
  return done;
}

/** What the agent's code can reach besides the sheet, as the worker that runs the code provides it. */
interface Host {
  view: Box; // the part of the page the person sees, which show moves
  applied: (op: Op) => void; // is told of each op once it has changed the sheet
  print: (...values: unknown[]) => void;
  look: (peek: Peek) => void;
}

/**
 * The ops that a sketch makes from what the agent's p5 code drew: each given is the object its op holds, and each
 * returns the id of its ink.
 */
interface Inking {
  draw(given: object): number;
  write(given: object): number;
  image(given: object): number;
  background(color: string): void;
}

/** The page's functions besides those for drawing, as the agent's code calls them. */
type Paint = Pick<
  typeof Api,
  | "view"
  | "show"
  | "ink"
  | "colorAt"
  | "look"
  | "erase"
  | "move"
  | "copy"
  | "setPart"
  | "arrange"
  | "print"
  | "render"
  | "animate"
  | "retime"
  | "removeAnimation"
>;

/**
 * Returns the paint contract as the agent's code calls it, and the ops a sketch makes as `inking`. Each call that
 * changes the page becomes an op with the sheet's next id, which is applied to the sheet and then handed to
 * host.applied; a call that makes ink returns that id. The reading functions read the sheet.
 */
export function painter(sheet: Sheet, host: Host): { paint: Paint; inking: Inking } {
  const call = (fn: Fn, given: unknown): number => {
    const op: Op = { fn, id: sheet.next, given: plain(fn, given) };
    const done = apply(sheet, op);
    if (done.did === "showed")
      host.view = { ...done.view, height: (done.view.width * host.view.height) / host.view.width };
    host.applied(op);
    return op.id;
  };
  const fields = (o: unknown) => ({ ...(o && typeof o === "object" ? o : {}) }) as Record<string, unknown>;
  const inking: Inking = {
    draw: (given) => call("draw", given),
    write: (given) => call("write", given),
    image: (given) => call("image", given),
    background: (color) => void call("background", { color }),
  };
  const paint: Paint = {
    erase: (o) => void call("erase", o),
    move: (o) => void call("move", o),
    copy: (o) => call("copy", o),
    setPart: (o) => void call("setPart", o),
    arrange: (o) => void call("arrange", o),
    // a function cannot be sent to the page, so the op holds the frame function's source text
    animate: (o) => {
      const frame = fields(o).frame;
      call("animate", { ...fields(o), frame: typeof frame === "function" ? String(frame) : undefined });
    },
    retime: (o) => void call("retime", o),
    removeAnimation: (name) => void call("removeAnimation", { name }),
    show: (o) => void call("show", o),
    ink: (within) => sheet.ink(within === undefined ? undefined : new Given("ink", within).box()),
    colorAt: (x, y) => {
      const g = new Given("colorAt", { x, y });
      return colorAt(sheet, g.num("x"), g.num("y"));
    },
    look: (o = {}) => {
      const g = new Given("look", o);
      host.look({ ...host.view, y: g.optional("y") ?? host.view.y, t: g.optional("t") });
    },
    print: host.print,
    render: () => undefined, // the page has already cut the code into blocks at each render() line
    view: () => ({ ...host.view }),
  };
  return { paint, inking };
}

/** Returns a copy of what a function was given, which can be sent to the page. Throws if it holds a function. */
function plain(fn: Fn, given: unknown): unknown {
  try {
    return structuredClone(given);
  } catch {
    throw new Error(`${fn}: takes only numbers, text, lists and objects of these`);
  }
}
