/**
 * The model and how hard it thinks. /draw's menu lets a person choose both; this site has no menu, so every turn goes
 * to Opus, and the effort is the Worker's own (low), which a turn that names none gets.
 */

/** Returns the name of the model every turn goes to. */
export const chosenModel = (): string => "Opus";

/** Returns the effort a turn names: none, so the Worker's own. */
export const chosenEffort = (): string | undefined => undefined;
