/**
 * What the page holds besides what the person sees: the drawing open now with its sheet and its agent, the agent's
 * turn, the notes, the photos and the agent's folder.
 */
import { Agent } from "../agent/loop.ts";
import { WIDEST } from "../paint/constants.ts";
import { Sheet } from "../paint/sheet.ts";
import type { Folder } from "../run/run.ts";

/**
 * How many page units the window shows across when it opens: 1 / ZOOM to the pixel, so the words about Nico stand
 * smaller than they were written, with paper around them; but at least FEWEST, so a phone opens zoomed out further;
 * and at most WIDEST. The page calls this view 100%.
 */
const ZOOM = 0.75,
  FEWEST = 700;
export const OPEN = Math.min(WIDEST, Math.max(FEWEST, innerWidth / ZOOM));

/** Returns a new drawing's name in the gateway's record: the time it was started and a few random letters. */
export const named = (): string =>
  `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 6)}`;

export const sheet = new Sheet();

/** The drawing open now: its agent, which holds the conversation and the drawing's name in the gateway's record. */
export const drawing = { agent: new Agent(named()) };

/** The agent's turn: `busy` while a turn is with the agent, and `hurry` once the person pressed Stop in it. */
export const session = { busy: false, hurry: false };

/** Something the person said: the words the browser heard, whether the agent has been given it, and whether it shows. */
export interface Note {
  text: string;
  sent: boolean;
  open: boolean;
}

/** Everything the person said, in order, and the note they are speaking now. */
export const spoken = { notes: [] as Note[], heard: null as Note | null };

/** A photo the person attached: where it is in the agent's folder, and whether the agent has been given it. */
export interface Photo {
  path: string;
  sent: boolean;
}

/** The photos the person attached, in order. */
export const attached: Photo[] = [];

/** The agent's folder: the photos the person attached and the files the agent's code wrote, for the drawing open now. */
export const folder: Folder = {};
