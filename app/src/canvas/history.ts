/**
 * What the person did to the sheet since the agent was last told. Undo and Redo step through it. The history keeps
 * the sheet as it was before the first thing the person did and after each thing, so Undo and Redo put back one of
 * those. Undo reaches back to when the agent was last told and no further, because the agent's turn changes the sheet
 * too.
 */
import type { Snapshot } from "../paint/sheet.ts";
import { sheet } from "./state.ts";

const states: Snapshot[] = [], // the sheet before the first thing done, and then after each thing done
  texts: string[] = [], // what the agent is told of each thing done: texts[i] took states[i] to states[i + 1]
  watchers: (() => void)[] = [];
let at = 0; // how many of the things done stand: the sheet is as states[at] has it

/** Has `fn` called after each thing the person does to the sheet, and after each Undo and Redo. */
export function watch(fn: () => void): void {
  watchers.push(fn);
}

// Puts the sheet as it was after `n` of the things done, and tells the watchers.
function go(n: number): void {
  at = n;
  sheet.restore(states[at]);
  for (const fn of watchers) fn();
}

/** Carries out `change`, something the person does to the sheet, and keeps it: `text` is what the agent is told. */
export function did(text: string, change: () => void): void {
  if (!states.length) states.push(sheet.snapshot());
  change();
  // what Undo took back is gone for good once the person does something new
  states.length = at + 1;
  texts.length = at;
  states.push(sheet.snapshot());
  texts.push(text);
  at++;
  for (const fn of watchers) fn();
}

/** Takes back the last thing the person did. */
export const undo = (): void => go(at - 1);

/** Does again what Undo took back last. */
export const redo = (): void => go(at + 1);

/** Returns how many things there are for Undo to take back, and for Redo to do again. */
export function steps(): { undo: number; redo: number } {
  return { undo: at, redo: texts.length - at };
}

/** Returns what the person did since the agent was last told, in order, as the agent is told it. */
export const done = (): string[] => texts.slice(0, at);

/** Forgets what the person did, since the agent has been told, so that Undo reaches back no further. */
export function told(): void {
  states.length = texts.length = at = 0;
}
