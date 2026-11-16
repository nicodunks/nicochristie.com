/**
 * The agent's turn, when the person presses Send. The page tells the agent what the person did since its last turn,
 * as a picture of what they see and a few lines of words, and carries out the agent's answer as it arrives.
 *
 * The agent draws by writing code for its run tool. Each block of the code runs as soon as the agent has written it,
 * and the block's ops come back here. Each op changes the sheet at once, so the next block runs on a sheet that has
 * them, and a picture the agent asks for has all its ink. What the person sees follows in order, one effect after the
 * other: new ink is drawn stroke by stroke, moved ink glides, and a new animation starts once the ink before it has
 * appeared.
 *
 * The agent's code may also search the web and download files. The run worker asks the page for these, and the page
 * asks the gateway. A photo the person attached goes with their turn, as a picture and its path in the agent's folder.
 */
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { type Picture, Refused } from "../agent/loop.ts";
import { type Op, apply } from "../paint/ops.ts";
import { shrunk } from "../run/files.ts";
import { type Need, Run } from "../run/run.ts";
import { check, post } from "./account.ts";
import { described, shotAt, start, sync, tried } from "./animations.ts";
import { chosenEffort, chosenMode, chosenModel } from "./model.ts";
import { say } from "./caption.ts";
import { changed } from "./drawings.ts";
import { type Effect, finish, glide, hide, hold, pan, reveal, settle, show } from "./effects.ts";
import { tell } from "./history.ts";
import { pinned } from "./photos.ts";
import { picture } from "./picture.ts";
import { attached, drawing, folder, named, session, sheet, spoken } from "./state.ts";
import { ready } from "./tools.ts";
import { tally, track } from "./track.ts";
import { list } from "./voice.ts";
import { inView, redraw } from "./view.ts";

let stopper = new AbortController();

/** What the agent is told first in the turn that opens a visit, before the person has done anything. */
const LANDED = "Someone landed on the page!";
/**
 * What the agent's welcome may be about: each visit is given one of Nico's themes, picked by chance, so that visits
 * differ. A theme is only a subject: what the agent draws of it is left to the agent.
 */
const THEMES = ["Miami", "birds", "the beach"];
let opening = false; // the next turn is the one that opens the visit

/** Returns the lines numbered from 1. */
const numbered = (lines: string[]) => lines.map((line, i) => `${i + 1}. ${line}`);

/**
 * Returns the person's turn in words for the agent: what the picture shows, what the person said, what they did on
 * the page, and the animations on the page.
 */
function told(seen: Picture, said: string[], done: string[]): string {
  const low = sheet.lowest(),
    moving = described();
  return [
    `The picture shows the page from x = ${seen.left} to x = ${seen.right} and from y = ${seen.top} to y = ${seen.bottom}.`,
    low ? `The lowest ink on the page is at y = ${Math.round(low)}.` : "The page is blank.",
    "",
    ...(said.length ? ["The person said:", ...numbered(said), ""] : []),
    `What the person did on the page since your last turn${done.length ? ", in order:" : ": nothing."}`,
    ...numbered(done),
    ...(moving.length ? ["", ...moving] : []),
  ].join("\n");
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

/** Returns each photo the agent has not been given, as a picture and a line that says where it is in the folder. */
async function photos(): Promise<ContentBlockParam[]> {
  const given: ContentBlockParam[] = [];
  for (const p of attached.filter((p) => !p.sent)) {
    p.sent = true;
    const data = await shrunk(folder[p.path]).catch(() => undefined);
    if (data) given.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
    const line = data ? "The person attached this photo" : "The person attached a file that is not a picture";
    given.push({ type: "text", text: `${line}. It is in your folder as ${p.path}.` });
  }
  pinned();
  return given;
}

/** Sends the person's turn and carries out the agent's answer. */
async function turn(): Promise<void> {
  Object.assign(session, { busy: true, hurry: false });
  stopper = new AbortController();
  const began = Date.now(),
    id = named(), // the turn's name, which each of its calls carries to the gateway
    acts = tell(), // what the person did to the sheet since the last turn
    saying = spoken.notes.filter((n) => !n.sent),
    seen = picture(inView());
  const first = opening; // this turn opens the visit: the person did not ask for it, so nothing it fails with is shown
  opening = false;
  check.quiet = first;
  const words =
    (first ? `${LANDED} Welcome them with a small drawing on the theme of ${THEMES[Math.floor(Math.random() * THEMES.length)]}: what you draw of it is up to you, so surprise them. Draw it inside what the picture shows, and do not move their view: do not call show() in this turn.\n\n` : "") +
    told(
      seen,
      saying.map((n) => n.text),
      acts,
    );
  // how the turn went, for its event
  const went = { calls: 0, runs: 0, first: 0, errors: [] as string[], outcome: "done", error: "" };
  for (const n of saying) Object.assign(n, { sent: true, open: false });
  list();
  ready();
  const shown = await photos();

  // Carries out a block's ops on the sheet and lines up their effects. Resolves with what is wrong with the first op
  // that the page could not carry out, which the agent is told as the block's error.
  const applied = async (ops: Op[]): Promise<string | undefined> => {
    let wrong: string | undefined;
    const block: Effect[] = []; // the block's effects, which play as one block
    for (const op of ops) {
      try {
        const done = apply(sheet, op);
        if (done.did === "drew") {
          went.first ||= Date.now() - began;
          hide(done.marks);
          for (const m of done.marks) block.push(reveal(m));
        } else if (done.did === "moved") {
          hold(done);
          block.push(glide(done));
        } else if (done.did === "showed") {
          // the turn that opens the visit never moves what the person sees, whatever the agent's code asks
          if (!first) block.push(pan(done.view));
        }
        else if (done.did === "animated") {
          const bad = await tried(done);
          if (bad) wrong ??= bad;
          else block.push({ seconds: 0, step: () => start(done.animation.name) });
        }
      } catch (e) {
        wrong ??= e instanceof Error ? e.message : String(e);
      }
    }
    show(block);
    sync();
    redraw();
    if (wrong) went.errors.push(wrong);
    return wrong;
  };
  try {
    await drawing.agent.turn(
      [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: seen.picture } },
        { type: "text", text: words },
        ...shown,
      ],
      {
        signal: stopper.signal,
        model: chosenModel(),
        effort: chosenEffort(),
        mode: chosenMode(),
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
        run: () => new Run(() => sheet.snapshot(), folder, inView(), applied, serve),
        look: async (peek) => picture(peek, peek.t === undefined ? undefined : await shotAt(peek.t)),
      },
    );
    say("");
  } catch (err) {
    // the conversation keeps every message that arrived, and the next turn goes on from there
    went.error = err instanceof Error ? err.message : String(err);
    went.outcome = err instanceof Refused ? "refused" : stopper.signal.aborted ? "stopped" : "failed";
    if (first || stopper.signal.aborted) say("");
    else if (err instanceof Refused) say(err.message);
    else say(`Something went wrong: ${went.error}`);
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
    mode: chosenMode(),
    effort: chosenEffort() ?? "",
    duration_ms: Date.now() - began,
    error: went.outcome === "stopped" ? "" : went.error,
    props: {
      outcome: went.outcome,
      said: saying.map((n) => n.text),
      words: saying.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0),
      strokes: acts.filter((a) => a.startsWith("drew")).length,
      erases: acts.filter((a) => a.startsWith("erased")).length,
      photos: shown.filter((b) => b.type === "image").length,
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
  session.busy = false;
  ready();
  changed();
}

// Send sends the person's turn. While a turn is with the agent it reads Stop, which ends the
// turn: its requests are dropped, and the agent's ink that is on the sheet shows at once.
document.getElementById("send")!.addEventListener("click", () => {
  if (!session.busy) return void turn();
  session.hurry = true;
  stopper.abort();
});

/**
 * Opens the visit: gives the agent a turn of its own as soon as the page is seen, in which it is told LANDED and one
 * of THEMES and shown the sheet, so that it draws its welcome before the person has done anything. A page opened in a tab that is
 * not showing waits until it shows.
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
