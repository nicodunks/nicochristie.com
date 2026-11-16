/**
 * The page's requests to the gateway, the Worker at API. No one signs in: anyone can draw and send. The gateway takes
 * a drawing's first request only with a Turnstile token, which proves a browser and not a script sent it, so when the
 * gateway answers 403 with the header x-check, post() gets a token, without showing anything, and asks again.
 */
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

let script: Promise<void> | undefined, sitekey: Promise<string> | undefined;

/** Resolves with a Turnstile token for the action "sheet"; fails if Turnstile would stop to question the person. */
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
    const box = document.createElement("div");
    box.hidden = true;
    document.body.append(box);
    let widget: string | undefined;
    const end = (error?: Error, got?: string) => {
      clearTimeout(timer);
      if (widget !== undefined) turnstile.remove(widget);
      box.remove();
      if (error) fail(error);
      else done(got!);
    };
    const timer = setTimeout(() => end(new Error("the bot check took too long")), 60_000);
    widget = turnstile.render(box, {
      sitekey: key,
      action: "sheet",
      appearance: "interaction-only",
      callback: (got: string) => end(undefined, got),
      "error-callback": () => end(new Error("the bot check failed")),
      "before-interactive-callback": () => end(new Error("the bot check wants an answer")),
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
