/**
 * The person's choices in the menu of model, Sonnet, Haiku, Sol or Luna, where Sonnet is chosen until they choose
 * another, and of mode, Pen or Brush; and an admin's choice of thinking, from off to max, which only an admin sees.
 * This browser keeps the model and the mode, and the thinking is medium each time the page opens. Each turn goes to
 * the model, at the effort and in the mode, chosen when it starts.
 */

const model = document.getElementById("model") as HTMLSelectElement,
  effort = document.getElementById("effort") as HTMLSelectElement,
  effortRow = document.getElementById("effortRow")!,
  mode = document.getElementById("mode") as HTMLSelectElement;

// Sets the choice to the one this browser kept under `key`, and keeps each new choice there.
function kept(select: HTMLSelectElement, key: string): void {
  try {
    const was = localStorage.getItem(key);
    if (was && [...select.options].some((o) => o.value === was)) select.value = was;
  } catch {
    // the browser keeps nothing, as in a private window: the default is chosen
  }
  select.addEventListener("change", () => {
    try {
      localStorage.setItem(key, select.value);
    } catch {
      // the choice holds until the page is reloaded
    }
  });
}
kept(model, "model");
kept(mode, "mode");

/** Returns the name of the model the person chose, such as "Sol". */
export const chosenModel = (): string => model.value;

/** Returns the effort an admin chose, such as "off" or "high", or undefined for a person who is not an admin. */
export const chosenEffort = (): string | undefined => (effortRow.hidden ? undefined : effort.value);

/** Returns the mode the person chose, "pen" or "brush". */
export const chosenMode = (): string => mode.value;
