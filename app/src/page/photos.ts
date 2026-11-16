/**
 * The person's photos. Photo opens the phone's camera or the computer's files, and the chosen picture goes into the
 * agent's folder as /photos/1.jpg, /photos/2.png and so on. The photos show as small pictures above the notes, and the
 * next turn gives each new one to the agent. A photo the agent has been given is faded; one it has not been given has
 * a × that takes it away again.
 */
import { attached, folder } from "./state.ts";
import { ready } from "./tools.ts";
import { track } from "./track.ts";

const strip = document.getElementById("photos")!;
const chooser = document.getElementById("file") as HTMLInputElement;

/** Shows the photos. */
export function pinned(): void {
  strip.replaceChildren(
    ...attached.map((p) => {
      const chip = document.createElement("div"),
        img = document.createElement("img");
      chip.className = p.sent ? "photo sent" : "photo";
      img.src = URL.createObjectURL(
        new Blob([folder[p.path].data as Uint8Array<ArrayBuffer>], { type: folder[p.path].type }),
      );
      img.onload = () => URL.revokeObjectURL(img.src);
      img.alt = p.path;
      chip.append(img);
      if (!p.sent) {
        const drop = document.createElement("button");
        drop.textContent = "×";
        drop.addEventListener("click", () => {
          attached.splice(attached.indexOf(p), 1);
          delete folder[p.path];
          pinned();
          ready();
        });
        chip.append(drop);
      }
      return chip;
    }),
  );
}

document.getElementById("photo")!.addEventListener("click", () => chooser.click());

chooser.addEventListener("change", async () => {
  const file = chooser.files?.[0];
  chooser.value = ""; // so the same picture can be chosen again
  if (!file) return;
  let n = 1; // the first number no photo in the folder has, whatever its extension
  while (Object.keys(folder).some((p) => p.startsWith(`/photos/${n}.`))) n++;
  const path = `/photos/${n}.${file.type.split("/")[1]?.replace("jpeg", "jpg") || "img"}`;
  folder[path] = { type: file.type, data: new Uint8Array(await file.arrayBuffer()) };
  track("photo_added", { props: { type: file.type, bytes: file.size } });
  attached.push({ path, sent: false });
  pinned();
  ready();
});
