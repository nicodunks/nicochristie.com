/**
 * The page's requests to the gateway, the Worker at API. No one signs in: anyone can draw, talk and send, and the
 * Worker bounds what it spends instead. It takes a drawing's first request only with a Turnstile token, which proves a
 * browser and not a script sent it, so when it answers 403 with the header x-check, post() gets a token and asks again.
 * Getting one shows nothing, unless Turnstile has a question for the person (check, below).
 *
 * /draw's version of this module signs people in and holds their credits; this one keeps its functions, so the modules
 * taken from /draw need no change.
 */
import { say } from "./caption.ts";
import { drawing } from "./state.ts";

// The Worker's address. On this computer it is the `wrangler dev` server, since the deployed Worker takes requests only
// from the site itself; ?api= names another.
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname),
  API = LOCAL
    ? (new URLSearchParams(location.search).get("api") ?? "http://localhost:8788")
    : document.querySelector<HTMLMetaElement>('meta[name="draw-api"]')!.content;

interface Turnstile {
  render(box: HTMLElement, options: Record<string, unknown>): string;
  remove(widget: string): void;
}
declare const turnstile: Turnstile;

/**
 * Whether the bot check stays out of sight. The turn that opens a visit sets `quiet`, since the person did not ask for
 * it: then a check that would stop to question the person fails instead. Otherwise such a check shows its box at the
 * top of the window, for the person to answer, and the request goes on once they have.
 */
export const check = { quiet: false };

let script: Promise<void> | undefined, sitekey: Promise<string> | undefined;

/** Resolves with a Turnstile token for the action "sheet"; fails if the check fails, or is quiet and has a question. */
async function token(): Promise<string> {
  script ??= new Promise((done, fail) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.onload = () => done();
    s.onerror = () => {
      script = undefined;
      fail(new Error("the bot check did not load"));
    };
    document.head.append(s);
  });
  sitekey ??= fetch(`${API}/api/config`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("the server could not be reached"))))
    .then((c: { sitekey: string }) => c.sitekey);
  sitekey.catch(() => (sitekey = undefined));
  const [key] = await Promise.all([sitekey, script]);
  return new Promise((done, fail) => {
    const box = document.createElement("div"),
      quiet = check.quiet;
    box.id = "check";
    box.hidden = quiet;
    document.body.append(box);
    let widget: string | undefined;
    const end = (error?: Error, got?: string) => {
      clearTimeout(timer);
      if (widget !== undefined) turnstile.remove(widget);
      box.remove();
      if (error) fail(error);
      else done(got!);
    };
    const timer = setTimeout(() => end(new Error("the bot check took too long")), 120_000);
    widget = turnstile.render(box, {
      sitekey: key,
      action: "sheet",
      appearance: "interaction-only",
      callback: (got: string) => end(undefined, got),
      "error-callback": () => end(new Error("the bot check failed")),
      ...(quiet && { "before-interactive-callback": () => end(new Error("the bot check wants an answer")) }),
    });
  });
}

/** POSTs body to the gateway as JSON, for the open drawing, and returns the response. */
export async function post(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  const send = (more: object = {}) =>
    fetch(`${API}/api/draw/${path.replace(/^api\//, "")}`, {
      method: "POST",
      body: JSON.stringify({ page: drawing.agent.page, ...(body as object), ...more }),
      signal,
      headers: { "content-type": "application/json" },
    });
  const r = await send();
  if (r.status !== 403 || !r.headers.has("x-check")) return r;
  return send({ token: await token() });
}

/** Returns whether the person may go on to what needs an account: always, here, since no one signs in. */
export async function mayGoOn(_reason: string): Promise<boolean> {
  return true;
}

/** Says why a turn was refused, such as the Worker's spending cap: /draw offers credits here, this site only says so. */
export function offer(reason: string): void {
  say(reason);
}

/** Shows the person's balance of credits: none here. */
export async function showBalance(): Promise<void> {}
