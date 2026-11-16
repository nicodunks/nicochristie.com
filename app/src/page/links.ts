/**
 * The links in the words about Nico (about.ts). The words are ink, which cannot be a link, so the page follows a tap
 * on a link's ink itself: a press on it that lifts where it started opens what LINKS has for the ink's part, and draws
 * nothing. A mouse over a link's ink shows the hand that links show. Ink the agent has erased is no link any more, and
 * ink it has moved is a link where it is now.
 *
 * This module is loaded before input.ts, so its listeners on the sheet run first and keep such a press from input.ts.
 */
import { boxOf } from "../paint/sheet.ts";
import { LINKS } from "./about.ts";
import { sheet } from "./state.ts";
import { canvas, pageAt } from "./view.ts";

const REACH = 4; // how far outside a link's ink a tap still counts, in page units
const STILL = 8; // how far a press may move and still be a tap, in window pixels
let pressed: { pointer: number; x: number; y: number; href: string } | null = null;

/** Returns where the link's ink under the window's point (px, py) leads, if there is such ink. */
function linkAt(px: number, py: number): string | undefined {
  const [x, y] = pageAt(px, py);
  for (const m of sheet.marks) {
    if (m.by !== "agent" || !m.part || !Object.hasOwn(LINKS, m.part)) continue;
    const b = boxOf(m);
    if (x >= b.x - REACH && x <= b.x + b.width + REACH && y >= b.y - REACH && y <= b.y + b.height + REACH)
      return LINKS[m.part];
  }
  return undefined;
}

canvas.addEventListener("pointerdown", (e) => {
  const href = e.isPrimary && e.button === 0 ? linkAt(e.clientX, e.clientY) : undefined;
  if (!href) return;
  pressed = { pointer: e.pointerId, x: e.clientX, y: e.clientY, href };
  e.stopImmediatePropagation();
});
canvas.addEventListener("pointermove", (e) => {
  if (pressed?.pointer === e.pointerId) return e.stopImmediatePropagation();
  if (e.pointerType === "mouse") canvas.style.cursor = linkAt(e.clientX, e.clientY) ? "pointer" : "";
});
canvas.addEventListener("pointerup", (e) => {
  if (pressed?.pointer !== e.pointerId) return;
  e.stopImmediatePropagation();
  const { x, y, href } = pressed;
  pressed = null;
  if (Math.hypot(e.clientX - x, e.clientY - y) > STILL) return;
  if (href.startsWith("mailto:")) location.href = href;
  else window.open(href, "_blank", "noopener");
});
window.addEventListener("pointercancel", (e) => {
  if (pressed?.pointer === e.pointerId) pressed = null;
});
