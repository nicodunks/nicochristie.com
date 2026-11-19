/**
 * The person's tools, one small card at the bottom right where a thumb reaches. At rest its bottom row holds only
 * the pen, the hand, Select and the eraser, each a hand-drawn icon whose name shows when the pointer rests on it, and
 * then a blob of the pen's colour. Tapping the blob opens the whole card, and tapping it again or touching the sheet
 * closes it. Open, the bottom row gains Undo and Redo at its left and, just before the pen, the picture button, which
 * puts a picture from the device on the sheet, picked with Select so it can be moved or resized at once. Two more rows open
 * above it: the three sizes, each a squiggle as the pen would draw it, with the fade, a slider from faint at its left
 * to solid at its right; and above them the colours, as blobs of paint in two rows. The ones chosen are
 * outlined. Taking up the eraser opens its size above the card instead, a slider from narrow to very wide, and tapping
 * the eraser again closes it. While the person holds the eraser, a circle as wide as it follows the pointer over the
 * sheet, so they see what a stroke will rub out. Also which of the tools' buttons are live.
 */
import type { Named } from "../paint/api.ts";
import { COLORS } from "../paint/constants.ts";
import { redo, steps, undo, watch } from "./history.ts";
import { labelled } from "./icons.ts";
import { SIZES, TOOLS, WIPE, chosen } from "./pen.ts";
import { hooks } from "./hooks.ts";
import { choosePicture } from "./pictures.ts";
import { letGo, pick } from "./select.ts";
import { session } from "./state.ts";
import { canvas, redraw, view } from "./view.ts";

const tools = document.getElementById("tools")!;
const circle = document.getElementById("ring")!; // the circle the eraser rubs out

const PENS = (Object.keys(COLORS) as Named[]).filter((c) => c !== "white"); // white ink would not show on the page
const NAMES = {
  tool: { select: "Select", hand: "Hand", pen: "Pen", eraser: "Eraser" },
  size: ["Thin", "Medium", "Thick"],
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

const acts = group("row");
const back = button("Undo", undo, acts),
  again = button("Redo", redo, acts);
labelled(back, "undo");
labelled(again, "redo");
// Cmd+Z, or Ctrl+Z, presses Undo, and with Shift presses Redo, so it does only what the button may; not while typing
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || (e.target as Element).closest("input, textarea"))
    return;
  e.preventDefault();
  (e.shiftKey ? again : back).click();
});
const line = acts.appendChild(document.createElement("hr"));
const pictured = (id: number) => (choose({ tool: "select" }), pick([id]));
const picture = button("Add a picture", () => choosePicture(pictured), acts);
labelled(picture, "picture");
// the eraser opens its size as it is taken up, and closes it when tapped again
const holders = TOOLS.map((tool) => {
  const take = () =>
    tool !== "eraser"
      ? choose({ tool })
      : (wipes(chosen.tool !== "eraser" || !tools.classList.contains("wiping")), choose({ tool }));
  const b = button(NAMES.tool[tool], take, acts);
  labelled(b, tool);
  return b;
});
acts.append(document.createElement("hr"));
const opener = button("Size, fade and colour", () => open(!tools.classList.contains("open")), acts);
// the buttons that show only while the card is open
for (const b of [back, again, line, picture]) b.classList.add("more");
const styles = group("row styles");
const sizes = [0, 1, 2].map((n) => button("", () => size(n), styles));
styles.append(document.createElement("hr"));
const fader = document.createElement("input");
Object.assign(fader, { id: "fader", type: "range", min: "0.1", max: "1", step: "0.05", title: "Fade" });
fader.addEventListener("input", () => choose({ opacity: Number(fader.value), tool: "pen" }));
styles.append(fader);
// the eraser's size: a slider from the narrowest eraser at its left to the widest at its right, each step widening it
// by the same factor, between a small and a big dot
const wiper = group("row wiper");
const slider = document.createElement("input");
Object.assign(slider, { id: "wiper", type: "range", min: "0", max: "1", step: "any", title: "Eraser size" });
const [least, most] = WIPE;
slider.value = String(Math.log(chosen.wipe / least) / Math.log(most / least));
wiper.append(Object.assign(document.createElement("i"), { className: "dot" }), slider);
wiper.append(Object.assign(document.createElement("i"), { className: "dot big" }));
// while the slider moves, the circle shows the eraser's size in the middle of the sheet
slider.addEventListener("input", () => {
  chosen.wipe = least * (most / least) ** Number(slider.value);
  const box = canvas.getBoundingClientRect();
  ring(box.left + box.width / 2, box.top + box.height / 2);
});
slider.addEventListener("change", () => {
  circle.hidden = true;
  hooks.track("eraser_sized", { width: Math.round(chosen.wipe) });
});
const palette = group("colors");
const colors = PENS.map((color) => {
  const b = button(color, () => choose({ color, tool: "pen" }), palette);
  b.innerHTML = blob(color);
  return b;
});

/** Sets whether Undo and Redo are live: each is while no turn is with the agent and it has something to undo or redo. */
export function ready(): void {
  back.disabled = session.busy || !steps().undo;
  again.disabled = session.busy || !steps().redo;
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
 * Takes what the person chose, as some of the keys of `chosen`, and shows the tools anew: the pen's sizes and the
 * fade's slider are drawn in the chosen colour, and the pointer over the sheet takes the tool's look.
 */
function choose(change: Partial<typeof chosen>): void {
  Object.assign(chosen, change);
  TOOLS.forEach((tool, n) => mark(holders[n], chosen.tool === tool));
  sizes.forEach((b, n) => {
    b.title = NAMES.size[n];
    b.innerHTML = squiggle(thick(n));
    mark(b, SIZES[n] === chosen.pen);
  });
  fader.value = String(chosen.opacity);
  fader.style.setProperty("--ink", COLORS[chosen.color]);
  colors.forEach((b, n) => mark(b, PENS[n] === chosen.color));
  opener.innerHTML = blob(chosen.color);
  for (const tool of TOOLS) canvas.classList.toggle(tool, chosen.tool === tool);
  if (chosen.tool !== "eraser") wipes(false);
  if (chosen.tool !== "select") letGo();
}

// Takes the n-th of the pen's sizes, which takes up the pen; the fade and the colours take up the pen too.
function size(n: number): void {
  choose({ pen: SIZES[n], tool: "pen" });
}

/** Opens or closes the rows of the pen's sizes, fade and colours, which closes the eraser's size. */
function open(on: boolean): void {
  tools.classList.toggle("open", on);
  mark(opener, on);
  if (on) wipes(false);
}

/** Opens or closes the eraser's size, which closes the pen's rows. */
function wipes(on: boolean): void {
  tools.classList.toggle("wiping", on);
  if (on) open(false);
}

/** Shows the circle the eraser rubs out, centred at (x, y) on the window, as wide as the eraser is at this zoom. */
function ring(x: number, y: number): void {
  const d = chosen.wipe * view.scale;
  Object.assign(circle.style, {
    width: `${d}px`,
    height: `${d}px`,
    transform: `translate(${x - d / 2}px, ${y - d / 2}px)`,
  });
  circle.hidden = false;
}

// The circle follows the pointer while the person holds the eraser: a mouse or a pen over the sheet, or a finger on it.
canvas.addEventListener("pointermove", (e) =>
  chosen.tool === "eraser" ? ring(e.clientX, e.clientY) : (circle.hidden = true),
);
canvas.addEventListener("pointerleave", () => (circle.hidden = true));
canvas.addEventListener("pointerdown", () => (open(false), wipes(false)));
choose({});
