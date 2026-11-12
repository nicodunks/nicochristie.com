// The homepage's sheet: starts one session of the drawing agent per visitor, and carries each turn between the
// homepage and that session.
//
//   POST /api/sheets                 a new sheet, {token}: the Turnstile token of the visitor. Returns {sheet: its id}
//   POST /api/sheets/<sheet>/turns   the visitor's turn, {picture, left, right, top, bottom, strokes, lines, undone,
//                                    greeted, zoom}
//   POST /api/sheets/<sheet>/looks   the parts of the sheet the agent asked to see, {looks: [{id, picture, left,
//                                    right, top, bottom}]}
//   POST /api/sheets/<sheet>/stop    ends the agent's turn, whatever the agent is doing
//
// The agent's answer to a turn comes in stretches. A stretch is the response to one request, to turns or to looks.
// It streams back one JSON object a line, and ends when the agent's turn is over or when the agent waits to see
// the sheet:
//   {"draw": {"paths": [path, ...], "color", "width"}}   strokes to draw in one colour, as SVG path data
//   {"write": [{"text", "x", "y", "width", "height", "color"}, ...]}
//                                                   lines of text, each to write in its box in its colour
//   {"erase": [{"x", "y", "width", "height"}, ...]} boxes to rub out
//   {"move": {"box", "steps", "seconds"}}           ink to move through steps, each {dx, dy, scale, rotate}
//   {"zoom": number}                                the zoom to bring the visitor's view to, in pixels per unit
//   {"look": {"id", "y"}}                           the agent asks to see the sheet from y down, or what the visitor
//                                                   sees if y is null. After the stretch, the page sends every
//                                                   picture asked for in it as one request to looks, and the
//                                                   response to that request is the next stretch.
//   {"doing": text}                                 what the agent is busy with
//   {"done": true}                                  the agent's turn is over
//
// What keeps a stranger from running up a bill: a new sheet needs a Turnstile token, the database caps the sheets
// started per connection and in all per day, each sheet's session may spend at most SHEET_CENTS, each sheet takes
// at most TURNS turns, and the agent has no tool but the sheet. The session's id never leaves this server.
import Anthropic from "@anthropic-ai/sdk";
import {BOX} from "./agent.mjs";
import {COLORS, MINE} from "../sheet-colors.js";

const TURNS = 40;             // the most turns one sheet takes
const MAX_BODY = 6_000_000;   // the most bytes of one turn or one set of looks
const SHEET = /^\/api\/sheets\/([0-9a-f-]{36})\/(turns|looks|stop)$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const DOING = {draw: "drawing", handwrite: "writing", erase: "erasing", move: "moving", zoom: "zooming"};   // what the page shows
const SIDES = Object.keys(BOX);

const number = v => typeof v === "number" && Number.isFinite(v);
const line = o => JSON.stringify(o) + "\n";

// Returns the visitor's turn in words for the agent: what the picture shows, the homepage's text, and each new stroke.
export function told(turn) {
  const n = v => v.toFixed(0);
  const g = turn.greeted, lines = [];
  if (g) lines.push("The visitor has just opened the homepage, or opened it again, which wiped the sheet clean. " +
    `The page greeted them for you with a small happy face in ${g.color}, in the box from x = ${n(g.x)} to ${n(g.x + g.width)} ` +
    `and y = ${n(g.y)} to ${n(g.y + g.height)}. It is your ink. This is the first thing they drew back.`);
  if (turn.undone) lines.push(`The visitor took back ${turn.undone} of their strokes that you saw before.`);
  lines.push(`The picture shows the sheet from x = ${n(turn.left)} to x = ${n(turn.right)} and from y = ${n(turn.top)} to y = ${n(turn.bottom)}.`);
  lines.push(`The visitor's view is at zoom ${(turn.zoom ?? 1).toFixed(2)}.`, "");
  lines.push("The homepage's text, as x,y of each line's top left corner, its width x height, and its words:");
  for (const l of turn.lines) lines.push(`${n(l.x)},${n(l.y)} ${n(l.width)}x${n(l.height)}: ${l.text}`);
  lines.push("", `New strokes: ${turn.strokes.length}`);
  turn.strokes.forEach((s, i) => {
    const tool = s.wipe ? `eraser ${n(s.wipe)} wide` : s.color;
    lines.push(`${i + 1}. ${tool}: ` + s.points.map(([x, y]) => `${n(x)},${n(y)}`).join(" "));
  });
  return lines.join("\n");
}

// Returns the colour a tool's input names, the agent's own colour if it names none, or null if no such colour.
function color(given) {
  const named = given.color ?? MINE;
  return typeof named === "string" && Object.hasOwn(COLORS, named) ? named : null;
}

// Returns the line to send the page for one call of a page tool, or null if the call's input is malformed.
export function ink(name, given) {
  const boxed = b => b && typeof b === "object" && SIDES.every(k => number(b[k]));
  const box = b => Object.fromEntries(SIDES.map(k => [k, b[k]]));
  if (name === "draw" && Array.isArray(given.paths) && given.paths.every(d => typeof d === "string") && color(given)) {
    const width = number(given.width) ? Math.min(30, Math.max(1, given.width)) : 3;
    return {draw: {paths: given.paths, color: color(given), width}};
  }
  if (name === "handwrite" && Array.isArray(given.texts) && given.texts.every(t => boxed(t) && typeof t.text === "string" && color(t)))
    return {write: given.texts.map(t => ({...box(t), text: t.text, color: color(t)}))};
  if (name === "erase" && Array.isArray(given.boxes) && given.boxes.every(boxed)) return {erase: given.boxes.map(box)};
  if (name === "zoom" && number(given.zoom)) return {zoom: Math.min(1, Math.max(0.2, given.zoom))};
  const steps = given.steps;
  if (name === "move" && boxed(given) && number(given.seconds) && Array.isArray(steps) && steps.length
      && steps.every(t => t && typeof t === "object" && Object.values(t).every(number))) {
    const moves = ["dx", "dy", "scale", "rotate"];
    return {move: {
      box: box(given),
      steps: steps.map(t => Object.fromEntries(moves.filter(k => k in t).map(k => [k, t[k]]))),
      seconds: Math.min(10, Math.max(0, given.seconds)),
    }};
  }
  return null;
}

// Sends `events` to the sheet's session and yields one stretch of the agent's answer, one JSON line per step.
//
// `events` is the visitor's turn, or the pictures the agent asked for. The stretch ends when the agent's turn is
// over, or when the agent has asked to see the sheet and waits for the pictures. The agent's turn is over as soon as
// it has drawn, written or erased: its ink is its answer, so the session is interrupted instead of asking the agent
// whether it has more to do. What the agent says outside its tools is dropped: the visitor sees only the sheet.
export async function* answer(claude, session, events) {
  let begun = false;     // the agent has started on `events`: before that, the session may still report an earlier stop
  let looking = false;   // the agent asked to see the sheet in this stretch
  const results = [];    // what to tell the agent of each draw, handwrite, erase, move and zoom
  const stream = await claude.beta.sessions.events.stream(session);
  await claude.beta.sessions.events.send(session, {events});
  for await (const e of stream) {
    if (e.type === "session.status_running") begun = true;
    else if (e.type === "agent.custom_tool_use" && e.name === "look") {   // the page answers this call, afterwards
      looking = true;
      yield line({look: {id: e.id, y: number(e.input.y) ? e.input.y : null}});
    } else if (e.type === "agent.custom_tool_use") {   // the agent draws, writes, erases or moves: the page does it
      yield line({doing: DOING[e.name] ?? "working it out"});
      const made = ink(e.name, e.input);
      if (made) yield line(made);
      results.push({
        type: "user.custom_tool_result",
        custom_tool_use_id: e.id,
        content: [{type: "text", text: made ? "Done." : "Malformed input: nothing done."}],
        is_error: !made,
      });
    } else if (e.type === "span.model_request_start") yield line({doing: "thinking"});
    else if (e.type === "session.status_terminated") break;
    else if (e.type === "session.status_idle" && begun) {
      if (e.stop_reason.type !== "requires_action") break;
      if (looking) {   // the agent waits for the pictures, which come with the page's next request
        if (results.length) await claude.beta.sessions.events.send(session, {events: results});
        return;
      }
      if (results.length) {   // the agent's ink is on the sheet: its turn is over
        await claude.beta.sessions.events.send(session, {events: [...results, {type: "user.interrupt"}]});
        break;
      }
    }
  }
  yield line({done: true});
}

// Returns the response that streams one stretch of the agent's answer to `events`. When the page drops the request,
// the stretch stops.
function stretch(claude, session, events) {
  const lines = answer(claude, session, events), encoder = new TextEncoder();
  const body = new ReadableStream({
    async pull(controller) {
      const {value, done} = await lines.next();
      if (done) controller.close(); else controller.enqueue(encoder.encode(value));
    },
    cancel() { return lines.return(); },
  });
  return new Response(body, {headers: {"Content-Type": "application/x-ndjson"}});
}

// Returns one picture of the sheet as the image and the words the agent is given, or fails if it is malformed.
function seen(p, fail) {
  if (!p || typeof p.picture !== "string" || p.picture.length > 4_000_000 || !BASE64.test(p.picture)
      || !["left", "right", "top", "bottom"].every(k => number(p[k]))) fail(400, "Invalid picture.");
  return {type: "image", source: {type: "base64", media_type: "image/png", data: p.picture}};
}

// Fails unless `turn` is a turn as the page sends it, within the sizes a real homepage and a real hand stay under.
function checked(turn, fail) {
  const points = s => Array.isArray(s.points) && s.points.length <= 2000
    && s.points.every(p => Array.isArray(p) && p.length === 2 && p.every(number));
  const stroke = s => s && typeof s === "object" && points(s)
    && (number(s.wipe) && s.wipe > 0 || typeof s.color === "string" && Object.hasOwn(COLORS, s.color));
  const text = l => l && typeof l === "object" && SIDES.every(k => number(l[k])) && typeof l.text === "string" && l.text.length <= 400;
  if (!Array.isArray(turn.strokes) || turn.strokes.length > 400 || !turn.strokes.every(stroke)) fail(400, "Invalid strokes.");
  if (!Array.isArray(turn.lines) || turn.lines.length > 300 || !turn.lines.every(text)) fail(400, "Invalid text.");
  if (turn.greeted != null && !(SIDES.every(k => number(turn.greeted[k])) && typeof turn.greeted.color === "string" && Object.hasOwn(COLORS, turn.greeted.color))) fail(400, "Invalid turn.");
  if (turn.zoom !== undefined && !(number(turn.zoom) && turn.zoom > 0)) fail(400, "Invalid turn.");
  if (turn.undone !== undefined && !(Number.isInteger(turn.undone) && turn.undone >= 0)) fail(400, "Invalid turn.");
}

// Answers one request under /api/sheets. `tools` are the Worker's own helpers: fail, json, body, verify and hash.
export async function sheets(request, env, path, {fail, json, body, verify, hash}) {
  const origin = request.headers.get("origin");
  if (request.method !== "POST") fail(404, "Not found.");
  if (!origin || !env.ALLOWED_ORIGINS.split(",").includes(origin)) fail(403, "Origin required.");
  if (!env.IP_SECRET || !env.SHEET_AGENT || !env.SHEET_ENVIRONMENT || !(env.ANTHROPIC_API_KEY || env.CLAUDE)) fail(503, "Service not ready.");
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) fail(403, "Client address missing.");
  const ipHash = await hash(env.IP_SECRET, ip);
  if (!(await env.SHEET_LIMIT.limit({key: ipHash})).success) fail(429, "Too many attempts. Try again in a minute.");
  const claude = env.CLAUDE ?? new Anthropic({apiKey: env.ANTHROPIC_API_KEY});   // env.CLAUDE: a stand-in, in tests

  if (path === "/api/sheets") {
    const data = await body(request, 4096);
    await verify(request, env, data.token, "sheet");
    const id = crypto.randomUUID();
    // the row first: its guard refuses the sheet when a daily cap is reached, before any session is paid for
    await env.DB.prepare("INSERT INTO sheets(id,ip_hash,created_at) VALUES(?,?,?)").bind(id, ipHash, Math.floor(Date.now() / 1000)).run();
    const session = await claude.beta.sessions.create({
      agent: env.SHEET_AGENT,
      environment_id: env.SHEET_ENVIRONMENT,
      budget: {type: "limit", max_list_cost: {amount: String(env.SHEET_CENTS), currency: "USD"}},
    });
    await env.DB.prepare("UPDATE sheets SET session=? WHERE id=?").bind(session.id, id).run();
    return json({sheet: id}, 201);
  }

  const [, id, what] = path.match(SHEET) ?? fail(404, "Not found.");
  const row = await env.DB.prepare("SELECT session,turns FROM sheets WHERE id=?").bind(id).first();
  if (!row?.session) fail(404, "Not found.");
  if (what === "stop") {
    await claude.beta.sessions.events.send(row.session, {events: [{type: "user.interrupt"}]});
    return json({});
  }
  const data = await body(request, MAX_BODY);
  if (what === "looks") {
    if (!Array.isArray(data.looks) || !data.looks.length || data.looks.length > 8
        || !data.looks.every(l => typeof l?.id === "string" && /^[\w-]{1,64}$/.test(l.id))) fail(400, "Invalid looks.");
    return stretch(claude, row.session, data.looks.map(one => ({
      type: "user.custom_tool_result",
      custom_tool_use_id: one.id,
      content: [seen(one, fail), {
        type: "text",
        text: `The sheet from x = ${one.left.toFixed(0)} to x = ${one.right.toFixed(0)} and from y = ${one.top.toFixed(0)} to y = ${one.bottom.toFixed(0)}.`,
      }],
    })));
  }
  const picture = seen(data, fail);
  checked(data, fail);
  if (row.turns >= TURNS) fail(429, "This sheet is full.");
  await env.DB.prepare("UPDATE sheets SET turns=turns+1 WHERE id=?").bind(id).run();
  return stretch(claude, row.session, [{type: "user.message", content: [picture, {type: "text", text: told(data)}]}]);
}
