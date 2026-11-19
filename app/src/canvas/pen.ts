/** The person's tools: the widths the pen and eraser come in, and what the person chose. */
import type { Named } from "../paint/api.ts";
import { PERSON_COLOR } from "../paint/constants.ts";
import { OPEN } from "./state.ts";

/** Returns so many pixels on the window as it opens, in page units. */
const units = (px: number): number => (px * OPEN) / innerWidth;

/** The three widths of the person's pen, in page units. */
export const SIZES = [1.5, 3, 7].map(units);

/** The narrowest and the widest eraser, in page units. */
export const WIPE = [8, 320].map(units) as [least: number, most: number];

/**
 * The tools the person can hold, in the order the tools bar shows them: the pen draws, the hand drags the sheet,
 * Select picks things to move, resize or delete, and the eraser rubs out.
 */
export const TOOLS = ["pen", "hand", "select", "eraser"] as const;

/** What the person chose: the pen's colour, width and opacity, the eraser's width, and which tool they hold. */
export const chosen = {
  color: PERSON_COLOR as Named,
  pen: SIZES[1],
  opacity: 1, // how solid the pen draws, from 0.1, faint, to 1, solid
  wipe: units(30),
  tool: "pen" as (typeof TOOLS)[number],
};
