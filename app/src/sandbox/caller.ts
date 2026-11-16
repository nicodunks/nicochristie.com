/**
 * The page's end of a worker that runs code the agent wrote. The page asks the worker one message at a time, and
 * each ask waits for the worker's one reply. Code in a worker can be stopped only by stopping the whole worker, so a
 * worker that takes longer than the limit to reply is stopped, and the next ask starts a new one.
 *
 * While it works on an ask, the worker may ask the page for something it cannot do itself, as {need, id}. The page
 * does it with `serve` and answers with {got: id, value} or {got: id, error}. The time the page takes over a need
 * does not count against the limit.
 */
export class Caller<Ask, Reply> {
  private worker?: Worker;
  private queue: Promise<unknown> = Promise.resolve();
  private drop?: () => void; // settles the ask the worker is working on with no reply

  /**
   * `script` is the URL of the worker's script, `limit` is how long the worker may work on one ask, in milliseconds,
   * and `serve` does what the worker needs from the page.
   */
  constructor(
    private script: string,
    private limit: number,
    private serve?: (need: unknown) => Promise<unknown>,
  ) {}

  /**
   * Sends `message` once the asks before it are answered. Resolves with the worker's reply, or with undefined if the
   * worker was stopped before it replied.
   */
  ask(message: Ask): Promise<Reply | undefined> {
    const reply = this.queue.then(
      () =>
        new Promise<Reply | undefined>((done) => {
          const worker = (this.worker ??= new Worker(this.script));
          let timer = setTimeout(() => this.stop(), this.limit);
          const settle = (r?: Reply) => {
            clearTimeout(timer);
            this.drop = undefined;
            done(r);
          };
          this.drop = settle;
          worker.onmessage = async ({ data }) => {
            if (!(data && typeof data === "object" && "need" in data)) return settle(data);
            clearTimeout(timer);
            const { need, id } = data as { need: unknown; id: number };
            const got = await (this.serve ?? (() => Promise.reject(new Error("nothing here can do that"))))(need).then(
              (value) => ({ got: id, value }),
              (e: unknown) => ({ got: id, error: e instanceof Error ? e.message : String(e) }),
            );
            if (this.worker !== worker || this.drop !== settle) return; // the worker was stopped while the page worked
            timer = setTimeout(() => this.stop(), this.limit);
            worker.postMessage(got);
          };
          worker.postMessage(message);
        }),
    );
    this.queue = reply;
    return reply;
  }

  /** Stops the worker at once, with everything it holds. The ask it is working on resolves with undefined. */
  stop(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.drop?.();
  }
}
