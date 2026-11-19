/**
 * The person's pictures. The picture button in the tools puts a picture from the person's device on the sheet, in the
 * middle of what they see, as an image mark of theirs, shrunk as the agent's image() shrinks one, so it saves, shares,
 * stacks and is erased as other ink is. The new picture comes picked, with the Select tool, so the person can move or
 * resize it at once.
 */
import type { Box } from "../paint/api.ts";
import { picked } from "../run/files.ts";
import { did } from "./history.ts";
import { hooks } from "./hooks.ts";
import { session, sheet } from "./state.ts";
import { inView } from "./view.ts";

let placed: (id: number) => void = () => {}; // what follows a picture's going on the sheet, given its ink id
const chooser = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" });

/** Asks the person for a picture from their device, puts it on the sheet, and then does `then` with its ink id. */
export function choosePicture(then: (id: number) => void): void {
  placed = then;
  if (!session.busy) chooser.click();
}

chooser.addEventListener("change", () => {
  const file = chooser.files?.[0];
  chooser.value = ""; // so that choosing the same picture again puts it on again
  if (file) void put(file);
});

// Puts a picture on the sheet in the middle of what the person sees, at most half as wide and three fifths as tall
// as that, and no larger than its own pixels. A file that is not a picture the browser can read is left out.
async function put(file: File): Promise<void> {
  const picture = await picked(file).catch(() => undefined);
  if (!picture || session.busy) return;
  const seen = inView(),
    k = Math.min(1, seen.width / 2 / picture.width, (seen.height * 0.6) / picture.height),
    [width, height] = [picture.width * k, picture.height * k],
    [x, y] = [seen.x + (seen.width - width) / 2, seen.y + (seen.height - height) / 2],
    id = sheet.next++;
  hooks.track("picture_placed", { type: file.type, bytes: file.size });
  did(`put a picture on the page as ink ${id} within ${boxed({ x, y, width, height })}`, () =>
    sheet.marks.push({
      kind: "image",
      id,
      by: "person",
      made: "image",
      color: "black",
      opacity: 1,
      src: picture.src,
      at: [
        [x, y],
        [x + width, y],
        [x, y + height],
      ],
      cuts: [],
    }),
  );
  placed(id);
}

// Returns a box as the agent is told one, in whole page units.
function boxed(b: Box): string {
  const [x, y, width, height] = [b.x, b.y, b.width, b.height].map(Math.round);
  return `{x: ${x}, y: ${y}, width: ${width}, height: ${height}}`;
}
