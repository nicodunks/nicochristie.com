/**
 * The person's typed side of the conversation, at the bottom left: the keyboard button and the typing bar it opens. It
 * also keeps the notes, each the words of one thing the person said, which go with the drawing. The notes are built as
 * a column of bubbles above the swirl but never shown.
 *
 * The keyboard button gives its place to the typing bar, a box to type in with Send at its right, and comes back when
 * the box is left empty or Escape is pressed. Send, the
 * page's one Send, shows only while the box holds words or a turn can be stopped. The composer counts as open while
 * the person types or the box holds words. Enter or Send makes the words in the box a note and sends the turn.
 */
import { session } from "../canvas/state.ts";
import { spoken } from "./state.ts";
import { ready } from "./buttons.ts";
import { track } from "./track.ts";

const strip = document.getElementById("notes")!;
const box = document.getElementById("say") as HTMLInputElement;
const send = document.getElementById("send") as HTMLButtonElement;
const composer = document.getElementById("composer")!;
const typing = document.getElementById("typing")!;

/** Marks the composer open while the person types or its box holds words, which shows the notes. */
function fold(): void {
  const open = document.activeElement === box || box.value !== "";
  if (open && !composer.classList.contains("open")) track("composer_opened");
  composer.classList.toggle("open", open);
}
fold();
box.addEventListener("focus", fold);
box.addEventListener("blur", fold);
let shown = 0; // how many notes the column showed, so that it scrolls to the newest only when one is added

/** Shows the notes as bubbles of their words. An open note shows all its words, and its ×. */
export function list(): void {
  strip.replaceChildren(
    ...spoken.notes.map((n) => {
      const chip = document.createElement("div"),
        words = document.createElement("span"),
        drop = document.createElement("button");
      chip.className = ["note", n.sent && "sent", n.open && "open"].filter(Boolean).join(" ");
      words.textContent = n.text;
      chip.append(words);
      chip.addEventListener("click", () => {
        n.open = !n.open;
        list();
      });
      drop.textContent = "×";
      drop.title = "Drop";
      drop.addEventListener("click", (e) => {
        e.stopPropagation();
        spoken.notes = spoken.notes.filter((x) => x !== n);
        list();
        ready();
      });
      if (n.open) chip.append(drop);
      return chip;
    }),
  );
  if (spoken.notes.length > shown) strip.scrollTop = strip.scrollHeight;
  shown = spoken.notes.length;
  older();
}

// Fades the column's top while older notes are out of sight above it.
const older = () => strip.classList.toggle("more", strip.scrollTop > 0);
strip.addEventListener("scroll", older);

/** Makes the words in the box a note for the agent's next turn, and empties the box. */
export function typed(): void {
  const text = box.value.replace(/\s+/g, " ").trim();
  box.value = spoken.draft = "";
  fold();
  if (!text) return;
  spoken.notes.push({ text, sent: false, open: false });
  list();
  ready();
}

// The composer's buttons leave the box focused when pressed, so that on a phone the composer stays open under the finger.
for (const b of document.querySelectorAll("#composer button, #field button"))
  b.addEventListener("pointerdown", (e) => e.preventDefault());

box.addEventListener("input", () => {
  spoken.draft = box.value;
  fold();
  ready();
});
// Enter sends the turn, with the words typed as its note; Send itself takes the words in the box first. Enter never
// stops a turn, as Send does while one is with the agent.
box.addEventListener("keydown", (e) => {
  if (e.key === "Escape") return box.blur();
  if (e.key !== "Enter" || e.isComposing) return;
  e.preventDefault();
  if (!send.disabled && !session.busy) send.click();
});

// The keyboard button gives its place to the typing bar, with the box ready to type in; the button comes back when the
// box is left empty.
document.getElementById("keys")!.addEventListener("click", () => {
  typing.classList.add("on");
  box.focus();
});
box.addEventListener("blur", () => box.value || typing.classList.remove("on"));
