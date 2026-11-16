/**
 * What shows where the eraser is. While the person holds the eraser, the pointer over the sheet is a small eraser, and
 * around its point is a ring the shape and size of what the eraser rubs out: a circle as wide as the eraser's chosen
 * width, at the sheet's zoom. A mouse or a pen shows the ring wherever it hovers; a finger, which cannot hover, shows
 * it while it rubs.
 */
import { chosen } from "./pen.ts";
import { session } from "./state.ts";
import { canvas, view } from "./view.ts";

const ring = document.createElement("div");
ring.id = "rubber";
ring.hidden = true;
document.body.append(ring);

/** Puts the ring around the pointer if the person holds the eraser, and takes it away if they do not. */
function follow(e: PointerEvent): void {
  const erasing = chosen.tool === "eraser";
  canvas.classList.toggle("eraser", erasing);
  ring.hidden = !erasing || session.busy || (e.pointerType === "touch" && e.buttons === 0);
  if (ring.hidden) return;
  const across = chosen.wipe * view.scale; // the eraser's width in window pixels
  ring.style.width = ring.style.height = `${across}px`;
  ring.style.transform = `translate(${e.clientX - across / 2}px, ${e.clientY - across / 2}px)`;
}

for (const name of ["pointerenter", "pointermove", "pointerdown"] as const) canvas.addEventListener(name, follow);
for (const name of ["pointerleave", "pointercancel"] as const)
  canvas.addEventListener(name, () => (ring.hidden = true));
canvas.addEventListener("pointerup", (e) => {
  if (e.pointerType === "touch") ring.hidden = true;
});

/**
 * Shows the ring in the middle of the window at the eraser's size, while the person sets that size with its slider;
 * or takes it away.
 */
export function preview(on: boolean): void {
  ring.hidden = !on;
  if (!on) return;
  const across = chosen.wipe * view.scale;
  ring.style.width = ring.style.height = `${across}px`;
  ring.style.transform = `translate(${(innerWidth - across) / 2}px, ${(innerHeight - across) / 2}px)`;
}
