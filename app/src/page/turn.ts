/**
 * The agent's turn, when the person presses Send. The page tells the agent what the person did and said since its last
 * turn, as a picture of what they see and a few lines of words, the first of which names the style they chose, and
 * the canvas carries out the agent's answer as it arrives.
 *
 * The agent's code may also search the web and download files. The run worker asks the page for these, and the page
 * asks the gateway.
 */
import { Refused } from "./conversation.ts";
import { finish, settle } from "../canvas/effects.ts";
import * as environment from "../canvas/environment.ts";
import { still } from "../canvas/environment.ts";
import { told } from "../canvas/history.ts";
import { hook } from "../canvas/hooks.ts";
import { session, sheet } from "../canvas/state.ts";
import { ready } from "./buttons.ts";
import type { Need } from "../run/run.ts";
import { check, mayGoOn, offer, post, showBalance } from "./account.ts";
import { chosenEffort, chosenModel } from "./model.ts";
import { say } from "./caption.ts";
import { chosenStyle } from "./style.ts";
import { changed } from "./drawings.ts";
import { drawing, named, spoken } from "./state.ts";
import { refresh } from "./trace.ts";
import { tally, track } from "./track.ts";
import { list, typed } from "./voice.ts";

let stopper = new AbortController();

/** What the agent is told first in the turn that opens a visit (greet, below), before the person has done anything. */
const LANDED = "Someone landed on the page!";
/**
 * What the agent's welcome may be about: each visit is given one of Nico's themes, picked by chance, so that visits
 * differ. A theme is only a subject: what the agent draws of it is left to the agent.
 */
const THEMES = ["Miami", "birds", "the beach", "Dragon Ball Z"];
let opening = false; // the next turn is the one that opens the visit
const ended: (() => void)[] = []; // what runs after each turn

/** Has `fn` called after each turn ends, however it ended. */
export function afterTurn(fn: () => void): void {
  ended.push(fn);
}

/** Returns the result of what the agent's code asked the page for: Brave's answer to a search, or a downloaded file. */
async function serve(need: Need): Promise<unknown> {
  const r =
    need.fn === "download"
      ? await post("api/download", { url: need.url }, stopper.signal)
      : await post("api/search", { endpoint: need.endpoint, params: need.params }, stopper.signal);
  if (!r.ok) throw new Error((await r.text()) || `the server answered ${r.status}`);
  if (need.fn !== "download") return r.json();
  return { type: r.headers.get("content-type") ?? "", data: new Uint8Array(await r.arrayBuffer()) };
}

let byVoice = false; // whether the swirl or live voice sends the next turn
let begun = 0; // when the newest turn began, from Date.now()
const SURE = 500; // how long after Send a press of Stop is taken as the second tap of a double-tap, in milliseconds

/** Marks the next turn as sent by the swirl or live voice, for its event. */
export function voiced(): void {
  byVoice = true;
}

/** Sends the person's turn and carries out the agent's answer. */
async function turn(): Promise<void> {
  const via = byVoice ? "voice" : "send";
  byVoice = false;
  Object.assign(session, { busy: true, hurry: false });
  stopper = new AbortController();
  const began = (begun = Date.now()),
    style = chosenStyle(), // the style the turn is drawn in, as chosen when it starts
    id = named(), // the turn's name, which each of its calls carries to the gateway
    saying = spoken.notes.filter((n) => !n.sent),
    { seen, words, acts } = await environment.observe(saying.map((n) => n.text));
  // The turn that opens a visit was not asked for: its bot check never questions the person, it cannot move their view,
  // and what it fails with is not shown.
  const first = opening;
  opening = check.quiet = still.view = false;
  if (first) check.quiet = still.view = true;
  const greeting = first
    ? `${LANDED} Welcome them with a small drawing on the theme of ${THEMES[Math.floor(Math.random() * THEMES.length)]}: what you draw of it is up to you, so surprise them. Draw it inside what the picture shows, and do not move their view: do not call show() in this turn.\n\n`
    : "";
  told();
  // how the turn went, for its event
  const went = { calls: 0, runs: 0, first: 0, errors: [] as string[], outcome: "done", error: "" };
  hook({ inked: () => (went.first ||= Date.now() - began) });
  for (const n of saying) Object.assign(n, { sent: true, open: false });
  list();
  ready();

  try {
    await drawing.agent.turn(
      [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: seen.picture } },
        { type: "text", text: `Style: ${style}.\n\n${greeting}${words}` },
      ],
      {
        signal: stopper.signal,
        model: chosenModel(),
        effort: chosenEffort(),
        post: (path, body, signal) => {
          if (path !== "api/messages") return post(path, body, signal);
          went.calls++;
          return post(path, { ...(body as object), turn: id }, signal);
        },
        ran: (r) => {
          went.runs++;
          if (r.error) went.errors.push(r.error);
        },
        doing: (text) => say(text + "…", true),
        environment: {
          wrote: environment.wrote,
          finish: environment.finish,
          answer: environment.answer,
          stop: environment.stop,
        },
      },
    );
    say("");
  } catch (err) {
    // the conversation keeps every message that arrived, and the next turn goes on from there
    went.error = err instanceof Error ? err.message : String(err);
    went.outcome = err instanceof Refused ? "refused" : stopper.signal.aborted ? "stopped" : "failed";
    if (first) say("");
    else if (err instanceof Refused)
      offer(err.message); // no credits left: the card offers more
    else if (!stopper.signal.aborted) say(`Something went wrong: ${went.error}`);
    else say("");
  }
  if (stopper.signal.aborted) went.outcome = "stopped";
  const answered = Date.now() - began;
  await finish();
  tally("turns");
  if (went.outcome === "stopped") tally("stops");
  track("turn", {
    page: drawing.agent.page,
    turn: id,
    model: chosenModel(),
    mode: style,
    effort: chosenEffort(),
    duration_ms: Date.now() - began,
    error: went.outcome === "stopped" ? "" : went.error,
    props: {
      via,
      outcome: went.outcome,
      said: saying.map((n) => n.text),
      words: saying.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0),
      strokes: acts.filter((a) => a.startsWith("drew")).length,
      erases: acts.filter((a) => a.startsWith("erased")).length,
      first_ink_ms: went.first,
      answered_ms: answered,
      calls: went.calls,
      runs: went.runs,
      errors: went.errors,
      number: drawing.agent.history.filter(
        (m) => m.role === "user" && typeof m.content !== "string" && m.content.some((b) => b.type === "text"),
      ).length,
      marks: sheet.marks.length,
      person_marks: sheet.marks.filter((m) => m.by === "person").length,
    },
  });
  settle();
  check.quiet = still.view = false;
  session.busy = false;
  ready();
  changed();
  void refresh();
  void showBalance();
  for (const fn of ended) fn();
}

// Send, in the composer, sends the person's turn, with what they typed, once they may talk to the agent. While a turn is with
// the agent it reads Stop, which ends the turn: its requests are dropped, and the agent's ink that is on the sheet shows
// at once. A phone's double-tap on Send would land its second tap on Stop, so a person's tap on Stop counts only SURE
// after the turn begins; the swirl and live voice, which press Send from the page's code, count at once.
/** Sends the turn, or stops the turn under way. */
async function pressed(): Promise<void> {
  if (!session.busy) {
    typed(); // the words in the box are the turn's newest note
    return void ((await mayGoOn("Sign in, and it draws back.")) && turn());
  }
  session.hurry = true;
  stopper.abort();
}
document.getElementById("send")!.addEventListener("click", (e) => {
  if (e.isTrusted && session.busy && Date.now() - begun < SURE) return; // the second tap of a double-tap
  void pressed();
});
hook({ serve });

/**
 * Opens the visit (nicochristie.com's own): gives the agent a turn of its own as soon as the page is seen, in which it is
 * told LANDED and one of THEMES and shown the sheet, so that it paints its welcome before the person has done anything.
 * A page opened in a tab that is not showing waits until it shows.
 */
export function greet(): void {
  const go = () => {
    if (document.visibilityState !== "visible" || session.busy) return;
    document.removeEventListener("visibilitychange", go);
    opening = true;
    void turn();
  };
  document.addEventListener("visibilitychange", go);
  go();
}
