/**
 * The drawing gateway: the part of the Worker between the homepage's sheet and Claude, ported from the drawing agent
 * at offpolicyinc.com/draw. The page keeps the sheet and the conversation and runs the agent's code; the gateway adds
 * the key, the prompt and the tool, and passes the conversation to the model.
 *
 *   POST /api/draw/messages   {page, model, mode?, messages, token?}: the conversation so far of the drawing `page`,
 *                             and the name of the model the page chose, one of MODELS: Sonnet with the pen, and
 *                             Sol, OpenAI's, with the brush (openai.ts), or Sonnet in its place while the secret
 *                             OPENAI_API_KEY is not set. The gateway sends it to
 *                             that model with the agent's prompt and tool, and streams the reply back as the SDK's
 *                             MessageStream lines.
 *   POST /api/draw/search     {page, endpoint, params, token?}: a search with the Brave Search API, for the agent's
 *                             code (web.ts); 503 unless the secret BRAVE_API_KEY is set
 *   POST /api/draw/download   {page, url, token?}: one file from the web, for the agent's code (web.ts)
 *
 * No one signs in, so three things bound what the agent can cost. Everything is refused in plain words, which the page
 * shows.
 * - A drawing's first request needs a Turnstile token with the action "sheet": without one the gateway answers 403
 *   with the header x-check, and the page gets a token and asks again. The drawing is then a row of draw_pages, and
 *   its later requests need no token. One connection may start 30 drawings in a rolling day and all visitors 200
 *   (migrations/0005_draw.sql).
 * - Each call to the model is a row of draw_calls with what it cost, in micros, millionths of a US dollar, at the
 *   model's list prices. Before a call starts it holds what HELD costs on its model, and it is refused with 402 once
 *   the drawing has spent DRAW_PAGE_CENTS, its connection DRAW_IP_CENTS in a rolling day, or all visitors together
 *   DRAW_DAY_CENTS in a rolling day. When the call ends its row is set to what it cost; a call that failed costs
 *   nothing.
 * - Each connection may make 60 requests a minute (DRAW_LIMIT), and a request body is at most 10 MB.
 *
 * For tests, env.CLAUDE stands in for the Anthropic client. On this computer, where there is no Turnstile secret,
 * `wrangler dev --var DRAW_NO_CHECK:1` skips the bot check; the deployed Worker never has that var.
 */
import Anthropic from "@anthropic-ai/sdk";
import { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import type { MessageParam, Usage } from "@anthropic-ai/sdk/resources/messages";
import { EFFORT, MAX_TOKENS, MODE, MODELS, MODES, type Mode, TOOLS, prompt } from "./agent.ts";
import { respond } from "./openai.ts";
import { type WebEnv, download, search } from "./web.ts";

interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number }; changes?: number }>;
}

interface Env extends WebEnv {
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY?: string;
  DB: { prepare(query: string): Statement };
  DRAW_LIMIT: { limit(o: { key: string }): Promise<{ success: boolean }> };
  DRAW_PAGE_CENTS: string;
  DRAW_IP_CENTS: string;
  DRAW_DAY_CENTS: string;
  IP_SECRET?: string;
  DRAW_NO_CHECK?: string;
  CLAUDE?: Anthropic;
}

/** What the rest of the Worker lends: its reading of a JSON body, its Turnstile check and its keyed hash. */
interface Shared {
  body(request: Request, max: number): Promise<Record<string, unknown>>;
  verify(request: Request, env: unknown, token: unknown, action: string): Promise<void>;
  hash(secret: string, value: string): Promise<string>;
}

const PAGE = /^[\w-]{1,64}$/; // a drawing's name: when it was started, and a random end
const LARGEST = 10_000_000; // the largest request body taken, in bytes
const DAY = 86400; // seconds
const CENT = 10_000; // micros in one US cent
// what a call holds while it runs: the price of 100,000 tokens of fresh input and 10,000 of output
const HELD = { input_tokens: 100_000, output_tokens: 10_000 };

const say = (status: number, text: string, headers: Record<string, string> = {}) =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", ...headers } });

/** Returns what a call to the model, by the name the page shows, that used these tokens cost, in micros. */
function cost(model: string, used: Partial<Usage> | undefined): number {
  const { prices, over } = MODELS[model];
  const n = [
    used?.input_tokens ?? 0,
    used?.cache_creation_input_tokens ?? 0,
    used?.cache_read_input_tokens ?? 0,
    used?.output_tokens ?? 0,
  ];
  const p = over && n[0] + n[1] + n[2] >= over.from ? over.prices : prices;
  return Math.round(n.reduce((sum, tokens, i) => sum + tokens * p[i], 0));
}

/** Answers one request under /api/draw/: see the routes at the top. The Worker has already checked its origin. */
export async function draw(
  request: Request,
  env: Env,
  ctx: { waitUntil(p: Promise<unknown>): void } | undefined,
  path: string,
  shared: Shared,
): Promise<Response> {
  const route = path.slice("/api/draw/".length);
  if (request.method !== "POST" || !["messages", "search", "download"].includes(route)) return say(404, "Not found.");
  const ip = request.headers.get("cf-connecting-ip");
  if (!request.headers.get("origin") || !ip || !env.IP_SECRET) return say(403, "This page cannot draw from here.");
  const ipHash = await shared.hash(env.IP_SECRET, ip);
  if (!(await env.DRAW_LIMIT.limit({ key: ipHash })).success) return say(429, "Too many requests: wait a minute.");
  let given: Record<string, unknown>;
  try {
    given = await shared.body(request, LARGEST);
  } catch (e) {
    return say((e as { status?: number }).status ?? 400, e instanceof Error ? e.message : "Invalid request.");
  }
  const page = given.page,
    now = Math.floor(Date.now() / 1000);
  if (typeof page !== "string" || !PAGE.test(page)) return say(422, "Send the drawing's name as page.");

  // a drawing's first request is checked by Turnstile, and makes the drawing's row
  if (!(await env.DB.prepare("SELECT 1 FROM draw_pages WHERE page=?").bind(page).first())) {
    if (env.DRAW_NO_CHECK !== "1") {
      if (!given.token) return say(403, "The bot check is needed first.", { "x-check": "1" });
      try {
        await shared.verify(request, env, given.token, "sheet");
      } catch {
        return say(403, "Your browser did not pass the bot check, so the agent cannot draw here.");
      }
    }
    try {
      await env.DB.prepare("INSERT OR IGNORE INTO draw_pages(page,ip_hash,created_at) VALUES(?,?,?)")
        .bind(page, ipHash, now)
        .run();
    } catch (e) {
      if (/draw_limit|draw_busy/.test(String((e as Error).message)))
        return say(402, "That is all the new drawings for today: come back tomorrow.");
      throw e;
    }
  }
  if (route === "search") return search(given, env);
  if (route === "download") return download(given);
  return converse(request, env, ctx, given, page, ipHash, now);
}

// Streams the model's reply to the conversation given, within the caps, and sets the call's row to what it cost when
// the reply ends. An error from Anthropic before the reply starts is passed on with its status.
async function converse(
  request: Request,
  env: Env,
  ctx: { waitUntil(p: Promise<unknown>): void } | undefined,
  given: Record<string, unknown>,
  page: string,
  ipHash: string,
  now: number,
): Promise<Response> {
  const messages = given.messages,
    asked = given.model;
  if (typeof asked !== "string" || !Object.hasOwn(MODELS, asked) || !Array.isArray(messages) || !messages.length)
    return say(422, `Send {page, model, messages}, with model one of ${Object.keys(MODELS).join(", ")}.`);
  // without OpenAI's key, a call for one of OpenAI's models goes to Sonnet, so the page still draws
  const chosen = MODELS[asked].id.startsWith("openai/") && !env.OPENAI_API_KEY ? "Sonnet" : asked;
  const modes = Object.keys(MODES) as Mode[],
    mode = modes.find((m) => m === given.mode) ?? MODE;
  if (given.mode !== undefined && mode !== given.mode) return say(422, `The mode is one of ${modes.join(", ")}.`);

  const id = crypto.randomUUID(),
    caps = [env.DRAW_PAGE_CENTS, env.DRAW_IP_CENTS, env.DRAW_DAY_CENTS].map((c) => Number(c) * CENT),
    spent = (where: string) => `(SELECT COALESCE(SUM(micros),0) FROM draw_calls WHERE ${where})`;
  // one statement, so two calls at once cannot both take the last of a cap
  const held = await env.DB.prepare(
    `INSERT INTO draw_calls(id,page,ip_hash,micros,created_at) SELECT ?1,?2,?3,?4,?5
     WHERE ${spent("page=?2")}<?6 AND ${spent("ip_hash=?3 AND created_at>?5-" + DAY)}<?7 AND ${spent("created_at>?5-" + DAY)}<?8`,
  )
    .bind(id, page, ipHash, cost(chosen, HELD), now, ...caps)
    .run();
  if ((held.meta?.changes ?? held.changes) !== 1) {
    const used = await env.DB.prepare(`SELECT ${spent("page=?")} AS micros`).bind(page).first<{ micros: number }>();
    return say(
      402,
      (used?.micros ?? 0) >= caps[0]
        ? "The agent has drawn all it can on this sheet: Clear starts a new one."
        : "The agent has drawn all it can for today: come back tomorrow.",
    );
  }
  const settle = (used: Partial<Usage> | undefined) =>
    env.DB.prepare("UPDATE draw_calls SET micros=? WHERE id=?").bind(cost(chosen, used), id).run();

  const model = MODELS[chosen].id,
    system = prompt(mode),
    stopped = new AbortController(); // aborted when the visitor stops the reply, to stop a call to OpenAI
  // OpenAI's models are named with their maker: openai.ts makes the call and turns the reply into Anthropic's format
  const answer = model.startsWith("openai/")
    ? respond(
        env.OPENAI_API_KEY ?? "",
        {
          model: model.slice("openai/".length),
          system,
          tools: TOOLS,
          messages: messages as MessageParam[],
          effort: EFFORT,
          max_tokens: MAX_TOKENS,
          page,
        },
        stopped.signal,
      )
    : undefined;
  const stream = answer
    ? MessageStream.fromReadableStream(answer.body)
    : (env.CLAUDE ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })).messages.stream({
        model,
        max_tokens: MAX_TOKENS,
        output_config: { effort: EFFORT },
        system,
        tools: TOOLS,
        cache_control: { type: "ephemeral" },
        messages: messages as MessageParam[],
      });
  stream.controller?.signal.addEventListener("abort", () => stopped.abort());
  request.signal?.addEventListener("abort", () => stream.abort()); // the visitor pressed Stop, or left
  const done = stream.finalMessage().then(
    (reply) => settle(reply.usage),
    (err: unknown) => {
      // a reply the visitor stopped is paid for as far as it got, since its tokens were spent
      if (err instanceof Anthropic.APIUserAbortError) return settle(stream.currentMessage?.usage);
      console.error(JSON.stringify({ page, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }));
      return settle(undefined);
    },
  );
  ctx?.waitUntil(done);
  try {
    await (answer ? answer.connected : stream.withResponse());
  } catch (err) {
    const status = err instanceof Anthropic.APIError && err.status ? err.status : 502;
    return say(status, `The model answered ${status}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return new Response(stream.toReadableStream(), {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}
