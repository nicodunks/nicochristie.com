/**
 * How the sheet's marks are shown at this moment, where that differs from what the sheet holds. The sheet holds each
 * mark whole and where it ended up. The person sees the agent's new ink appear stroke by stroke, sees moved ink
 * glide to its place, and sees animations hold parts in poses. Each of those is written down here, and the canvas
 * draws every mark with the look that looks() gives it.
 */
import { type Look, type Matrix, type Shot, after, posed } from "../paint/pose.ts";
import type { Mark } from "../paint/sheet.ts";
import { sheet } from "./state.ts";

export const present = {
  drawn: new Map<Mark, number>(), // the share, from 0 to 1, that shows of each mark that has not wholly appeared
  moving: new Map<Mark, Matrix>(), // the map from where each gliding mark is on the sheet to where it shows now
  shot: undefined as Shot | undefined, // what the running animations show now, or undefined when none runs
};

/** Returns the function that gives a mark its look now: a mark of the sheet, or ink of the animations' shot. */
export function looks(): (m: Mark) => Look {
  const pose = present.shot ? posed(sheet, present.shot.poses) : () => undefined;
  return (m) => {
    const held = pose(m),
      moving = present.moving.get(m);
    // the glide says where the mark shows at rest, and a pose moves it from there
    const at = held?.at && moving ? after(held.at, moving) : (held?.at ?? moving);
    return { at, solid: held?.solid, drawn: present.drawn.get(m) };
  };
}
