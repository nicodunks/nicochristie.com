/**
 * When each animation on a page shows what. The page's animations share one clock, whose time T counts the seconds
 * since they all started. An animation starts `at` seconds in, 0 if it has no `at`, and shows nothing before then. One
 * with `seconds` runs that long and then holds its last pose; when the last of these is over, they all start again.
 * One without `seconds` runs on and never starts again, so a swaying tree does not jump when the others start again.
 */
import type { Animation } from "./sheet.ts";

type Timed = Pick<Animation, "name" | "at" | "seconds">;

/** Returns when an animation starts, in seconds on the shared clock. */
export const start = (a: Pick<Animation, "at">): number => a.at ?? 0;

/** Returns how long the animations with `seconds` take, after which they start again, or 0 if there are none. */
export function length(animations: Iterable<Timed>): number {
  let end = 0;
  for (const a of animations) if (a.seconds !== undefined) end = Math.max(end, start(a) + a.seconds);
  return end;
}

/** Returns each animation's own time when the shared clock is at T, by its name, for those that have started. */
export function timesAt(animations: Timed[], T: number): Map<string, number> {
  const span = length(animations),
    times = new Map<string, number>();
  for (const a of animations) {
    const t = (a.seconds === undefined || !span ? T : T % span) - start(a);
    if (t >= 0) times.set(a.name, a.seconds === undefined ? t : Math.min(t, a.seconds));
  }
  return times;
}
