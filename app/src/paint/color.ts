/**
 * The colour picker: it draws the sheet under one point into a one-pixel image, as the agent's picture shows it, and
 * names the page colour nearest that pixel.
 */
import type { Box, Color } from "./api.ts";
import { draw } from "./draw.ts";
import { COLORS } from "./constants.ts";
import type { Sheet } from "./sheet.ts";

/** Returns the name of the colour nearest the colour at (x, y), which is "white" where there is no ink. */
export function colorAt(sheet: Sheet, x: number, y: number): Color {
  const [r, g, b] = image(sheet, { x: x - 0.5, y: y - 0.5, width: 1, height: 1 }, 1, 1, 1);
  const far = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return Math.hypot(r - (n >> 16), g - ((n >> 8) & 255), b - (n & 255));
  };
  let best: Color = "white",
    least = Infinity;
  for (const [name, hex] of Object.entries(COLORS)) if (far(hex) < least) [best, least] = [name as Color, far(hex)];
  return best;
}

// Returns the pixels of the sheet's part `b`, drawn w by h at k pixels a page unit on white, as RGBA bytes.
function image(sheet: Sheet, b: Box, w: number, h: number, k: number): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(w, h),
    c = canvas.getContext("2d", { willReadFrequently: true })!;
  c.fillStyle = "#fff";
  c.fillRect(0, 0, w, h);
  c.setTransform(k, 0, 0, k, -b.x * k, -b.y * k);
  for (const m of sheet.marks) draw(c, m);
  return c.getImageData(0, 0, w, h).data;
}
