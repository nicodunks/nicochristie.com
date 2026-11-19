/**
 * Pictures of the sheet. The agent is given one part of the page: the ink on the paper, under a grid labelled with
 * coordinates. The person's drawings are kept and exported as the whole of the ink on the paper, with no grid.
 */
import type { Box } from "../paint/api.ts";
import { decoded, draw } from "../paint/draw.ts";
import { GRID, NARROW, css } from "../paint/constants.ts";
import { type Shot, posed } from "../paint/pose.ts";
import { OPEN, sheet } from "./state.ts";

/** A picture of part of the page, as the agent is given it: a base64 JPEG and the x and y of its edges. */
export interface Picture {
  picture: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const WIDEST_PICTURE = 2576; // the most pixels across or down a picture Claude takes without shrinking it
const BORDER = 24; // the paper around the ink in a picture of the whole drawing, in page units

/**
 * Returns a picture of the whole drawing: all the ink where the sheet has it, on the paper, with BORDER units of paper
 * around it. It has two pixels to a page unit, or fewer where that would make it more than `most` pixels across or
 * down. A blank sheet gives a picture of paper as wide as the window. Resolves once the sheet's pictures are decoded.
 */
export async function whole(most: number): Promise<HTMLCanvasElement> {
  await decoded(sheet.marks);
  const box = sheet.marks.length ? sheet.around(sheet.marks) : { x: 0, y: 0, width: OPEN, height: OPEN / 2 };
  const [x0, y0, wide, high] = [box.x - BORDER, box.y - BORDER, box.width + 2 * BORDER, box.height + 2 * BORDER],
    k = Math.min(2, most / Math.max(wide, high)); // pixels per page unit
  const can = document.createElement("canvas");
  [can.width, can.height] = [Math.max(1, Math.round(wide * k)), Math.max(1, Math.round(high * k))];
  const c = can.getContext("2d")!;
  c.fillStyle = css(sheet.paper);
  c.fillRect(0, 0, can.width, can.height);
  c.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  for (const m of sheet.marks) draw(c, m);
  return can;
}

/**
 * Returns the picture the agent gets of one box of the sheet, the whole box, widened around its middle to NARROW
 * units across if it is narrower, and as much taller. One pixel is one page unit, or less where that would make the
 * picture larger than Claude takes, and a grid line every GRID units is labelled with its coordinate. Every mark is
 * whole and where the sheet has it, or where `shot` holds it if given. Resolves once the sheet's pictures are decoded.
 */
export async function picture({ x, y, width, height }: Box, shot?: Shot): Promise<Picture> {
  await decoded(sheet.marks);
  const from = Math.max(0, Math.round(y)),
    span = Math.round(Math.max(NARROW, width)),
    x0 = Math.round(Math.max(0, x + (width - span) / 2));
  const high = Math.round((height * span) / Math.max(1, width)),
    k = Math.min(1, WIDEST_PICTURE / Math.max(span, high)); // pixels per page unit
  const can = document.createElement("canvas");
  [can.width, can.height] = [Math.round(span * k), Math.round(high * k)];
  const c = can.getContext("2d")!;
  c.scale(k, k);
  c.fillStyle = css(sheet.paper);
  c.fillRect(0, 0, span, high);
  c.strokeStyle = "#d4d4d4";
  c.lineWidth = 1 / k;
  c.font = `${12 / k}px sans-serif`;
  c.textBaseline = "top";
  c.fillStyle = "#8a8a8a";
  for (let x = (Math.floor(x0 / GRID) + 1) * GRID; x < x0 + span; x += GRID) {
    c.beginPath();
    c.moveTo(x - x0, 0);
    c.lineTo(x - x0, high);
    c.stroke();
    c.fillText(String(x), x - x0 + 3, 3);
  }
  for (let y = (Math.floor(from / GRID) + 1) * GRID; y < from + high; y += GRID) {
    c.beginPath();
    c.moveTo(0, y - from);
    c.lineTo(span, y - from);
    c.stroke();
    c.fillText(String(y), 3, y - from + 3);
  }
  c.setTransform(k, 0, 0, k, -x0 * k, -from * k);
  const pose = shot ? posed(sheet, shot.poses) : () => undefined;
  for (const m of [...sheet.marks, ...(shot?.ink ?? [])]) draw(c, m, pose(m));
  return {
    picture: can.toDataURL("image/jpeg", 0.85).split(",")[1], // JPEG, since a sheet with a photo on it is many times smaller than as PNG
    left: x0,
    right: x0 + span,
    top: from,
    bottom: from + high,
  };
}
