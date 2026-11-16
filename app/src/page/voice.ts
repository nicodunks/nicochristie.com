/**
 * The person's voice. Speak starts a spoken note, and the browser's own speech recogniser (Safari and Chrome have one)
 * writes the person's words into it while they speak. The notes show at the bottom left, each as a chat bubble of its
 * words on one line, which a tap opens to all its words and an × that drops it. A note the agent has been given is
 * faded. The notes are a chat column three bubbles high with the newest at the bottom, and a swipe up on it shows the
 * older ones.
 *
 * A person can type a note instead of speaking it, for a desk or a quiet room. Type starts a note as Speak does, but
 * the note holds a box that the person types the words into. Enter ends the note and sends the turn, and Type again
 * ends the note without sending it. The agent is given a typed note exactly as it is given a spoken one.
 */
import { say } from "./caption.ts";
import { labelled } from "./icons.ts";
import { type Note, session, spoken } from "./state.ts";
import { ready } from "./tools.ts";

const strip = document.getElementById("notes")!;
const speak = document.getElementById("speak")!;
const type = document.getElementById("type")!;
const send = document.getElementById("send") as HTMLButtonElement;
let box: HTMLInputElement | null = null; // the box of the note being typed, while one is
let shown = 0; // how many notes the column showed, so that it scrolls to the newest only when one is added

/** Shows the notes as bubbles of their words. An open note shows all its words, and its × once the person has finished speaking it. */
export function list(): void {
  strip.replaceChildren(
    ...spoken.notes.map((n) => {
      const chip = document.createElement("div"),
        words = document.createElement("span"),
        drop = document.createElement("button");
      chip.className = ["note", n.sent && "sent", n.open && "open"].filter(Boolean).join(" ");
      if (box && n === spoken.heard) {
        chip.classList.add("typing");
        chip.append(box);
        return chip;
      }
      words.textContent = n.text || "Listening…";
      chip.append(words);
      chip.addEventListener("click", () => {
        n.open = !n.open;
        list();
      });
      drop.textContent = "×";
      drop.addEventListener("click", (e) => {
        e.stopPropagation();
        spoken.notes = spoken.notes.filter((x) => x !== n);
        list();
        ready();
      });
      if (n.open && n !== spoken.heard) chip.append(drop);
      return chip;
    }),
  );
  if (spoken.notes.length > shown) strip.scrollTop = strip.scrollHeight;
  shown = spoken.notes.length;
  older();
}

// Fades the column's top while older notes are scrolled out of sight above it.
const older = () => strip.classList.toggle("more", strip.scrollTop > 0);
strip.addEventListener("scroll", older);

// The recogniser stops when the person presses Speak again, and by itself after a long pause.
interface Recogniser extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
}
type Heard = Event & { results: ArrayLike<ArrayLike<{ transcript: string }>>; error?: string };
const Made = window as unknown as Record<string, (new () => Recogniser) | undefined>;
const Kind = Made.SpeechRecognition ?? Made.webkitSpeechRecognition;
const ear = Kind ? new Kind() : null;
if (ear) {
  ear.continuous = ear.interimResults = true;
  ear.lang = "en-US";
  ear.addEventListener("result", (e) => {
    const r = (e as Heard).results;
    spoken.heard!.text = Array.from(r, (x) => x[0].transcript)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    list();
  });
  ear.addEventListener("error", (e) => say(`Could not listen: ${(e as Heard).error}`));
  ear.addEventListener("end", () => {
    labelled(speak, "mic");
    speak.title = "Speak";
    speak.classList.remove("on");
    ended();
  });
}

/** Starts a new note, which is open while it is heard or typed. */
function started(): void {
  const heard: Note = { text: "", sent: false, open: true };
  spoken.heard = heard;
  spoken.notes.push(heard);
  speak.toggleAttribute("disabled", Boolean(box));
  type.toggleAttribute("disabled", !box);
  say("");
  list();
  ready();
}

/** Ends the note being heard or typed, which closes to a bubble of its words. A note with no words is dropped. */
function ended(): void {
  if (!spoken.heard?.text) spoken.notes = spoken.notes.filter((n) => n !== spoken.heard);
  else spoken.heard.open = false;
  spoken.heard = null;
  speak.removeAttribute("disabled");
  type.removeAttribute("disabled");
  list();
  ready();
}

// Speak starts a note, and pressing it again ends the note.
speak.addEventListener("click", () => {
  if (!ear) return say("This browser cannot write down speech.");
  if (spoken.heard) return ear.stop();
  labelled(speak, "stop");
  speak.title = "Stop";
  speak.classList.add("on");
  started();
  ear.start();
});

// Ends the note being typed, with the words in its box.
function typed(): void {
  spoken.heard!.text = box!.value.replace(/\s+/g, " ").trim();
  box = null;
  type.title = "Type";
  type.classList.remove("on");
  ended();
}

type.addEventListener("click", () => {
  if (box) return typed();
  box = document.createElement("input");
  box.placeholder = "Tell it what to draw…";
  box.enterKeyHint = "send"; // a phone's keyboard labels its Enter key Send
  box.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    typed();
    if (!session.busy) send.click();
  });
  type.title = "Stop typing";
  type.classList.add("on");
  started();
  box.focus();
});
