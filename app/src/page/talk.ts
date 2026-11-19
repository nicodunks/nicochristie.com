/**
 * The swirl, the page's main way in, which is dictation. The person taps the swirl and talks, and the browser's own
 * speech recogniser (Safari and Chrome have one) writes their words on one line above the swirl as they speak. Tapping
 * the swirl again sends those words as the turn, with any new drawing, as if the person had typed them and pressed
 * Send; words finished while a turn is under way wait and are sent when that turn ends. The swirl is grey at rest, in
 * colour while it listens, and under the mouse shows its ink outline and moves more, to say it can be pressed.
 *
 * A drawing needs no words. While the person has drawn something the agent has not seen and the swirl is not
 * listening, the caption under the swirl says "Send" with Send's arrow, the swirl turns to colour, and a tap sends the
 * drawing as it is. Otherwise the caption says "Tap me to talk" at rest, "Send" while the swirl listens, and what the
 * agent is doing during a turn; tapping it while it says "Tap me to talk" or "Send" is tapping the swirl.
 *
 * (nicochristie.com's version: /draw's rests as a microphone with a separate Send beside it.)
 *
 * The recogniser stops by itself after a pause, so while the person has not tapped again it starts once more, after the
 * words already heard. When it fails, as when the microphone is blocked, the caption says why and the event
 * voice_failed records its error, and any words heard are still sent.
 */
import { done, watch } from "../canvas/history.ts";
import { session } from "../canvas/state.ts";
import { mayGoOn } from "./account.ts";
import { ready } from "./buttons.ts";
import { say } from "./caption.ts";
import { spoken } from "./state.ts";
import { swirl } from "./swirl.ts";
import { track } from "./track.ts";
import { afterTurn, voiced } from "./turn.ts";

const button = document.getElementById("talk")!;
const box = document.getElementById("say") as HTMLInputElement;
const send = document.getElementById("send") as HTMLButtonElement;
const composer = document.getElementById("composer")!;
const caption = document.getElementById("caption")!;
const heard = document.querySelector("#heard span")!; // the one line above the swirl

const PROMPT = "Tap me to talk";
const SEND = "Send"; // the caption while the swirl listens or the drawing is new, since the next tap sends

// The composer is the swirl, with the caption under it.
composer.classList.add("live");
composer.append(caption);

// Each new line of the caption grows out of the swirl again, and when the caption is emptied while the swirl does not
// listen, it asks to be tapped. While it asks to be tapped or says Send, the composer is marked asking, which makes the
// caption larger and tappable; while it says Send, the composer is also marked sending, which puts Send's arrow after it.
new MutationObserver(() => {
  composer.classList.toggle("asking", caption.textContent === PROMPT || caption.textContent === SEND);
  composer.classList.toggle("sending", caption.textContent === SEND);
  if (!caption.textContent && !spoken.listening) return say(rest());
  for (const a of caption.getAnimations()) {
    a.cancel();
    a.play();
  }
}).observe(caption, { childList: true, characterData: true, subtree: true });

/** Returns what the caption says while the swirl does not listen and no turn is under way. */
const rest = (): string => (done().length ? SEND : PROMPT);

// Drawing, erasing, Undo and Redo may make the drawing new or not, which turns the resting caption to Send or back.
watch(() => {
  if (!spoken.listening && !session.busy && [PROMPT, SEND].includes(caption.textContent ?? "") && caption.textContent !== rest())
    say(rest());
});

let wanted = false; // whether the person wants the swirl listening: from the tap that starts it to the tap that sends
let tapped = false; // whether the person's tap, not an error, stopped the listening, so that a drawing alone is sent
let kept = ""; // the words heard before the recogniser last started again
let words = ""; // the words heard since the tap that started it
let began = 0; // when the swirl started listening, from performance.now()
const waiting: string[] = []; // words finished while a turn was under way, oldest first

// Sends words, which may be none beside a new drawing, as the person's turn: they go in the box, and Send sends them.
function ask(request: string): void {
  voiced();
  box.value = request;
  box.dispatchEvent(new Event("input"));
  send.click();
}

// When a turn ends, sends the next words that waited for it.
afterTurn(() => {
  const next = waiting.shift();
  if (next) ask(next);
});

interface Recogniser extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
}
type Heard = Event & { results: ArrayLike<ArrayLike<{ transcript: string }>>; error?: string };
/** What the person is told for each error of the recogniser; any other error, such as network, means the browser
 * cannot reach its speech service, which Chrome has but browsers built from it, such as Arc, may not. */
const TROUBLE: Record<string, string> = {
  "not-allowed": "The microphone is blocked. Allow it in the browser's settings, or type instead.",
  "audio-capture": "No microphone was found. Type instead.",
  "no-speech": "No words were heard. Tap me and try again, or type instead.",
  "service-not-allowed": "Dictation needs to be turned on in your device's settings. Type instead.",
};
const Made = window as unknown as Record<string, (new () => Recogniser) | undefined>;
const Kind = Made.SpeechRecognition ?? Made.webkitSpeechRecognition;
const ear = Kind ? new Kind() : null;
if (ear) {
  ear.continuous = ear.interimResults = true;
  ear.lang = "en-US";
  ear.addEventListener("result", (e) => {
    const now = Array.from((e as Heard).results, (x) => x[0].transcript).join(" ");
    words = `${kept} ${now}`.replace(/\s+/g, " ").trim();
    heard.textContent = words;
  });
  ear.addEventListener("error", (e) => {
    const error = (e as Heard).error ?? "";
    if (error === "aborted") return;
    wanted = false;
    track("voice_failed", { error });
    say(TROUBLE[error] ?? "Dictation isn't working in this browser. Type instead.");
  });
  // The recogniser has stopped: by itself, so it starts again; or at the person's tap or an error, so the words go.
  ear.addEventListener("end", () => {
    if (wanted) {
      kept = words;
      return ear.start();
    }
    track("spoke", {
      duration_ms: Math.round(performance.now() - began),
      props: { words: words.split(/\s+/).filter(Boolean).length },
    });
    spoken.listening = false;
    button.classList.remove("listening");
    button.title = "Tap to talk";
    heard.textContent = "";
    ready();
    if (caption.textContent === SEND) say(""); // which shows the resting caption again, until a turn says what it does
    if (words && session.busy) waiting.push(words);
    else if (words || (tapped && !session.busy && done().length)) ask(words);
    tapped = false;
  });
}

// Starts listening, with no words heard yet.
function listen(recogniser: Recogniser): void {
  wanted = spoken.listening = true;
  tapped = false;
  kept = words = heard.textContent = "";
  began = performance.now();
  button.classList.add("listening");
  button.title = "Tap to send";
  say(SEND);
  ready();
  recogniser.start();
}

button.addEventListener("click", async () => {
  if (!spoken.listening && !session.busy && done().length) {
    // a new drawing and the swirl not listening: the tap sends the drawing as it is, with no words
    voiced();
    return send.click();
  }
  if (!ear) return say("This browser cannot write down speech. Type instead.");
  if (spoken.listening) {
    wanted = false;
    tapped = true;
    return ear.stop();
  }
  if (await mayGoOn("Sign in to talk with me.")) listen(ear);
});
// tapping the caption while it says "Tap me to talk" or "Send" is tapping the swirl
caption.addEventListener("click", () => composer.classList.contains("asking") && button.click());
// the swirl swells and ripples, as if it heard a voice: a little while it listens, and more under the mouse
swirl(button.querySelector("svg")!, () => (button.matches(":hover") ? 0.6 : spoken.listening ? 0.3 : 0));
button.title = "Tap to talk";
say(rest());
