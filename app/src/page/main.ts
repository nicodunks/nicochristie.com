/**
 * nicochristie.com: a sheet the visitor and the agent draw on together, which opens on the words about Nico as the
 * agent's ink and greets each visit with a drawing. It is /draw's canvas and the parts of /draw's page that talk to the
 * agent, without sign-in, credits, the shelf, sharing or live voice. Each module below sets itself up as it loads; this
 * one points the canvas at the workers' scripts, fits the canvas to the part of the window that shows, above a phone's
 * keyboard, opens a new drawing, and greets. Built by `npm run build` into ../draw/app.js.
 */
import { scripts } from "../sandbox/caller.ts";
import "./backdrop.ts";
import "./links.ts"; // before the canvas's input, so that a tap on a link's ink opens it and draws nothing
import "./buttons.ts";
import "../canvas/input.ts";
import "./turn.ts";
import "./voice.ts";
import "./talk.ts";
import "./style.ts";
import { fresh } from "./fresh.ts";
import { greet } from "./turn.ts";
import { ready } from "./buttons.ts";
import { fit, keyboard } from "../canvas/view.ts";

// the workers' scripts, which this site serves under /draw/
scripts["run.js"] = "/draw/run.js";
scripts["stage.js"] = "/draw/stage.js";

window.addEventListener("resize", fit);

// A phone's keyboard covers the bottom of the window without making it smaller, and Safari slides the whole page up
// to show the box being typed in, which takes the buttons and the drawing off the screen. So the page follows the part
// of the window that shows: it is as tall as that part, and where it is. The drawing stays where it was unless ink the
// person saw would go behind the keyboard or the typing box; then the view glides to keep that ink in the band between
// the buttons at the top and the typing box. On a phone the drawing tools hide meanwhile.
// The keyboard counts as open while the page is less than five sixths of the tallest it has been at this width.
const seen = window.visualViewport;
const [buttons, composer] = [document.getElementById("buttons")!, document.getElementById("composer")!];
/** Returns the band of the page that no buttons cover, from the top buttons' bottom to the typing box's top, in pixels. */
const clear = (): [number, number] => {
  const top = document.body.getBoundingClientRect().top;
  return [buttons.getBoundingClientRect().bottom - top, composer.getBoundingClientRect().top - top];
};
let tallest = { wide: 0, tall: 0 };
function follow(): void {
  if (!seen) return;
  if (tallest.wide !== innerWidth) tallest = { wide: innerWidth, tall: 0 };
  tallest.tall = Math.max(tallest.tall, seen.height);
  const [height, top] = [`${Math.round(seen.height)}px`, `${Math.round(seen.offsetTop)}px`];
  if (document.body.style.height === height && document.body.style.top === top) return;
  const [was, open] = [clear(), seen.height < (tallest.tall * 5) / 6];
  Object.assign(document.body.style, { height, top });
  document.body.classList.toggle("typing", open);
  keyboard(open, was, clear());
}
seen?.addEventListener("resize", follow);
seen?.addEventListener("scroll", follow);
follow();
fit();
fresh();
ready();
greet();
