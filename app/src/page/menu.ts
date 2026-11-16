/**
 * The menu at the top left: the choice of model, Add a photo, Save, Download, and Sign out. Menu opens
 * and closes it, and choosing anything in it, or touching anywhere else, closes it. What each row does is set up by the
 * module it belongs to.
 */
const more = document.getElementById("more")!,
  panel = document.getElementById("panel")!;

/** Opens the menu, or closes it. */
function show(on: boolean): void {
  panel.hidden = !on;
  more.classList.toggle("on", on);
}

more.addEventListener("click", () => show(panel.hidden));
panel.addEventListener("click", (e) => {
  if ((e.target as Element).closest("button")) show(false);
});
addEventListener("pointerdown", (e) => {
  if (!panel.hidden && !(e.target as Element).closest("#more, #panel")) show(false);
});
