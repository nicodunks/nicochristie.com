/** What the canvas needs from the page it is on: event tracking, web search and downloads, and word of new ink. */
import type { Need } from "../run/run.ts";

/** The hooks; each does nothing until the page sets it with hook(), except serve, which fails. */
interface Hooks {
  /** Records one of the canvas's events with its props. */
  track: (
    name: "eraser_sized" | "picture_placed" | "sticker_moved" | "sticker_tapped",
    props: Record<string, unknown>,
  ) => void;
  /** Counts one more stroke or erase by the person. */
  tally: (what: "strokes" | "erases") => void;
  /** Does a search or a download that the model's code asked for. */
  serve: (need: Need) => Promise<unknown>;
  /** Called each time the model's code puts new ink on the sheet. */
  inked: () => void;
}

export const hooks: Hooks = {
  track: () => {},
  tally: () => {},
  serve: () => Promise.reject(new Error("this page cannot search the web or download files")),
  inked: () => {},
};

/** Sets some of the hooks. */
export function hook(set: Partial<Hooks>): void {
  Object.assign(hooks, set);
}
