/**
 * The few words beside the buttons: what the agent is doing, with a pulsing dot, what went wrong, or a link to open
 * or copy.
 */
const caption = document.getElementById("caption")!;

/** Shows `text`, as something the agent is busy with if `doing`. */
export function say(text: string, doing = false): void {
  caption.textContent = text;
  caption.className = doing ? "busy" : "";
}

/** Shows `text` followed by `link`, which the person can open in a new tab, or copy by right-clicking or holding it. */
export function sayLink(text: string, link: string): void {
  const a = document.createElement("a");
  a.href = a.textContent = link;
  a.target = "_blank";
  caption.replaceChildren(`${text} `, a);
  caption.className = "";
}
