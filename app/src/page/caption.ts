/**
 * The few words under the buttons: what the agent is doing, with a pulsing dot, what went wrong, or a note that goes
 * away by itself.
 */
const caption = document.getElementById("caption")!;

/** Shows `text`, as something the agent is busy with if `doing`. */
export function say(text: string, doing = false): void {
  caption.textContent = text;
  caption.className = doing ? "busy" : "";
}

/** Shows `text` for `seconds`, then takes it away, unless something else has been said since. */
export function sayFor(text: string, seconds: number): void {
  say(text);
  setTimeout(() => caption.textContent === text && say(""), seconds * 1000);
}
