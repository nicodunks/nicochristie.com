/**
 * The person's tools, one small card at the bottom right where a thumb reaches. Its bottom row holds Undo and Redo,
 * the hand, the pen and the eraser, each a hand-drawn icon whose name shows when the pointer rests on it, and last a
 * blob of the pen's colour. Tapping the blob opens two more rows above it, and tapping it again or touching the sheet
 * closes them: the three sizes, each a squiggle as the pen would draw it, with the fade, a slider from faint at its
 * left to solid at its right; and above them the colours, as blobs of paint in two rows. The ones chosen are
 * outlined. Tapping the eraser opens one row instead: a slider of the eraser's size. Also which buttons are live.
 */
import type { Named } from "../paint/api.ts";
import { COLORS } from "../paint/constants.ts";
import { redo, steps, undo, watch } from "./history.ts";
import { labelled } from "./icons.ts";
import { SIZES, TOOLS, chosen } from "./pen.ts";
import { preview } from "./rubber.ts";
import { attached, session, spoken } from "./state.ts";
import { canvas, redraw } from "./view.ts";

const tools = document.getElementById("tools")!;
const send = document.getElementById("send") as HTMLButtonElement;
const clear = document.getElementById("clear") as HTMLButtonElement,
  drawings = document.getElementById("drawings") as HTMLButtonElement;

const PENS = (Object.keys(COLORS) as Named[]).filter((c) => c !== "white"); // white ink would not show on the page
const NAMES = {
  tool: { hand: "Hand", pen: "Pen", eraser: "Eraser" },
  size: { pen: ["Thin", "Medium", "Thick"], wipe: ["Small", "Medium", "Big"] },
};
const SQUIGGLE = "M4 15c4-8 7 5 11-1s6 2 11-6"; // the stroke a swatch draws, on a 30 by 22 box

/** Returns a new button with a title, which does `act` when tapped, put at the end of `into`. */
function button(title: string, act: () => void, into: HTMLElement = tools): HTMLButtonElement {
  const b = document.createElement("button");
  b.title = title;
  b.addEventListener("click", act);
  into.append(b);
  return b;
}

/** Returns a new box of the class `kind`, put at the end of the tools, to hold a row of buttons. */
function group(kind: string): HTMLElement {
  const g = document.createElement("div");
  g.className = kind;
  tools.append(g);
  return g;
}

/** Returns a picture of a size: a squiggle `px` pixels wide, in the pen's colour. */
function squiggle(px: number): string {
  return `<svg class="swatch" viewBox="0 0 30 22"><path d="${SQUIGGLE}" stroke="${COLORS[chosen.color]}" stroke-width="${px}"/></svg>`;
}

/** Returns a picture of a colour, as a blob of paint. */
const blob = (color: Named): string => `<i class="blob" style="background:${COLORS[color]}"></i>`;

/** Returns the pixels of a swatch's stroke for the n-th of the three sizes. */
const thick = (n: number): number => [1.5, 3.5, 7][n];

/** Returns which of the pen and the eraser a size is for: the eraser while the person holds it, else the pen. */
const held = (): "pen" | "wipe" => (chosen.tool === "eraser" ? "wipe" : "pen");

const acts = group("row");
const back = button("Undo", undo, acts),
  again = button("Redo", redo, acts);
labelled(back, "undo");
labelled(again, "redo");
acts.append(document.createElement("hr"));
const holders = TOOLS.map((tool) => {
  const b = button(NAMES.tool[tool], () => hold(tool), acts);
  labelled(b, tool);
  return b;
});
acts.append(document.createElement("hr"));
const opener = button("Size, fade and colour", () => open(!tools.classList.contains("open")), acts);
const styles = group("row styles");
const sizes = [0, 1, 2].map((n) => button("", () => size(n), styles));
styles.append(document.createElement("hr"));
const fader = document.createElement("input");
Object.assign(fader, { id: "fader", type: "range", min: "0.1", max: "1", step: "0.05", title: "Fade" });
fader.addEventListener("input", () => choose({ opacity: Number(fader.value), tool: "pen" }));
styles.append(fader);
// the eraser's row: a slider of its width, from WIPES[0] to WIPES[1] pixels on the window as it opens
const WIPES = [6, 140],
  PIXEL = SIZES.wipe[0] / 12; // page units to one such pixel
const wiping = group("row wipe");
const wiper = document.createElement("input");
Object.assign(wiper, { id: "wiper", type: "range", min: String(WIPES[0]), max: String(WIPES[1]), step: "1" });
wiper.title = "Eraser size";
wiper.addEventListener("input", () => {
  choose({ wipe: Number(wiper.value) * PIXEL, tool: "eraser" });
  preview(true);
});
for (const name of ["change", "pointerup", "pointercancel", "blur"]) wiper.addEventListener(name, () => preview(false));
wiping.append(wiper);
const palette = group("colors");
const colors = PENS.map((color) => {
  const b = button(color, () => choose({ color, tool: "pen" }), palette);
  b.innerHTML = blob(color);
  return b;
});

/**
 * Sets which buttons are live. Send is live when there is something the agent has not been told of; while a turn is
 * with the agent, Send reads Stop. Clear and My drawings, which change the drawing that is open, are not live while a
 * turn is with the agent or while the person speaks a note.
 */
export function ready(): void {
  labelled(send, session.busy ? "stop" : "plane", session.busy ? "Stop" : "Send");
  send.className = session.busy ? "stop" : "";
  const news = steps().undo || spoken.notes.some((n) => !n.sent) || attached.some((p) => !p.sent);
  send.disabled = !session.busy && (spoken.heard !== null || !news);
  back.disabled = session.busy || !steps().undo;
  again.disabled = session.busy || !steps().redo;
  clear.disabled = drawings.disabled = session.busy || spoken.heard !== null;
}

// Whatever the person does to the sheet shows at once, and may change which buttons are live.
watch(() => {
  redraw();
  ready();
});

/** Outlines a choice if it is chosen, and says so to a screen reader. */
function mark(b: HTMLButtonElement, on: boolean): void {
  b.classList.toggle("on", on);
  b.ariaPressed = String(on);
}

/**
 * Takes what the person chose, as some of the keys of `chosen`, and shows the tools anew: the sizes and the fade's
 * slider are drawn in the chosen colour, and the sizes are the eraser's while the person holds it.
 */
function choose(change: Partial<typeof chosen>): void {
  Object.assign(chosen, change);
  TOOLS.forEach((tool, n) => mark(holders[n], chosen.tool === tool));
  const key = held();
  sizes.forEach((b, n) => {
    b.title = NAMES.size[key][n];
    b.innerHTML = squiggle(thick(n));
    mark(b, SIZES[key][n] === chosen[key]);
  });
  wiper.value = String(chosen.wipe / PIXEL);
  fader.value = String(chosen.opacity);
  fader.style.setProperty("--ink", COLORS[chosen.color]);
  colors.forEach((b, n) => mark(b, PENS[n] === chosen.color));
  opener.innerHTML = blob(chosen.color);
  canvas.classList.toggle("hand", chosen.tool === "hand");
}

// Takes the n-th size: the eraser's if the person holds it, and otherwise the pen's, which takes up the pen. The fade
// and the colours take up the pen too.
function size(n: number): void {
  const key = held();
  choose({ [key]: SIZES[key][n], tool: key === "wipe" ? "eraser" : "pen" });
}

/** Opens or closes the rows of sizes, fade and colours; opening them closes the eraser's slider. */
function open(on: boolean): void {
  tools.classList.toggle("open", on);
  if (on) tools.classList.remove("wiping");
  mark(opener, on);
}

/**
 * Takes up a tool. Taking up the eraser opens the slider of its size in a row above, and tapping the eraser again
 * closes it; any other tool closes it.
 */
function hold(tool: (typeof TOOLS)[number]): void {
  const on = tool === "eraser" && !(chosen.tool === "eraser" && tools.classList.contains("wiping"));
  choose({ tool });
  open(false);
  tools.classList.toggle("wiping", on);
}

canvas.addEventListener("pointerdown", () => {
  open(false);
  tools.classList.remove("wiping");
});
choose({});
