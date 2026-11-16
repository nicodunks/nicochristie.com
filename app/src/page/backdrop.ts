/**
 * The paper's grain: very faint clouds of digits over the whole window, as the workspace of the Dragonslayer app has
 * them, but far fainter. It is one tile, drawn once when the page opens and repeated, in a layer just over the sheet
 * that takes no touches. It lies on the paper, so it scrolls and zooms with the sheet, and it is the size it was drawn
 * at in the view the page opens on. It is no part of the drawing: the agent does not see it, and Download leaves it out.
 */
import { OPEN } from "./state.ts";
import { canvas, view } from "./view.ts";

const TILE = [704, 500], // whole cells, so the tile repeats without a seam
  CELL = [16, 20];
// Waves [fx, fy, phase, weight] whose periods divide the tile, so the clouds wrap around its edges. The broad ones
// shape the clouds; the fine ones roughen their edges.
const WAVES = [
  [1, 0, 0.0, 1.0],
  [0, 1, 1.3, 0.9],
  [1, 1, 2.1, 0.8],
  [2, -1, 0.7, 0.6],
  [-1, 2, 4.0, 0.55],
  [3, 1, 2.9, 0.35],
  [1, -3, 5.2, 0.3],
  [5, 2, 1.1, 0.16],
  [-4, 5, 3.3, 0.14],
  [7, -3, 0.4, 0.1],
];
const LEVELS = ["1277", "2337", "3389", "8889"]; // sparse edges read as light strokes, dense centres as heavy ones
const FAINTEST = 0.022, // how solid a digit at a cloud's edge is, from 0 to 1
  MORE = 0.075; // how much more solid a digit at a cloud's centre is

/** Returns how dense the clouds are at (x, y) of the tile, from 0 to 1. */
function density(x: number, y: number): number {
  const total = WAVES.reduce(
    (sum, [fx, fy, phase, weight]) =>
      sum + weight * Math.sin(2 * Math.PI * ((fx * x) / TILE[0] + (fy * y) / TILE[1]) + phase),
    0,
  );
  return (total / WAVES.reduce((sum, w) => sum + w[3], 0) + 1) / 2;
}

const tile = document.createElement("canvas"),
  dots = Math.min(3, Math.ceil(devicePixelRatio || 1)), // the screen's pixels to one of the page's
  g = tile.getContext("2d");
if (g) {
  tile.width = TILE[0] * dots;
  tile.height = TILE[1] * dots;
  g.scale(dots, dots);
  g.font = "500 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  g.textBaseline = "top";
  for (let row = 0; row < TILE[1] / CELL[1]; row++)
    for (let column = 0; column < TILE[0] / CELL[0]; column++) {
      const x = column * CELL[0],
        y = row * CELL[1],
        d = density(x, y);
      if (d < 0.53) continue;
      const strength = Math.min(1, (d - 0.53) / 0.36),
        pick = (Math.imul(row * 10007 + column + 1, 2654435761) >>> 16) % 4; // the same digit each time for a cell
      g.fillStyle = `rgba(102, 102, 102, ${FAINTEST + MORE * strength})`;
      g.fillText(LEVELS[Math.min(3, Math.floor(strength * 4))][pick], x + 2.5, y + 3);
    }
  const layer = document.createElement("div");
  layer.id = "grain";
  layer.style.backgroundImage = `url(${tile.toDataURL()})`;
  canvas.after(layer);
  // Before each picture the browser shows, puts the tile where the sheet's view has it, if the view has changed.
  const open = (innerWidth || OPEN) / OPEN; // window pixels per page unit in the view the page opens on
  let was = "";
  const follow = (): void => {
    const now = `${view.left} ${view.above} ${view.scale}`;
    if (now !== was) {
      was = now;
      const k = view.scale / open;
      layer.style.backgroundSize = `${TILE[0] * k}px ${TILE[1] * k}px`;
      layer.style.backgroundPosition = `${-view.left * view.scale}px ${-view.above * view.scale}px`;
    }
    requestAnimationFrame(follow);
  };
  follow();
}
