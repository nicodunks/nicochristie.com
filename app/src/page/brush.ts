/**
 * The brush, beside Type: one button that turns brush mode on and off. With it on, the agent paints with a brush's
 * media and its turns go to Sol; with it off, the agent draws with the pen and its turns go to Sonnet. The button sets
 * the two choices of the menu this site hides, Mode and Brain, which model.ts reads and keeps in this browser, so the
 * page opens in the mode it was left in.
 */
const button = document.getElementById("brush")!,
  mode = document.getElementById("mode") as HTMLSelectElement,
  model = document.getElementById("model") as HTMLSelectElement;

/** Turns brush mode on or off, and shows which on the button. */
function paint(on: boolean): void {
  mode.value = on ? "brush" : "pen";
  model.value = on ? "Sol" : "Sonnet";
  for (const choice of [mode, model]) choice.dispatchEvent(new Event("change")); // model.ts keeps each choice
  button.classList.toggle("on", on);
  button.ariaPressed = String(on);
  button.title = on ? "Painting with a brush: tap to draw with the pen" : "Paint with a brush";
}

// While ONLY is true, the page is always in brush mode and the button is not shown: a trial of the site with the
// brush alone. Set it to false to bring the button, and the pen, back.
const ONLY = true;
button.addEventListener("click", () => paint(mode.value !== "brush"));
if (ONLY) button.style.display = "none";
paint(ONLY || mode.value === "brush");
