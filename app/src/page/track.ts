/**
 * The page's events. /draw records them for its own analytics; this site records nothing, so each function here does
 * nothing. They stay so that the modules taken from /draw, which call them, need no change.
 */

/** Records an event: nothing here. */
export function track(_name: string, _row: object = {}): void {}

/** Counts one more of something the person did: nothing here. */
export function tally(_what: string): void {}
