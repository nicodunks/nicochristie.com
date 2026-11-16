/** Turns SVG path data into points along the path, without a browser, so it works in the page and in a worker. */
import type { Point } from "./api.ts";
import { FAR } from "./constants.ts";

const TOKEN = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

/**
 * Returns each piece of the path as points about `step` units apart along it. A piece starts at each M, and after
 * each Z. Throws an Error that says what is wrong if the path data is malformed.
 */
export function flatten(d: string, step = 3): Point[][] {
  if (d.replace(TOKEN, "").replace(/[\s,]/g, "")) throw new Error(`path has characters that are not path data: ${d}`);
  const tokens = d.match(TOKEN) ?? [];
  const pieces: Point[][] = [];
  let piece: Point[] = [];
  let i = 0,
    cmd = "",
    x = 0,
    y = 0,
    sx = 0,
    sy = 0; // the pen, and where the piece started
  let px = 0,
    py = 0,
    last = ""; // the last control point, for S and T, and the command it came from

  const num = (): number => {
    const t = tokens[i];
    if (t === undefined || /[a-zA-Z]/.test(t)) throw new Error(`path ${cmd} is missing a number: ${d}`);
    i++;
    const v = Number(t);
    if (Math.abs(v) > FAR) throw new Error(`path has a number farther than ${FAR} from 0: ${t}`);
    return v;
  };
  const end = () => {
    if (piece.length > 1) pieces.push(piece);
    piece = [];
  };
  const to = (nx: number, ny: number) => {
    if (!piece.length) piece.push([x, y]);
    piece.push([nx, ny]);
    x = nx;
    y = ny;
  };
  const curve = (at: (t: number) => Point, length: number) => {
    const n = Math.max(2, Math.ceil(length / Math.max(0.5, step / 2)));
    for (let k = 1; k <= n; k++) to(...at(k / n));
  };
  const cubic = (x1: number, y1: number, x2: number, y2: number, ex: number, ey: number) => {
    const [x0, y0] = [x, y];
    const length = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(ex - x2, ey - y2);
    curve((t) => {
      const u = 1 - t;
      return [
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey,
      ];
    }, length);
    [px, py] = [x2, y2];
  };
  const quadratic = (x1: number, y1: number, ex: number, ey: number) => {
    const [x0, y0] = [x, y];
    curve(
      (t) => {
        const u = 1 - t;
        return [u * u * x0 + 2 * u * t * x1 + t * t * ex, u * u * y0 + 2 * u * t * y1 + t * t * ey];
      },
      Math.hypot(x1 - x0, y1 - y0) + Math.hypot(ex - x1, ey - y1),
    );
    [px, py] = [x1, y1];
  };

  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) throw new Error(`path has a number with no command before it: ${d}`);
    const rel = cmd === cmd.toLowerCase(),
      ox = rel ? x : 0,
      oy = rel ? y : 0;
    const C = cmd.toUpperCase();
    if (C === "M") {
      end();
      x = num() + ox;
      y = num() + oy;
      [sx, sy] = [x, y];
      cmd = rel ? "l" : "L"; // more pairs after an M are lines
    } else if (C === "L") to(num() + ox, num() + oy);
    else if (C === "H") to(num() + ox, y);
    else if (C === "V") to(x, num() + oy);
    else if (C === "C") cubic(num() + ox, num() + oy, num() + ox, num() + oy, num() + ox, num() + oy);
    else if (C === "S") {
      const [rx, ry] = last === "C" || last === "S" ? [2 * x - px, 2 * y - py] : [x, y];
      cubic(rx, ry, num() + ox, num() + oy, num() + ox, num() + oy);
    } else if (C === "Q") quadratic(num() + ox, num() + oy, num() + ox, num() + oy);
    else if (C === "T") {
      const [rx, ry] = last === "Q" || last === "T" ? [2 * x - px, 2 * y - py] : [x, y];
      quadratic(rx, ry, num() + ox, num() + oy);
    } else if (C === "A") {
      const rx = Math.abs(num()),
        ry = Math.abs(num()),
        turn = num(),
        large = num(),
        sweep = num();
      arc(rx, ry, turn, large !== 0, sweep !== 0, num() + ox, num() + oy);
    } else if (C === "Z") {
      to(sx, sy);
      end();
      cmd = ""; // a Z takes no numbers, so numbers after it are an error
    } else throw new Error(`path has an unknown command ${cmd}: ${d}`);
    last = C;
  }
  end();
  return pieces.map((p) => spaced(p, step));

  // An arc of an ellipse from the pen to (ex, ey), turned from the centre form the path gives (the SVG spec's F.6.5).
  function arc(rx: number, ry: number, turn: number, large: boolean, sweep: boolean, ex: number, ey: number) {
    if (!rx || !ry || (ex === x && ey === y)) return to(ex, ey);
    const a = (turn * Math.PI) / 180,
      cos = Math.cos(a),
      sin = Math.sin(a);
    const hx = (x - ex) / 2,
      hy = (y - ey) / 2;
    const x1 = cos * hx + sin * hy,
      y1 = -sin * hx + cos * hy;
    const grow = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (grow > 1) [rx, ry] = [rx * Math.sqrt(grow), ry * Math.sqrt(grow)];
    const top = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, top / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
    const cx1 = (k * rx * y1) / ry,
      cy1 = (-k * ry * x1) / rx;
    const cx = cos * cx1 - sin * cy1 + (x + ex) / 2,
      cy = sin * cx1 + cos * cy1 + (y + ey) / 2;
    const angle = (ux: number, uy: number) => Math.atan2(uy, ux);
    const t0 = angle((x1 - cx1) / rx, (y1 - cy1) / ry);
    let dt = angle((-x1 - cx1) / rx, (-y1 - cy1) / ry) - t0;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    curve(
      (t) => {
        const th = t0 + dt * t,
          ux = rx * Math.cos(th),
          uy = ry * Math.sin(th);
        return [cos * ux - sin * uy + cx, sin * ux + cos * uy + cy];
      },
      Math.abs(dt) * Math.max(rx, ry),
    );
  }
}

/** Returns the points of a line `step` units apart along it, from its first point to its last. */
export function spaced(points: Point[], step: number): Point[] {
  const out: Point[] = [points[0]];
  let carry = 0; // how far the last point placed is from the end of the segment before
  for (let k = 1; k < points.length; k++) {
    const [ax, ay] = points[k - 1],
      [bx, by] = points[k],
      len = Math.hypot(bx - ax, by - ay);
    let at = step - carry;
    for (; at <= len; at += step) out.push([ax + ((bx - ax) * at) / len, ay + ((by - ay) * at) / len]);
    carry = len - (at - step);
  }
  const end = points[points.length - 1],
    tail = out[out.length - 1];
  if (end[0] !== tail[0] || end[1] !== tail[1]) out.push(end);
  return out;
}
