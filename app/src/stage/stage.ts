/**
 * The page's end of the stage worker, which runs the animations' frame functions. For each picture the page shows,
 * it asks the worker what each running animation shows at its time. The worker keeps nothing of the page between
 * asks, so every ask holds all the animations on the page: one animation can play another.
 */
import type { Shot } from "../paint/pose.ts";
import type { Animation } from "../paint/sheet.ts";
import { Caller } from "../sandbox/caller.ts";

const LIMIT = 2000; // how long the worker may take to answer, in milliseconds

/** What one animation shows at one moment, and `played`: the names of the animations it played to show it. */
export interface Taken extends Shot {
  played: string[];
}

/** An ask for what the animation called `name`, one of `animations`, shows at each of `times`, in seconds. */
export interface Ask {
  animations: Animation[];
  name: string;
  times: number[];
}

/** The worker's answer: one shot for each time, or what went wrong at the first time that failed. */
export type Reply = { shots: Taken[] } | { error: string };

export class Stage {
  private caller = new Caller<Ask, Reply>("/draw/stage.js", LIMIT);

  /**
   * Resolves with what the animation called `name`, one of `animations`, shows at each of `times`, or with the error
   * that stopped its frame function. A frame function that runs longer than LIMIT is stopped, and that is its error.
   */
  async shots(animations: Animation[], name: string, times: number[]): Promise<Reply> {
    const reply = await this.caller.ask({ animations, name, times });
    return reply ?? { error: `frame ran longer than ${LIMIT / 1000} seconds and was stopped` };
  }
}
