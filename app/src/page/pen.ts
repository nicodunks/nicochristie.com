/** The person's hand, pen and eraser: the widths the pen and eraser come in, and what the person chose. */
import type { Named } from "../paint/api.ts";
import { PERSON_COLOR } from "../paint/constants.ts";
import { OPEN } from "./state.ts";

/** The widths of the person's pen and eraser, in page units: so many pixels on the window as it opens. */
export const SIZES = {
  pen: [1.5, 3, 7].map((px) => (px * OPEN) / innerWidth),
  wipe: [12, 30, 70].map((px) => (px * OPEN) / innerWidth),
};

/** The tools the person can hold: the hand drags the sheet, the pen draws and the eraser rubs out. */
export const TOOLS = ["hand", "pen", "eraser"] as const;

/** What the person chose: the pen's colour, width and opacity, the eraser's width, and which tool they hold. */
export const chosen = {
  color: PERSON_COLOR as Named,
  pen: SIZES.pen[1],
  opacity: 1, // how solid the pen draws, from 0.1, faint, to 1, solid
  wipe: SIZES.wipe[1],
  tool: "pen" as (typeof TOOLS)[number],
};
