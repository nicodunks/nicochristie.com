/**
 * p5.js 1.11 as the agent's way to draw. The agent writes ordinary p5 in global mode, such as
 * `fill("green"); rotate(0.3); ellipse(0, 0, 80, 40);`, and real p5 works out each shape. p5 runs on a pretend page
 * whose canvas records shapes instead of painting them, so what one call of a p5 function draws comes out as shapes in
 * page units. The sketch hands them to its sink, which makes them ink, and the call returns the ink's id.
 *
 * Besides p5's functions and constants, the agent gets three of its own that fit p5's way of keeping settings:
 * part("tree.leaf3") puts what is drawn next in a part, hand(0.5) sets how much what is drawn next wavers as a hand's
 * drawing does, and push() and pop() keep both; write() writes in the agent's hand in the stroke colour of the moment.
 * background() sets the colour of the paper. brush paints with p5.brush's media: p5 works out each brush shape's
 * outline in page units, and the outline becomes a brush mark, which the page paints with p5.brush.
 */
import "./page.ts"; // before p5, which reads the pretend page as it loads
import p5 from "p5";
import type * as Api from "../paint/api.ts";
import type * as BrushApi from "../paint/brushapi.ts";
import type { Box } from "../paint/api.ts";
import { AGENT_COLOR, COLORS, PEN_WIDTH, css } from "../paint/constants.ts";
import { Given } from "../paint/read.ts";
import { type BrushShape, type Settings, START, brushing } from "./brushing.ts";
import { byHand } from "./byhand.ts";
import { type Shape, solid } from "./canvas.ts";
import { drawTo } from "./page.ts";

/** What one call of a p5 function drew: the function's name, the part of the moment, and its shapes. */
interface Drawn {
  made: string;
  part?: string;
  shapes: (Shape | BrushShape)[];
}

/** The colour, opacity and part of the moment, which write draws in. */
interface Pen {
  color: string;
  opacity: number;
  part?: string;
}

/**
 * Where the sketch's ink goes. Each function that makes ink returns its id. write is given what the agent gave it,
 * with the colour, opacity and part of the moment added. view gives the part of the page the person sees.
 */
interface Sink {
  draw(drawn: Drawn): number;
  write(given: object & Pen): number;
  background(color: string): void;
  view(): Box;
}

/** The p5 functions the agent cannot use here, and what it is told instead. */
const NOT_HERE: Record<string, string> = {
  text: "write({x, y, width, height, text}) writes text in your hand",
  createCanvas: "the page is your canvas: draw on it directly, in page units",
  resizeCanvas: "the page is your canvas: draw on it directly, in page units",
  createGraphics: "the page is your only canvas: draw on it directly",
  loop: "nothing redraws here: animate() makes ink move",
  noLoop: "nothing redraws here: animate() makes ink move",
  redraw: "nothing redraws here: animate() makes ink move",
};

/** The p5 functions that take a colour, which may be one of the page's colours by name. */
const COLORED = ["fill", "stroke", "color", "background"];

/** The p5 functions the instance has that are not for the agent: its own lifecycle. */
const LIFECYCLE = new Set(["constructor", "setup", "draw", "preload", "remove"]);

const reader = new OffscreenCanvas(1, 1).getContext("2d")!; // a real canvas, which knows CSS's colours

/**
 * Returns whether p5 knows the text as a colour: CSS knows it, which a canvas tells by keeping it as its fillStyle,
 * or it is one of p5's own "hsb(…)" and "hsba(…)".
 */
function isColor(text: string): boolean {
  if (/^hsba?\(/i.test(text.trim())) return true;
  reader.fillStyle = "#000000";
  reader.fillStyle = text;
  const black = reader.fillStyle;
  reader.fillStyle = "#ffffff";
  reader.fillStyle = text;
  return reader.fillStyle === black; // a colour CSS does not know leaves the fillStyle as it was
}

/** A sketch: the globals the agent's code sees, and the two ways to start drawing afresh. */
interface Sketch {
  /** p5's functions and constants, whose names the agent's code may take for its own values, as in p5's global mode. */
  p5: Record<string, unknown>;
  /** The page's own names for drawing, which the agent's code may not take: part, write, width and height. */
  own: object;
  /** Takes away the transform, as p5 does before each draw(): a block of the agent's code starts with none. */
  restart(): void;
  /** Runs `fn` with no transform, no part and a person's hand, and puts every setting back after it, so `fn` cannot change them. */
  apart<T>(fn: () => T): T;
}

/** Starts a p5 sketch whose ink goes to `sink`. Returns its globals: p5's functions and constants, and the page's. */
export function sketch(sink: Sink): Sketch {
  let p!: p5;
  new p5((q) => {
    p = q;
    q.setup = () => {
      call("pixelDensity", 1);
      call("noLoop");
      call("stroke", css(AGENT_COLOR));
      call("strokeWeight", PEN_WIDTH);
    };
  }, document.createElement("main"));

  let shapes: Shape[] = [],
    part: string | undefined,
    hand = 1;
  const kept: { part: string | undefined; hand: number; brush: Settings }[] = [];
  drawTo((s) => shapes.push(s));

  /** Calls p5's own function `name`. */
  function call(name: string, ...args: unknown[]): unknown {
    return (p[name] as (...a: unknown[]) => unknown).apply(p, args);
  }

  /**
   * Returns p5's function `name` as the agent calls it. What the function draws becomes one ink, whose id is what it
   * returns; a function that draws nothing returns what p5 returns. An error names the function.
   */
  const wrapped =
    (name: string, fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]): unknown => {
      shapes = [];
      let out: unknown;
      try {
        out = fn(...args);
      } catch (e) {
        throw new Error(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!shapes.length) return out;
      const drawn = shapes;
      shapes = [];
      return sink.draw({ made: name, part, shapes: byHand(drawn, hand) });
    };

  /** Returns the colour and opacity of p5's stroke of the moment, and the part of the moment. */
  const now = (): Pen => {
    const { color, alpha } = solid(p.drawingContext.strokeStyle);
    return { color, opacity: alpha, part };
  };

  /**
   * Returns the arguments with each of the page's colour names as its colour, so fill("sky") is the page's sky.
   * Throws for a text that is not a colour, which p5 would take as white without a word.
   */
  const named = (args: unknown[]) =>
    args.map((a) => {
      if (typeof a !== "string") return a;
      if (Object.hasOwn(COLORS, a)) return css(a as keyof typeof COLORS);
      if (!isColor(a)) throw new Error(`${a} is not a colour: give one such as "#6b5a3a", "sky" or "tomato"`);
      return a;
    });

  // p5's push and pop, which keep the part, the hand and brush's settings too
  const push = () => {
    call("push");
    kept.push({ part, hand, brush: brushes.now });
  };
  const pop = () => {
    call("pop");
    const top = kept.pop();
    if (top) ({ part, hand, brush: brushes.now } = top);
  };

  /** brush, whose settings push() and pop() keep with p5's. */
  const brushes = brushing({
    call,
    record(fn) {
      shapes = [];
      fn();
      const drawn = shapes;
      shapes = [];
      return drawn;
    },
    draw: (made, drawn) => sink.draw({ made, part, shapes: drawn }),
    colorOf: (given) => solid(String(call("color", ...named([given])))),
  });

  const names: Record<string, unknown> = {};
  for (let o: object | null = p; o && o !== Object.prototype; o = Object.getPrototypeOf(o))
    for (const name of Object.getOwnPropertyNames(o)) {
      if (name.startsWith("_") || LIFECYCLE.has(name) || name in names) continue;
      let value: unknown;
      try {
        value = p[name];
      } catch {
        continue; // a getter that needs a running sketch
      }
      if (typeof value === "function") names[name] = wrapped(name, (...a) => call(name, ...a));
      else if (/^[A-Z][A-Z0-9_]*$/.test(name)) names[name] = value; // a constant, such as PI or CLOSE
    }
  for (const name of COLORED) names[name] = wrapped(name, (...a) => call(name, ...named(a)));
  for (const [name, instead] of Object.entries(NOT_HERE))
    names[name] = () => {
      throw new Error(`${name}: ${instead}`);
    };
  Object.assign(names, {
    push,
    pop,
    // p5's background, which colours the paper behind all ink in place of painting over it
    background(...args: unknown[]): void {
      let color: string;
      try {
        color = solid(String(call("color", ...named(args)))).color;
      } catch (e) {
        throw new Error(`background: ${e instanceof Error ? e.message : String(e)}`);
      }
      sink.background(color);
    },
  });

  const added: Pick<typeof Api, "part" | "hand" | "write"> & Pick<typeof BrushApi, "brush"> = {
    brush: brushes.brush,
    part(name) {
      part = name === undefined ? undefined : new Given("part", { part: name }).part();
    },
    hand(amount) {
      if (typeof amount !== "number" || !(amount >= 0 && amount <= 3))
        throw new Error(`hand: give how much to waver, from 0, exact, to 3: not ${String(amount)}`);
      hand = amount;
    },
    write: (o) => sink.write({ ...o, ...now() }),
  };
  const own = {
    ...added,
    // the size of the person's view, in page units
    get width() {
      return sink.view().width;
    },
    get height() {
      return sink.view().height;
    },
  };

  return {
    p5: names,
    own,
    restart: () => void call("resetMatrix"),
    apart<T>(fn: () => T): T {
      push();
      call("resetMatrix");
      part = undefined;
      hand = 1;
      brushes.now = START;
      try {
        return fn();
      } finally {
        pop();
      }
    },
  };
}
