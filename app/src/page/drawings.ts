/**
 * The person's drawings. /draw keeps every drawing in the browser's IndexedDB and shows them on a shelf; this site keeps
 * nothing, so a reload starts a new sheet (about.ts), and the drawing changing is told to no one.
 */

/** Marks the open drawing as changed by the agent's turn: nothing here. */
export function changed(): void {}
