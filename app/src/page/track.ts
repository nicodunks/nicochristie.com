/**
 * The page's events. The drawing agent this page was ported from records them; this site records nothing, so each
 * function here does nothing. They stay so that the modules that call them are the same as in the original.
 */

/** Returns the headers that name this browser and visit: none. */
export function ids(): Record<string, string> {
  return {};
}

/** Records an event: nothing here. */
export function track(_name: string, _row: object = {}): void {}

/** Counts one more of something the person did: nothing here. */
export function tally(_what: string): void {}
