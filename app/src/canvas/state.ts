/** The open drawing (its sheet and the model's folder) and whether a turn is with the model. */
import { NARROW, WIDEST } from "../paint/constants.ts";
import { Sheet } from "../paint/sheet.ts";
import type { Folder } from "../run/run.ts";

/**
 * How many page units the window shows across when it opens. /draw opens one to the pixel, within NARROW and WIDEST;
 * nicochristie.com opens a little zoomed out, 1 / ZOOM to the pixel, so the words about Nico stand smaller than they
 * were written with paper around them, and at least FEWEST, so a phone opens zoomed out further. The page calls this
 * view 100%. (This site's one change to this file.)
 */
const ZOOM = 0.75,
  FEWEST = 700;
export const OPEN = Math.min(WIDEST, Math.max(FEWEST, NARROW, innerWidth / ZOOM));

export const sheet = new Sheet();

/** The agent's folder: the files the agent's code wrote or downloaded, for the drawing open now. */
export const folder: Folder = {};

/** The agent's turn: `busy` while a turn is with the agent, and `hurry` once the person pressed Stop in it. */
export const session = { busy: false, hurry: false };
