/**
 * The style picker, at the top left beside the magnifier: the style the agent draws in. Each style is shown as a
 * stroke the page's own painter painted in that style, kept as a picture in styles/<style>.png, so the picker shows
 * what the sheet will without painting anything as the page loads. Auto lets the agent choose; Clean draws with p5's
 * shapes only; Ink, Pencil, Watercolour and Crayon paint with p5.brush's media. This browser keeps the choice, and each
 * turn names the style chosen when it starts.
 */

/** The styles, each with its name in the turn and its label. */
const STYLES = [
  { id: "auto", label: "Auto" },
  { id: "clean", label: "Clean" },
  { id: "ink", label: "Ink" },
  { id: "pencil", label: "Pencil" },
  { id: "watercolour", label: "Watercolour" },
  { id: "crayon", label: "Crayon" },
];

const picker = document.getElementById("style")!,
  styled = document.getElementById("styled") as HTMLButtonElement,
  list = document.getElementById("styles")!;

/** Returns the picture of a style's stroke. */
function icon(id: string): HTMLImageElement {
  const img = new Image(48, 24);
  img.src = `/draw/styles/${id}.png`; // nicochristie.com serves them under /draw/
  img.alt = "";
  return img;
}

let chosen = "auto";
try {
  chosen = STYLES.find((s) => s.id === localStorage.getItem("style"))?.id ?? chosen;
} catch {
  // the browser keeps nothing, as in a private window: Auto is chosen
}

/** Chooses a style: the button shows its stroke, and this browser keeps it. */
function choose(id: string): void {
  chosen = id;
  styled.replaceChildren(icon(id));
  styled.title = `Style: ${STYLES.find((s) => s.id === id)!.label}`;
  for (const b of list.children) b.classList.toggle("on", (b as HTMLElement).dataset.style === id);
  try {
    localStorage.setItem("style", id);
  } catch {
    // the choice holds until the page is reloaded
  }
}

for (const s of STYLES) {
  const b = document.createElement("button");
  b.dataset.style = s.id;
  b.append(icon(s.id), s.label);
  b.addEventListener("click", () => {
    choose(s.id);
    list.hidden = true;
  });
  list.append(b);
}
choose(chosen);
styled.addEventListener("click", () => (list.hidden = !list.hidden));
addEventListener("pointerdown", (e) => {
  if (!picker.contains(e.target as Node)) list.hidden = true;
});

/** Returns the style the person chose, such as "watercolour". */
export const chosenStyle = (): string => chosen;
