/** The page's sizes and pen colours, which the page, the agent's code and the agent's prompt all use. */
import type { Color, Named } from "./api.ts";

export const WIDEST = 10_000; // how many page units the person's window shows across when zoomed out fully
export const START = 2500; // every drawing opens with the middle of the window at (START, START)
export const PEN_WIDTH = 3; // the width of the agent's lines when a turn starts, as the person's pen draws, in page units
export const NARROW = 400; // the least width the agent's picture shows, in page units; a phone shows about this much
export const CLOSEST = 80; // the fewest page units a view shows across, zoomed in fully
export const FAR = 100_000; // the farthest from 0 any coordinate or size the agent gives may be, in page units
export const GRID = 100; // the agent's picture of the page has a labelled grid line every this many units
export const STEP = 3; // the distance between the points along the agent's lines, in page units

/** The colours of the page: the name the agent and the page call each colour by, and the colour itself. Every one is a
 * colour of the person's pen but white, which only the agent has, for covering other ink. */
export const COLORS = {
  black: "#1d1d1f",
  gray: "#8e8e93",
  brown: "#a2693c",
  red: "#e5484d",
  orange: "#f76b15",
  yellow: "#f5b800",
  green: "#30a46c",
  teal: "#12a594",
  sky: "#2ba3e8",
  blue: "#3e63dd",
  purple: "#8e4ec6",
  pink: "#e93d82",
  white: "#ffffff",
} as const;

/** Returns the CSS colour of a colour of the page: the colour of a name, or "#rrggbb" as it is. */
export function css(color: Color): string {
  return Object.hasOwn(COLORS, color) ? COLORS[color as Named] : color;
}

export const PERSON_COLOR = "black"; // the colour the person's pen starts in
export const AGENT_COLOR = "black"; // the agent's colour when it names none
