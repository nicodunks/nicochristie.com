/**
 * nicochristie.com's sheet, which keeps nothing: every visit, and every reload, opens a new drawing on the words about
 * Nico (about.ts), and the trash button at the top right, `#new`, wipes the drawing for a new one the same way. /draw
 * keeps every drawing in the browser instead, in a module this site leaves out.
 */
import { sync } from "../canvas/animations.ts";
import { told } from "../canvas/history.ts";
import { folder, session, sheet } from "../canvas/state.ts";
import { home, redraw } from "../canvas/view.ts";
import { about } from "./about.ts";
import { ready } from "./buttons.ts";
import { say } from "./caption.ts";
import { Agent } from "./conversation.ts";
import { drawing, named, spoken } from "./state.ts";
import { list } from "./voice.ts";

/** Opens a new drawing: the words about Nico, an agent that remembers nothing, an empty folder and no notes. */
export function fresh(): void {
  sheet.restore(about());
  drawing.agent = new Agent(named());
  for (const path of Object.keys(folder)) delete folder[path];
  spoken.notes = [];
  told(); // Undo reaches back no further than the new drawing, and the agent is told of nothing done before it
  home();
  sync();
  list();
  ready();
  redraw();
  say("");
}

document.getElementById("new")!.addEventListener("click", () => {
  if (!session.busy && !spoken.listening) fresh();
});
