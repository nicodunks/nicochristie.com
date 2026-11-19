/**
 * Runs the agent's calls of its run tool while the agent is still writing them. A call of run gives either new code,
 * which the page saves as a new file of the agent's folder and names in the call's result, or the path of a file
 * already in the folder, which runs again. The code is cut into blocks at each line that ends with the statement
 * `render();`, alone on its line or after other statements. While the agent writes new code, each block goes to the
 * run worker as soon as its render() line is whole, and the ops the block made come back to be put on the page; once
 * the call is whole, its code is saved in its file. Blocks run one at a time, in the order they were written, across
 * all the turn's calls. A block that fails stops the rest of its call.
 *
 * The page's sheet and the agent's folder are the only ones that count. Every block is sent with the sheet and the
 * folder as the page has them, so the worker never has to be kept in step with the page. The files a block writes
 * come back with its answer. While a block waits for a search or a download, the worker asks the page for it, and the
 * page does it through the gateway.
 */
import type { Box } from "../paint/api.ts";
import type { Op, Peek } from "../paint/ops.ts";
import type { Snapshot } from "../paint/sheet.ts";
import { Caller } from "../sandbox/caller.ts";

const LIMIT = 10_000; // how long one block may run, in milliseconds, not counting its waits for searches and downloads
const SKIPPED = "The blocks after this one in the call did not run.";
const END = /(^|;)[ \t]*render\(\);?[ \t]*$/m; // a line that ends a block: one that ends with the statement render();

/** One of the agent's files: its media type, such as "image/jpeg" or "text/plain", and its bytes. */
export interface Saved {
  type: string;
  data: Uint8Array;
}

/** The agent's files, by path, such as "/code/1.js". They last as long as the page stays open. */
export type Folder = Record<string, Saved>;

/** A picture in the folder that a block asked to see: its path, and the picture as a base64 JPEG. */
export interface Viewed {
  path: string;
  jpeg: string;
}

/** What the worker asks the page for in the middle of a block: a Brave search, or a download. */
export type Need = { fn: "braveSearch"; endpoint: string; params: object } | { fn: "download"; url: string };

/**
 * What the page sends the worker: one block of code and which block of its call it is, counted from 1, the sheet and
 * the folder to run it on, and what the person sees.
 */
export interface Ask {
  code: string;
  block: number;
  sheet: Snapshot;
  folder: Folder;
  view: Box;
}

/**
 * What the worker answers for one block: its ops, the files it wrote, what it printed, the pictures of the page and
 * the files it asked to see, the part the person sees after the block's calls of show, and the error that stopped it.
 */
export interface Answer {
  ops: Op[];
  wrote: Folder;
  printed: string[];
  peeks: Peek[];
  views: Viewed[];
  view: Box;
  error?: string;
}

/** What one call of the run tool gave back: everything it printed, the pictures it asked for, and its error. */
export type Ran = Pick<Answer, "printed" | "peeks" | "views" | "error">;

/** The input of a call of run, as far as the agent has written it: new code, or the path of a file to run again. */
export interface RunInput {
  code?: unknown;
  path?: unknown;
}

/** One call of run: how many characters of its code have gone to the worker, in how many blocks, and what it gave. */
interface Call {
  sent: number;
  blocks: number;
  ran: Ran;
}

export class Run {
  private caller: Caller<Ask, Answer>;
  private calls = new Map<string, Call>(); // each call by its id
  private queue = Promise.resolve();
  private stopped?: string; // why the person's turn was stopped, once it has been

  /**
   * `sheet` returns the page's sheet as it is now, `folder` is the agent's folder, which the files a block writes go
   * into, and `view` is the part of the sheet the person sees. `applied` is given the ops of each block as the block
   * finishes, and resolves with what went wrong on the page with one of them, if anything did: that becomes the
   * block's error. `serve` does what a block asks the page for, and resolves with the result.
   */
  constructor(
    private sheet: () => Snapshot,
    private folder: Folder,
    private view: Box,
    private applied: (ops: Op[]) => Promise<string | undefined>,
    serve: (need: Need) => Promise<unknown>,
  ) {
    this.caller = new Caller<Ask, Answer>("run.js", LIMIT, serve as (need: unknown) => Promise<unknown>);
  }

  /** Takes the input of call `id` as written so far, and sends each block of its new code that is now whole. */
  wrote(id: string, input: RunInput): void {
    if (typeof input.code !== "string") return;
    const call = this.call(id);
    for (;;) {
      const rest = input.code.slice(call.sent),
        end = END.exec(rest);
      if (!end || !rest.slice(end.index).includes("\n")) return; // no whole render() line yet
      const block = rest.slice(0, end.index + end[0].length);
      call.sent += block.length;
      this.send(call, block);
    }
  }

  /**
   * Takes the whole input of call `id`. New code is saved as the next free file /code/1.js, /code/2.js, …, whose path
   * goes first in what the call gave back, and its last blocks are sent. With no code, the file at path is read once
   * the blocks before it have run, so that it holds what their calls of edit changed, and its code is sent block by
   * block. Resolves with what the call gave back once all of it has run.
   */
  async finish(id: string, input: RunInput): Promise<Ran> {
    const call = this.call(id),
      { code, path } = input;
    if (typeof code === "string") {
      let n = 1;
      while (Object.hasOwn(this.folder, `/code/${n}.js`)) n++;
      this.folder[`/code/${n}.js`] = { type: "text/javascript", data: new TextEncoder().encode(code) };
      call.ran.printed.unshift(`Your code is the file /code/${n}.js.`);
      this.wrote(id, input);
      this.last(call, code);
    } else if (typeof path !== "string") call.ran.error = "run takes code, or the path of a file of your folder";
    else
      this.queue = this.queue.then(() => {
        if (!Object.hasOwn(this.folder, path)) return void (call.ran.error = `there is no file ${path}`);
        const saved = new TextDecoder().decode(this.folder[path].data);
        this.wrote(id, { code: saved });
        this.last(call, saved);
      });
    // the queue grows while it runs, when a file read in it sends its blocks, so it is waited for until it stops
    for (let queue; queue !== this.queue;) await (queue = this.queue);
    return call.ran;
  }

  /** Stops the worker at once: the block it is running and every block still to run fail with `why`. */
  stop(why = "the person stopped your turn"): void {
    this.stopped ??= why;
    this.caller.stop();
  }

  // Returns call `id`, made new the first time.
  private call(id: string): Call {
    const call = this.calls.get(id) ?? { sent: 0, blocks: 0, ran: { printed: [], peeks: [], views: [] } };
    this.calls.set(id, call);
    return call;
  }

  // Sends the code of a call after its last render() line, if there is any.
  private last(call: Call, code: string): void {
    const rest = code.slice(call.sent);
    call.sent = code.length;
    if (rest.trim()) this.send(call, rest);
  }

  // Runs one block of a call once the blocks before it have run, unless an earlier block of the call failed. The
  // ops a block made before it failed go on the page too.
  private send(call: Call, code: string): void {
    const ran = call.ran,
      block = ++call.blocks;
    this.queue = this.queue.then(async () => {
      if (ran.error) return;
      const answer = this.stopped
        ? undefined
        : await this.caller.ask({ code, block, sheet: this.sheet(), folder: this.folder, view: this.view });
      if (!answer) {
        // the worker was stopped, and the next block starts a new one, which holds nothing the blocks before declared
        const long = `a block ran longer than ${LIMIT / 1000} seconds and was stopped, and what your blocks declared so far is gone`;
        return void (ran.error = `${this.stopped ?? long}. ${SKIPPED}`);
      }
      this.view = answer.view;
      Object.assign(this.folder, answer.wrote);
      ran.printed.push(...answer.printed);
      ran.peeks.push(...answer.peeks);
      ran.views.push(...answer.views);
      const onPage = await this.applied(answer.ops),
        wrong = answer.error ?? onPage;
      if (wrong) ran.error = `${wrong} ${SKIPPED}`;
    });
  }
}
