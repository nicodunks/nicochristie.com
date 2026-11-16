/**
 * Sends the person's turn by itself, WAIT after the last thing they did: a press or a lift of a pointer anywhere on
 * the page, or a key. Each such thing starts the wait again, so the turn goes only once they have stopped drawing and
 * typing. Nothing is sent while a pointer is still down, while a turn is with the agent, or when there is nothing the
 * agent has not been told of, which is when Send is not live. A note still being typed is ended first, as Enter ends
 * it, unless it has no words yet. While the wait runs, Send fills from its left edge.
 */
import { session } from "./state.ts";

const WAIT = 2000; // how long after the last thing the person did their turn is sent, in milliseconds
const send = document.getElementById("send") as HTMLButtonElement,
  notes = document.getElementById("notes")!;
let timer: ReturnType<typeof setTimeout> | undefined;
const down = new Set<number>(); // the pointers that are down

/** Returns whether the turn would be sent if the wait ended now: there is news for the agent, or a note with words. */
function due(): boolean {
  if (session.busy || down.size) return false;
  const box = notes.querySelector("input");
  return box ? Boolean(box.value.trim()) : !send.disabled;
}

/** Shows the wait on Send, as a fill that grows from its left edge for as long as the wait lasts; or takes it away. */
function fill(on: boolean): void {
  delete send.dataset.timing;
  if (!on) return;
  void send.offsetWidth; // lets the browser see the fill gone, so that it starts again from the left
  send.style.animationDuration = `${WAIT}ms`;
  send.dataset.timing = "";
}

function fire(): void {
  fill(false);
  if (!due()) return;
  const box = notes.querySelector("input");
  // Enter in the box ends the note and presses Send
  if (box) box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  else send.click();
}

/** Starts the wait again. */
function wait(): void {
  clearTimeout(timer);
  fill(false);
  // what the person just did reaches the page after this, so whether there is anything to send is known a moment later
  setTimeout(() => {
    clearTimeout(timer);
    fill(due());
    timer = setTimeout(fire, WAIT);
  });
}

/** Ends the wait with nothing sent. */
function drop(): void {
  clearTimeout(timer);
  fill(false);
}

window.addEventListener(
  "pointerdown",
  (e) => {
    // a press on Send is the person's own, and the turn it starts or stops is not followed by another
    if ((e.target as Element).closest?.("#send")) return drop();
    down.add(e.pointerId);
    wait();
  },
  true,
);
for (const name of ["pointerup", "pointercancel"] as const)
  window.addEventListener(
    name,
    (e) => {
      if (down.delete(e.pointerId)) wait();
    },
    true,
  );
window.addEventListener("keydown", (e) => e.isTrusted && wait(), true);
window.addEventListener("input", wait, true);
