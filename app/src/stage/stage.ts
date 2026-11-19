/**
 * The page's end of the stage worker, which runs the animations' frame functions. For each picture the page shows,
 * it asks the worker what each running animation shows at its time. The worker keeps nothing of the page between
 * asks, so every ask holds the animation it is about.
 */
import type { Shot } from "../paint/pose.ts";
import type { Animation } from "../paint/sheet.ts";
import { Caller } from "../sandbox/caller.ts";

const LIMIT = 2000; // how long the worker may take to answer, in milliseconds

/** An ask for what `animation` shows at each of `times`, in seconds. */
export interface Ask {
  animation: Animation;
  times: number[];
}

/** The worker's answer: one shot for each time, or what went wrong at the first time that failed. */
export type Reply = { shots: Shot[] } | { error: string };

export class Stage {
  private caller = new Caller<Ask, Reply>("stage.js", LIMIT);

  /**
   * Resolves with what `animation` shows at each of `times`, or with the error that stopped its frame function. A frame
   * function that runs longer than LIMIT is stopped, and that is its error.
   */
  async shots(animation: Animation, times: number[]): Promise<Reply> {
    const reply = await this.caller.ask({ animation, times });
    return reply ?? { error: `frame ran longer than ${LIMIT / 1000} seconds and was stopped` };
  }
}
