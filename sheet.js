// The homepage's sheet: the whole homepage is one sheet of paper that the visitor and a Claude agent both draw on.
// The homepage's text is printed on the sheet. When the page opens, the page draws a small happy face in a colour
// picked at random, without asking the agent, so that it is there at once. When the visitor draws back, the agent
// answers.
//
// The page loads this file as a module, with sheet.css. Nothing here stands in the way of reading the homepage:
// the text shows first, links stay links, and when the bot check, the server or the agent fails, the homepage is
// simply a homepage without ink.
//
// The visitor holds the pen, the eraser or nothing. They hold the pen when the page opens, so a drag of the mouse
// or of one finger draws at once, and two fingers scroll. Once a pen such as an Apple Pencil has been seen, the pen
// draws and one finger scrolls. Tapping the pen at the bottom right puts it down, and the page is a plain page. When their pen has rested for REST
// milliseconds, the page sends the server a picture of what they see, the homepage's text with where each line is,
// and the marks they made since the agent's last turn, and draws whatever the agent answers. While the agent's turn
// lasts, the Send button reads Stop, and pressing it, or drawing a new stroke, ends the agent's turn.
//
// The sheet zooms: the homepage's text and the ink grow and shrink together, and zoomed out there is more blank
// paper in the window to draw on. The page opens zoomed out, to the zoom sheet.css gives #page, which is further out
// on a phone. The visitor zooms with two fingers while they hold the pen, and the agent zooms with its zoom tool.
//
// One page unit is one CSS pixel at zoom 1. The point (0, 0) is the top left corner of the page's column, <main>,
// so that the ink stays on its text when the window is widened; x is below 0 in the left margin, and y grows
// downward.
// Everything on the sheet is a mark, in page units:
//   a stroke   {color, pen, points: [[x, y], ...]}  color is a key of COLORS, pen the width of the line
//   a wipe     {wipe, points: [[x, y], ...]}        a stroke of the visitor's eraser, `wipe` units wide: the ink
//                                                   made before it is rubbed out along it
//   a rub      {rub: {x, y, width, height}}         the agent's eraser: the ink made before it is rubbed out
//                                                   inside this box
//   a move     {move: {box, steps, seconds}}        the agent moves every stroke made before it whose middle is in
//                                                   the box, through each step in turn over `seconds`, and leaves
//                                                   it at the last step. A step is {dx, dy, scale, rotate}.
// The page draws only ink. Each stroke's `ink` is what is left of it after every wipe, rub and move made after it,
// as a list of pieces, each a list of points. A mark the agent has been told of is `seen`. The agent's writing is
// strokes too: the page writes each letter with the pen. Such a stroke also has `gap`, the distance between its
// points. While the agent's turn lasts, the strokes of that turn are also `draft`, and are drawn faint.
//
// The visitor's sheet on the server is started at their first stroke, behind the bot check, so a visitor who only
// reads costs nothing. A reload wipes the ink, the agent's and the visitor's alike, and the page greets again. The
// tab keeps the sheet's id in sessionStorage, so a reload goes on with the same sheet on the server.
import {apiUrl, challenge} from "./backend-client.js";
import {COLORS, YOURS} from "./sheet-colors.js";

// The agent's handwriting. For each character: w, how far the pen moves on after it, and d, its pen strokes as SVG
// paths. In these paths a capital is 100 high, the line the letters stand on is at y = 100, and the tail of a g or
// a y reaches down to y = EM.
const HAND = await (await fetch(new URL("./hand.json", import.meta.url))).json(), EM = 135;
// The LaTeX names of characters in the handwriting. A name that is not here is written out, as \log is.
const NAMES = {alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", eta: "η", theta: "θ", lambda: "λ",
  mu: "μ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", omega: "ω", Delta: "Δ", Sigma: "Σ", Omega: "Ω",
  sum: "∑", prod: "∏", int: "∫", infty: "∞", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈",
  pm: "±", cdot: "·", times: "×", div: "÷", to: "→", rightarrow: "→", leftarrow: "←", partial: "∂", nabla: "∇",
  in: "∈", ldots: "...", dots: "...", cdots: "...", quad: "  "};
const GRID = 100;      // the agent's picture has a labelled grid line every this many units
const DRAFT = 0.4;     // how solid the agent's ink is while its turn lasts
const SPEED = 900;     // how fast the agent's ink appears, in page units a second
const PEN = 3;         // the width of the visitor's pen
const WIPE = 24;       // the width of the visitor's eraser
const REST = 1500;     // how long the pen rests, in milliseconds, before the turn goes by itself
const FAR = 0.2;       // the furthest out the sheet zooms
const KEPT = "sheet-id";   // the key in sessionStorage under which this tab's sheet id is kept

// ---- the page's own elements ----

// Returns a new element with the given tag and properties, added to `into`.
function make(tag, props, into) {
  const el = Object.assign(document.createElement(tag), props);
  into.append(el);
  return el;
}
const canvas = make("canvas", {id: "sheet"}, document.body), ctx = canvas.getContext("2d");
const tools = make("div", {id: "tools"}, document.body);
const caption = make("div", {id: "caption"}, tools), menu = make("div", {id: "menu"}, tools);
document.body.insertAdjacentHTML("beforeend", '<svg id="measure"><path/></svg>');
const measure = document.querySelector("#measure path");
const page = document.getElementById("page"), column = document.querySelector("main");
document.documentElement.style.setProperty("--rest", REST + "ms");

let marks = [];        // everything on the sheet, in the order it was made
let made = [];         // the strokes on the sheet, in the order they were made
let mine = [];         // the visitor's marks, in the order they made them: what Undo takes back
let gone = 0;          // how many marks the agent has seen that the visitor took back since the agent's last turn
let fresh = [];        // the visitor's marks the agent has not seen yet
let holds = "";        // what the visitor holds: "pen", "wipe" or ""
let chosen = YOURS;    // the colour of the visitor's pen
let stroke = null;     // the mark the visitor is making now, with `pointer`, its pointer's id, and `kind`, pen,
                       // touch or mouse
let pen = false;       // a pen has been seen, so fingers scroll the page and do not draw
let fingers = new Map();   // every finger on the sheet, by its pointer's id, as its {x, y} in the window
let scrolling = false;     // the fingers on the sheet scroll the page: none of them draws
let held = null;       // grip() as it was when the fingers last moved
let sheet = null;      // the id of this visitor's sheet on the server, or null while there is none
let opening = null;    // the promise of open(), once the sheet has been asked for
let kept = false;      // the sheet's id came from sessionStorage, so the server may no longer have the sheet
let dead = false;      // no sheet could be opened: the agent will not answer in this tab
let greeted = null;    // the greeting the page drew that the agent has not been told of: {color, x, y, width, height}
let busy = false;      // a turn is with the agent
let soon = 0;          // the timer that sends the turn once the pen has rested
let stopper = null;    // the AbortController of the turn's requests: Stop aborts them
let hurry = false;     // the visitor pressed Stop: the agent's ink that is not shown yet appears at once
let zoom = new DOMMatrix(getComputedStyle(page).transform).a;   // screen pixels per page unit: opens as the stylesheet set it
let left = 0;          // the x of the left edge of what the visitor sees
let above = 0;         // the y of the top edge of what the visitor sees
let wide = 0;          // how much of the sheet the visitor sees, as a width in page units
let tall = 0;          // how much of the sheet the visitor sees, as a height in page units

// POSTs body to the server as JSON and returns the response. `signal`, when given, ends the request early.
function post(path, body, signal) {
  return fetch(apiUrl(path), {method: "POST", body: JSON.stringify(body), signal, headers: {"Content-Type": "application/json"}});
}

// ---- drawing marks on a canvas ----

// Draws the ink of one mark on context c: a stroke's pieces, where a move that is playing has them now. A mark being
// revealed draws only the first `shown` of its points. The stroke of the eraser the visitor is moving now takes ink
// away as it goes; wipes, rubs and moves that are done have no ink of their own.
function paint(c, m) {
  if (!m.ink) return;
  const playing = m.from && !m.from.done ? m.from : null;
  let pieces = playing ? m.before.map(p => p.map(stepped(playing.now(), playing.move.box))) : m.ink;
  if (m.shown !== undefined) {   // the same share of the ink as of the stroke's points
    let rest = Math.ceil(m.shown / m.points.length * pieces.reduce((n, p) => n + p.length, 0));
    pieces = pieces.map(p => { const some = p.slice(0, Math.max(0, rest)); rest -= p.length; return some; });
  }
  c.globalCompositeOperation = m.wipe ? "destination-out" : "source-over";   // a wipe takes ink away
  c.strokeStyle = m.wipe ? "#000" : COLORS[m.color];
  c.globalAlpha = m.draft ? DRAFT : 1;
  c.lineWidth = m.wipe ?? m.pen ?? PEN; c.lineCap = c.lineJoin = "round";
  for (const p of pieces) {
    if (!p.length) continue;
    c.beginPath();
    c.moveTo(p[0][0], p[0][1]);
    if (p.length === 1) c.lineTo(p[0][0] + 0.1, p[0][1]);
    for (let i = 1; i < p.length - 1; i++)   // a curve through the midpoints, so the line is smooth
      c.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    if (p.length > 1) c.lineTo(p.at(-1)[0], p.at(-1)[1]);
    c.stroke();
  }
  c.globalCompositeOperation = "source-over"; c.globalAlpha = 1;
}

// Returns the box a mark lies in, as {x0, y0, x1, y1}: a stroke's ink, or a rub's or a move's box. Worked out once
// for each mark, and kept on it until its ink changes.
function reach(m) {
  if (!m.reach) {
    const r = m.rub ?? m.move?.box;
    m.reach = r ? {x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height}
      : (m.ink ?? [m.points]).flat().reduce((b, [x, y]) => ({x0: Math.min(b.x0, x), y0: Math.min(b.y0, y),
        x1: Math.max(b.x1, x), y1: Math.max(b.y1, y)}), {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity});
  }
  return m.reach;
}

// ---- what is left of each stroke ----

// Works out the ink of every stroke from the marks in the order they were made. Done when a mark is taken back; a
// new mark only needs added().
function settle() {
  made = [];
  for (const m of marks) { delete m.reach; added(m); }
}

// Works out what a new mark does to the ink: a stroke starts as its whole line, a wipe or a rub cuts away what it
// covers of the strokes before it, and a move moves the strokes before it that it takes.
function added(m) {
  if (m.color) { m.ink = [m.points]; delete m.from; made.push(m); }
  else if (m.wipe) { const wiped = path(m.points, m.wipe / 2); for (const s of made) cut(s, wiped, s.pen ?? PEN); }
  else if (m.rub) for (const s of made) cut(s, box(m.rub), 0);
  else if (m.move) for (const s of made) moved(s, m);
}

// Returns the region inside a box {x, y, width, height}, as {x0, y0, x1, y1, has}: the box, and has(p, d), whether
// the point p is inside it or less than d from it.
function box({x, y, width, height}) {
  return {x0: x, y0: y, x1: x + width, y1: y + height,
    has: ([px, py], d) => px > x - d && px < x + width + d && py > y - d && py < y + height + d};
}

// Returns the region less than `r` from the line through `points`, the way box() does: what an eraser `2r` wide
// rubs out as it moves along that line.
function path(points, r) {
  const far = ([px, py], [ax, ay], [bx, by]) => {   // the distance from p to the segment from a to b
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return {x0: Math.min(...xs) - r, y0: Math.min(...ys) - r, x1: Math.max(...xs) + r, y1: Math.max(...ys) + r,
    has: (p, d) => points.some((a, i) => far(p, a, points[i + 1] ?? a) < r + d)};
}

// Cuts away the part of stroke s's ink that `region` covers, counting a point as covered when it is less than half
// the line's width `pen` from it: the ink left is the pieces between.
function cut(s, region, pen) {
  const b = reach(s), d = pen / 2;
  if (b.x1 < region.x0 - d || b.x0 > region.x1 + d || b.y1 < region.y0 - d || b.y0 > region.y1 + d) return;
  const pieces = [];
  for (const p of s.ink) {
    let piece = [];
    const keep = q => { if (region.has(q, d)) { if (piece.length) pieces.push(piece); piece = []; } else piece.push(q); };
    if (p.length === 1) keep(p[0]);
    for (let i = 1; i < p.length; i++) {   // every 2 units along each segment, so a cut ends where the region does
      const [ax, ay] = p[i - 1], [bx, by] = p[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) keep([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
    }
    if (piece.length) pieces.push(piece);
  }
  s.ink = pieces.filter(p => p.length > 1 || s.ink.some(q => q.length === 1));
  delete s.reach;
}

// Moves stroke s to where move m leaves it, if m takes it: if the middle of s's ink is inside m's box. Until m
// has played, s is drawn moving through m's steps, from `before`, the ink it had.
function moved(s, m) {
  const b = reach(s), {box: {x, y, width, height}, steps} = m.move;
  const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
  if (!(mx >= x && mx <= x + width && my >= y && my <= y + height)) return;
  s.before = s.ink;
  s.ink = s.ink.map(p => p.map(stepped(steps.at(-1), m.move.box)));
  s.from = m;
  delete s.reach;
}

// Returns the function that moves a point by one step of a move, {dx, dy, scale, rotate}: it is scaled by `scale`
// and turned by `rotate` degrees clockwise about the middle of `box`, then shifted by (dx, dy).
function stepped({dx = 0, dy = 0, scale = 1, rotate = 0}, {x, y, width, height}) {
  const cx = x + width / 2, cy = y + height / 2, a = rotate * Math.PI / 180, cos = Math.cos(a) * scale, sin = Math.sin(a) * scale;
  return ([px, py]) => [cx + dx + (px - cx) * cos - (py - cy) * sin, cy + dy + (px - cx) * sin + (py - cy) * cos];
}

// Plays move m: its strokes go through its steps, each in an equal share of its seconds, easing in and out of
// each step. Stop ends it at its last step at once. Resolves when it has played.
async function play(m) {
  const {steps, seconds = 0} = m.move, t0 = performance.now();
  const blend = (a, b, k) => Object.fromEntries(["dx", "dy", "scale", "rotate"].map(p => {
    const from = a[p] ?? (p === "scale" ? 1 : 0), to = b[p] ?? (p === "scale" ? 1 : 0);
    return [p, from + (to - from) * k];
  }));
  for (;;) {
    const t = (performance.now() - t0) / 1000 / (seconds || 1e-9) * steps.length;
    if (hurry || t >= steps.length) break;
    const i = Math.floor(t), k = t - i, eased = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
    m.now = () => blend(i ? steps[i - 1] : {}, steps[i], eased);
    redraw();
    await frame();
  }
  m.done = true;
  redraw();
}

// Draws on context c every mark that touches the sheet from y = from to y = to, in the order the marks were made.
function paintAll(c, from, to, each = m => m) {
  for (const m of marks)   // a stroke that is moving may be anywhere on its way
    if ((reach(m).y1 > from - 40 && reach(m).y0 < to + 40) || (m.from && !m.from.done)) paint(c, each(m));
}

// Redraws the part of the sheet the visitor sees, after working out which part that is from where the page's column
// is in the window.
function redraw() {
  const at = column.getBoundingClientRect(), k = devicePixelRatio * zoom;
  left = -at.left / zoom; above = -at.top / zoom; wide = innerWidth / zoom; tall = innerHeight / zoom;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, -left * k, -above * k);
  paintAll(ctx, above, above + tall);
  if (stroke) paint(ctx, stroke);
}

// Fits the canvas to the window, when the page opens and when the window changes.
function fit() {
  canvas.width = Math.round(innerWidth * devicePixelRatio); canvas.height = Math.round(innerHeight * devicePixelRatio);
  redraw();
}

// Makes the page long enough to scroll to the lowest ink, when ink goes below the homepage's own text.
function grow() {
  const low = made.reduce((y, m) => Math.max(y, reach(m).y1), 0) + 120;
  document.body.style.minHeight = column.getBoundingClientRect().top + scrollY + low * zoom + "px";
}

// Zooms the sheet to `to` screen pixels per page unit, between FAR and 1: the homepage's text is scaled, and made
// as much wider as it is smaller, so that it fills the window's width at any zoom.
function scale(to) {
  zoom = Math.min(1, Math.max(FAR, to));
  page.style.transform = `scale(${zoom})`; page.style.width = 100 / zoom + "%";
  grow(); redraw();
}

// Zooms the sheet to `to`, gliding there over a third of a second. Resolves when the zoom is there.
async function glide(to) {
  const from = zoom;
  for (const t0 = performance.now(); ;) {
    const k = hurry ? 1 : Math.min(1, (performance.now() - t0) / 350);
    scale(from + (to - from) * k * (2 - k));
    if (k === 1) break;
    await frame();
  }
}

// ---- the homepage's text ----

// Returns every word of the homepage's text with where it is on the sheet and how it is printed, as
// [{text, x, y, width, height, font, color}], in the order of the page's source.
function words() {
  const at = column.getBoundingClientRect(), found = [], range = document.createRange();
  const walk = document.createTreeWalker(column, NodeFilter.SHOW_TEXT);
  for (let node; (node = walk.nextNode());) {
    const s = getComputedStyle(node.parentElement);
    for (const m of node.data.matchAll(/\S+/g)) {
      range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
      const r = range.getBoundingClientRect();
      if (r.width) found.push({text: m[0], x: (r.left - at.left) / zoom, y: (r.top - at.top) / zoom, width: r.width / zoom, height: r.height / zoom,
        font: `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`, color: s.color});
    }
  }
  return found;
}

// Returns the homepage's text as lines for the agent, [{text, x, y, width, height}]: words that follow each other
// on one line of the page are one line, and a gap wider than 40 units starts a new one, as between a title and its
// date at the right edge.
function lines() {
  const found = [];
  for (const w of words()) {
    const l = found.at(-1), end = l && l.x + l.width;
    if (l && Math.abs(w.y - l.y) < l.height / 2 && w.x >= end && w.x - end < 40) {
      l.text += " " + w.text; l.width = w.x + w.width - l.x; l.height = Math.max(l.height, w.height);
    } else found.push({text: w.text, x: w.x, y: w.y, width: w.width, height: w.height});
  }
  return found;
}

// Returns the picture the agent gets of one part of the sheet: what the visitor sees of its width, at most 1600
// units around the middle, from y = from down, as high as what the visitor sees. One pixel is one page unit. The picture has
// the homepage's text, every stroke in its own colour, and a grid line every GRID units, labelled with its
// coordinate. As {picture, left, right, top, bottom}: a base64 PNG and the x and y of the part's edges.
function picture(from = above) {
  from = Math.round(from);
  const span = Math.min(Math.round(wide), 1600), high = Math.min(Math.round(tall), 1200);
  const x0 = Math.round(left + (wide - span) / 2);
  const can = Object.assign(document.createElement("canvas"), {width: span, height: high}), c = can.getContext("2d");
  c.fillStyle = "#fff"; c.fillRect(0, 0, span, high);
  c.strokeStyle = "#d4d4d4"; c.lineWidth = 1; c.font = "12px sans-serif"; c.textBaseline = "top";
  for (let x = (Math.floor(x0 / GRID) + 1) * GRID; x < x0 + span; x += GRID) {
    c.beginPath(); c.moveTo(x - x0, 0); c.lineTo(x - x0, high); c.stroke();
    c.fillStyle = "#8a8a8a"; c.fillText(x, x - x0 + 3, 3);
  }
  for (let y = (Math.floor(from / GRID) + 1) * GRID; y < from + high; y += GRID) {
    c.beginPath(); c.moveTo(0, y - from); c.lineTo(span, y - from); c.stroke();
    c.fillStyle = "#8a8a8a"; c.fillText(y, 3, y - from + 3);
  }
  c.textBaseline = "alphabetic";
  for (const w of words()) {   // a word's box is its font's whole height: the letters stand about 0.8 of it down
    c.font = w.font; c.fillStyle = w.color;
    c.fillText(w.text, w.x - x0, w.y - from + w.height * 0.8);
  }
  const ink = Object.assign(document.createElement("canvas"), {width: span, height: high});   // the ink on its own
  ink.getContext("2d").translate(-x0, -from);                                // layer, so that a rub leaves the text
  // every mark whole and solid, whatever the visitor sees of it so far
  paintAll(ink.getContext("2d"), from, from + high, m => ({...m, shown: undefined, draft: false, from: undefined}));
  c.globalCompositeOperation = "multiply";
  c.drawImage(ink, 0, 0);
  return {picture: can.toDataURL("image/png").split(",")[1], left: x0, right: x0 + span, top: from, bottom: from + high};
}

// ---- the visitor's pen ----

// Returns a pointer event's position in page units.
function at(e) { return [left + e.clientX / zoom, above + e.clientY / zoom]; }

// Returns where the fingers on the sheet are: {x, y}, the middle of them in the window, and `apart`, how far two of
// them are from each other, or 0 for one finger.
function grip() {
  const f = [...fingers.values()];
  return {
    x: f.reduce((s, p) => s + p.x, 0) / f.length, y: f.reduce((s, p) => s + p.y, 0) / f.length,
    apart: f.length > 1 ? Math.hypot(f[0].x - f[1].x, f[0].y - f[1].y) : 0,
  };
}

// While the visitor holds the pen or the eraser, a pen or a mouse draws. A finger draws too until a pen has been
// seen. One finger scrolls the page once a pen has been seen. Two fingers always scroll it, and zoom the sheet as
// they move apart or together: if the first of them was drawing, its stroke is dropped. Links, the tools and the window's scroll bar are never drawn on.
addEventListener("pointerdown", e => {
  if (!e.target.closest?.("#tools")) menu.replaceChildren();
  if (!holds || e.button > 0 || e.clientX >= document.documentElement.clientWidth) return;
  if (e.target.closest?.("a, button, #tools, .site-bot-check")) return;
  if (e.pointerType === "pen") { pen = true; scrolling = false; fingers.clear(); }
  if (e.pointerType === "touch") {
    if (stroke?.kind === "pen") return;
    fingers.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (pen || fingers.size > 1) { stroke = null; scrolling = true; held = grip(); redraw(); return; }
  }
  if (!stroke && !scrolling) {
    const tool = holds === "wipe" ? {wipe: WIPE} : {color: chosen, pen: PEN};
    stroke = {...tool, points: [at(e)], pointer: e.pointerId, kind: e.pointerType};
    stroke.ink = [stroke.points];
    open();   // the sheet is asked for at the first stroke, and is there by the time the pen has rested
    ready();
    redraw();
  }
});
addEventListener("pointermove", e => {
  if (fingers.has(e.pointerId)) fingers.set(e.pointerId, {x: e.clientX, y: e.clientY});
  if (scrolling && fingers.has(e.pointerId)) {
    const was = held;
    held = grip();
    scrollBy(was.x - held.x, was.y - held.y);
    if (was.apart && held.apart) scale(zoom * held.apart / was.apart);
    return;
  }
  if (!stroke || e.pointerId !== stroke.pointer) return;
  const moves = e.getCoalescedEvents?.() ?? [];   // every position since the last event, where the browser has them
  for (const c of moves.length ? moves : [e]) stroke.points.push(at(c));
  if (busy && !hurry && stroke.points.length > 4) stop();   // the visitor draws on: the agent's turn ends
  redraw();
});
function lift(e) {
  if (fingers.delete(e.pointerId)) { if (fingers.size) held = grip(); else { scrolling = false; ready(); } }
  if (!stroke || e.pointerId !== stroke.pointer) return;
  const {pointer, kind, ink, ...done} = stroke;
  stroke = null;
  marks.push(done); mine.push(done); fresh.push(done);
  added(done); grow();
  redraw(); ready();
}
addEventListener("pointerup", lift);
addEventListener("pointercancel", lift);

// ---- the visitor's tools ----

// The tools, at the bottom right: the pen, the eraser, Undo, the pen's colour and Send. Tapping the pen or the
// eraser takes it up, and tapping the one held puts it down: then the page is a plain page again, and only the pen
// shows. Tapping the colour opens the colours above the tools.
function button(kind, title, act, into = tools) {
  const b = make("button", {className: kind, title}, into);
  b.addEventListener("click", act);
  return b;
}
const drawer = button("pen", "Draw", () => hold("pen")), rubber = button("wipe", "Erase", () => hold("wipe"));
drawer.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 20l1-4L16 5l3 3L8 19z M14 7l3 3"/></svg>';
rubber.innerHTML = '<svg viewBox="0 0 24 24"><path d="M10 19l-6-6L14 3l7 7-9 9z M8 9l7 7 M10 19h10"/></svg>';
const back = button("step", "Undo", undo);
back.textContent = "↶";
const dot = button("ink", "Colour", () => {
  if (menu.children.length) { menu.replaceChildren(); return; }
  for (const color in COLORS) button("ink", color, () => { chosen = color; holds = ""; hold("pen"); }, menu).style.background = COLORS[color];
});
const send = button("", "", () => busy ? stop() : turn());
send.id = "send";

// Takes up the pen or the eraser, or puts it down if the visitor holds it already.
function hold(what) {
  holds = holds === what ? "" : what;
  menu.replaceChildren();
  document.documentElement.classList.toggle("drawing", holds !== "");
  tools.classList.toggle("off", !holds);
  drawer.classList.toggle("on", holds === "pen"); rubber.classList.toggle("on", holds === "wipe");
  dot.style.background = COLORS[chosen];
}

// Undo takes back the visitor's last mark.
function undo() {
  const m = mine.pop();
  marks = marks.filter(x => x !== m);
  if (m.seen) gone++; else fresh = fresh.filter(f => f !== m);
  settle(); redraw(); ready();
}

// Sets which buttons are live. Send shows when the visitor has drawn, rubbed out or taken back something the agent
// has not been told of. While a turn is with the agent, Send reads Stop.
function ready() {
  const news = !dead && (fresh.length || gone);
  send.textContent = busy ? "Stop" : "Send"; send.className = busy ? "stop" : "";
  send.hidden = !busy && !news;
  back.disabled = !mine.length;
  // the turn goes by itself once the pen has rested, when there are new marks for the agent
  clearTimeout(soon);
  if (!busy && !dead && fresh.length && !stroke && !scrolling) { void send.offsetWidth; send.className = "soon"; soon = setTimeout(turn, REST); }
}

// ---- the agent's turn ----

// Returns a stroke's points with those that barely bend the line left out (Ramer-Douglas-Peucker, 1.5 units).
function simplify(points) {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]), todo = [[0, points.length - 1]];
  while (todo.length) {
    const [a, b] = todo.pop(), [ax, ay] = points[a], [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = 0, at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - points[i][1]) - (ax - points[i][0]) * (by - ay)) / len;
      if (d > far) { far = d; at = i; }
    }
    if (far > 1.5) { keep.add(at); todo.push([a, at], [at, b]); }
  }
  return [...keep].sort((a, b) => a - b).map(i => points[i]);
}

// Returns the points along one SVG path, one every `step` units, or [] if the path data is not valid.
function along(d, step = 3) {
  measure.setAttribute("d", d);
  let len = 0;
  try { len = measure.getTotalLength(); } catch { return []; }
  if (!(len > 0)) return [];
  const points = [];
  for (let s = 0; s < len; s += step) { const p = measure.getPointAtLength(s); points.push([p.x, p.y]); }
  const end = measure.getPointAtLength(len);
  points.push([end.x, end.y]);
  return points;
}

// Returns the points along a path as its separate lines, each a list of points. A path may lift the pen and set it
// down elsewhere, with an M in its middle: there the next point is further away than any two points along one line
// are, and a new line starts.
function runs(points) {
  const found = [];
  points.forEach((p, i) => {
    if (i && Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) < 6) found.at(-1).push(p); else found.push([p]);
  });
  return found;
}

// Lays out one line of text that may hold maths in LaTeX notation: x^2, z_i, \frac{a}{b}, \sqrt{x}, \hat{y},
// \bar{x} and names such as \alpha and \sum.
//
// Returns a box {w, up, down, parts}, in letter units with the line the letters stand on at y = 0: w is the box's
// width, up how far it reaches above the line and down how far below. Each part is one character or one drawn
// sign, {l, x, y, s}: the strokes l.d, moved to (x, y) and scaled by s.
function laid(text) {
  const chars = [...text];
  let i = 0;
  const SHORT = /[ acegmnopqrsuvwxyzαγεημπρστω.,:;\-+=~·]/, TAILED = /[gjpqyβγημρφ,;()[\]|∫∑∏]/;
  const letter = ch => ({w: (HAND[ch] ?? HAND[" "]).w, up: SHORT.test(ch) ? 62 : 100, down: TAILED.test(ch) ? 35 : 0,
    parts: [{l: HAND[ch] ?? HAND[" "], x: 0, y: 0, s: 1}]});
  const sign = d => [{l: {d: [d]}, x: 0, y: 0, s: 1}];   // one drawn stroke as parts; d is a path as in HAND
  const put = (box, dx, dy, s) => box.parts.map(p => ({l: p.l, x: dx + p.x * s, y: dy + p.y * s, s: p.s * s}));
  const row = boxes => boxes.reduce((r, b) => ({w: r.w + b.w, up: Math.max(r.up, b.up),
    down: Math.max(r.down, b.down), parts: [...r.parts, ...put(b, r.w, 0, 1)]}), {w: 0, up: 0, down: 0, parts: []});
  const word = s => row([...s].map(letter));

  // base with a smaller box above its right shoulder, below its right foot, or both
  function scripted(base, above, below) {
    const S = 0.6, box = {w: 0, up: base.up, down: base.down, parts: [...base.parts]};
    if (above) {
      const dy = -base.up / 2;
      box.parts.push(...put(above, base.w + 3, dy, S));
      box.w = above.w * S; box.up = Math.max(box.up, above.up * S - dy);
    }
    if (below) {
      const dy = Math.max(22, base.down - 13);
      box.parts.push(...put(below, base.w + 3, dy, S));
      box.w = Math.max(box.w, below.w * S); box.down = Math.max(box.down, below.down * S + dy);
    }
    box.w += base.w + 6;
    return box;
  }

  // top over bottom, with a bar between them at the height of a minus sign
  function fraction(top, bottom) {
    const S = 0.75, BAR = -38, w = Math.max(top.w, bottom.w) * S + 20;
    const ty = BAR - 18 - top.down * S, by = BAR + 18 + bottom.up * S;
    return {w, up: top.up * S - ty, down: bottom.down * S + by, parts: [...put(top, (w - top.w * S) / 2, ty, S),
      ...put(bottom, (w - bottom.w * S) / 2, by, S), ...sign(`M 4 62 L ${w - 4} 62`)]};
  }

  // inner under a root sign
  function root(inner) {
    const top = 88 - inner.up, w = inner.w + 46;
    const d = `M 0 66 L 8 58 L 20 ${96 + inner.down} L 34 ${top} L ${w - 2} ${top}`;
    return {w, up: inner.up + 14, down: inner.down, parts: [...sign(d), ...put(inner, 38, 0, 1)]};
  }

  // inner with a hat or a bar over it
  function capped(inner, hat) {
    const y = 90 - inner.up, mid = inner.w / 2;
    const d = hat ? `M ${mid - 14} ${y} L ${mid + 2} ${y - 14} L ${mid + 18} ${y}` : `M 6 ${y} L ${inner.w - 2} ${y}`;
    return {...inner, up: inner.up + 26, parts: [...inner.parts, ...sign(d)]};
  }

  // one character, one {group} or one \command with what it takes
  function piece() {
    if (i >= chars.length) return row([]);
    const ch = chars[i++];
    if (ch === "{") return upTo("}");
    if (ch !== "\\") return letter(ch);
    const name = /^[a-zA-Z]+/.exec(chars.slice(i).join(""))?.[0];
    if (!name) return letter(" ,;:!".includes(chars[i]) ? (i++, " ") : chars[i++] ?? " ");   // \, is a space, \_ is _
    i += name.length;
    if (name === "frac") return fraction(piece(), piece());
    if (name === "sqrt") return root(piece());
    if (name === "hat" || name === "bar") return capped(piece(), name === "hat");
    if (["text", "mathrm", "mathbf", "mathit", "operatorname"].includes(name)) return piece();
    if (name === "left" || name === "right") return row([]);
    return word(NAMES[name] ?? name);
  }

  // every piece up to the closing character, or up to the end of the text
  function upTo(close) {
    const boxes = [];
    while (i < chars.length && chars[i] !== close) {
      if (chars[i] !== "^" && chars[i] !== "_") { boxes.push(piece()); continue; }
      const base = boxes.pop() ?? row([]), script = {};
      while (chars[i] === "^" || chars[i] === "_") script[chars[i++]] = piece();
      boxes.push(scripted(base, script["^"], script["_"]));
    }
    i++;
    return row(boxes);
  }

  const line = upTo(undefined);
  return {...line, up: Math.max(line.up, 100), down: Math.max(line.down, 35)};   // plain lines are all one height
}

// Returns the strokes that write one line of text inside a box in the agent's handwriting: in the text's colour, as
// large as fits in the box, and centred in it. No two letters come out the same, as with a hand: each letter's
// size, its lean and its height on the line vary a little, and each stroke wavers. A character the handwriting
// lacks leaves a gap.
function written({text, x, y, width, height, color}) {
  const line = laid(text), tall = line.up + line.down;
  const k = Math.min(height / tall, line.w ? width / line.w : Infinity);   // page units per letter unit
  const start = x + (width - line.w * k) / 2, base = y + (height - tall * k) / 2 + line.up * k;   // base: the line's y
  const vary = by => (Math.random() * 2 - 1) * by;
  const strokes = [];
  for (const p of line.parts) {
    const size = (1 + vary(0.08)) * p.s, lean = 0.08 + vary(0.07), drop = vary(4) * p.s;
    for (const d of p.l.d) {
      const wave = vary(4), step = 2 / (k * p.s);              // one point every 2 page units
      const points = along(d, step).map(([px, py], n) => {
        const far = n * step;                                  // how far along the stroke, in letter units
        const lx = p.x + (px + (100 - py) * lean + 1.8 * Math.sin(wave + far / 24)) * size;
        const ly = p.y + (py - 100 + 1.8 * Math.cos(wave * 1.7 + far / 31)) * size + drop;
        return [start + lx * k, base + ly * k];
      });
      strokes.push({color, points, gap: 2, pen: Math.max(1, Math.min(3, k * EM / 14))});
    }
  }
  return strokes;
}

// Resolves when the browser is about to paint the next frame, or after a tenth of a second in a window that is not
// being painted, such as one in the background.
function frame() { return new Promise(next => { requestAnimationFrame(next); setTimeout(next, 100); }); }

// Reveals one mark of the agent's over time, as if drawn by hand. Resolves when the whole mark shows.
async function reveal(m) {
  const total = m.points.length, rate = SPEED / (m.gap ?? 3);   // points a second
  for (const t0 = performance.now(); !hurry;) {
    m.shown = Math.ceil((performance.now() - t0) / 1000 * rate);
    if (m.shown >= total) break;
    redraw();
    await frame();
  }
  delete m.shown;
  redraw();
}

// Says beside the tools what the agent is doing, or nothing.
function note(text) { caption.textContent = text; }

// Sends the visitor's turn and carries out the agent's answer as it arrives. The first turn after the page opened
// also tells the agent which greeting the page drew.
//
// The answer comes in stretches. A stretch is the response to one request, and it ends when the agent's turn is
// over or when the agent waits to see the sheet. For the agent to see the sheet, the page sends the pictures it
// asked for as its next request, and the response to that request is the next stretch.
//
// Each stroke and text of the agent's goes on the sheet at once, as a draft that shows nothing yet, and is then
// revealed in order, one after the other. So the pictures the agent asks for have all its ink, however much of it
// the visitor has seen. The turn is over once the last mark is revealed: the drafts turn solid. When anything
// fails, the turn ends quietly, with the ink that arrived. Returns whether the agent's answer came through whole.
async function turn() {
  busy = true; hurry = false; stopper = new AbortController();
  ready();
  note("thinking…");
  await open();
  if (!sheet) { note(""); busy = false; ready(); return false; }
  const strokes = fresh.map(({color, wipe, points}) => ({color, wipe, points: simplify(points)}));
  const body = {...picture(), strokes, lines: lines(), undone: gone, greeted, zoom};
  for (const m of fresh) m.seen = true;
  fresh = []; gone = 0; greeted = null;
  ready();
  let drawing = Promise.resolve(), asked = [], over = false;
  const add = m => { marks.push(Object.assign(m, {draft: true, shown: 0})); added(m); grow(); drawing = drawing.then(() => reveal(m)); };
  const steps = {
    draw: ({paths, color, width}) => {
      for (const d of paths) for (const points of runs(along(d))) add({color, points, pen: width});
    },
    write: texts => { for (const t of texts) written(t).forEach(add); },
    erase: boxes => { for (const rub of boxes) { const m = {rub}; marks.push(m); added(m); } redraw(); },
    move: move => { const m = {move, now: () => ({})}; marks.push(m); added(m); drawing = drawing.then(() => play(m)); },
    zoom: to => { drawing = drawing.then(() => glide(to)); },
    look: one => asked.push(one),
    doing: text => note(text + "…"),
    done: () => { over = true; },
  };
  let address = `/api/sheets/${sheet}/`;
  try {
    for (let request = ["turns", body]; request;) {
      let r = await post(address + request[0], request[1], stopper.signal);
      if (kept && (r.status === 404 || r.status === 429)) {   // the kept sheet is gone or full: start a new one
        kept = false; sheet = null; opening = null;
        try { sessionStorage.removeItem(KEPT); } catch { /* storage is switched off */ }
        await open();
        if (!sheet) throw new Error("no sheet");
        address = `/api/sheets/${sheet}/`;
        r = await post(address + request[0], request[1], stopper.signal);
      }
      if (!r.ok) throw new Error(`the server answered ${r.status}`);
      const reader = r.body.getReader(), text = new TextDecoder();
      let buf = "";
      for (;;) {
        const {value, done} = await reader.read();
        if (done) break;
        buf += text.decode(value, {stream: true});
        for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) {
          const step = JSON.parse(buf.slice(0, i));
          for (const k in step) steps[k]?.(step[k]);
        }
      }
      // the stretch is over: the agent's turn goes on if the agent asked to see the sheet
      if (!asked.length && !over) throw new Error("the agent's answer broke off");
      if (asked.length) await drawing;   // a zoom the agent asked for is done before the agent sees the sheet
      request = asked.length ? ["looks", {looks: asked.map(({id, y}) => ({id, ...picture(y ?? above)}))}] : null;
      asked = [];
    }
  } catch {
    // the agent may still be at work, or waiting to see the sheet: end its turn, so that it takes the next one
    if (sheet) post(address + "stop", {}).catch(() => {});
  }
  note("");
  await drawing;
  for (const m of marks) delete m.draft;
  redraw();
  busy = false; ready();
  return over;
}

// Ends the agent's turn, when the visitor presses Stop: the requests of the turn are dropped, and the agent's ink
// that is on the sheet shows at once.
function stop() { hurry = true; stopper.abort(); }

// ---- opening the sheet ----

// Opens the visitor's sheet on the server, once: later calls return the same promise. A tab that has a sheet goes on
// with it. Otherwise the visitor passes the bot check, which never shows: a visitor Turnstile doubts gets no sheet.
// The server then starts a sheet. When any of this fails there is no sheet, and the agent does not answer in this tab.
function open() {
  return opening ??= (async () => {
    try { sheet = sessionStorage.getItem(KEPT); } catch { /* storage is switched off */ }
    if (sheet) { kept = true; return; }
    const r = await post("/api/sheets", {token: await challenge("sheet", document.body, true)});
    if (!r.ok) throw new Error(`the server answered ${r.status}`);
    sheet = (await r.json()).sheet;
    try { sessionStorage.setItem(KEPT, sheet); } catch { /* storage is switched off */ }
  })().catch(err => { dead = true; console.warn("No sheet:", err); });
}

// Draws the greeting, a happy face about 60 units high, in a bright pen colour picked at random, in the blank paper under
// the homepage's text, as if by hand, and remembers it for the agent's first turn. No request is made.
async function greet() {
  const colors = Object.keys(COLORS).filter(c => c !== YOURS && c !== "gray"), color = colors[Math.floor(Math.random() * colors.length)];
  const x = 40, y = column.offsetHeight + 24;
  const face = [`M ${x + 4} ${y + 30} a 26 26 0 1 0 52 0 a 26 26 0 1 0 -52 0`, `M ${x + 21} ${y + 21} l 0 5`,
    `M ${x + 39} ${y + 21} l 0 5`, `M ${x + 17} ${y + 36} q 13 14 26 0`];
  const strokes = face.flatMap(d => runs(along(d))).map(points => ({color, points, pen: PEN}));
  for (const m of strokes) { marks.push(Object.assign(m, {shown: 0, seen: true})); added(m); }
  greeted = {color, x, y, width: 60, height: 60};
  grow();
  for (const m of strokes) await reveal(m);
}

addEventListener("resize", fit);
addEventListener("scroll", redraw, {passive: true});
hold("pen");
scale(zoom);
fit();
ready();
greet();
