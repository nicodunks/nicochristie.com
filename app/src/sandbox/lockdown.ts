/**
 * Shuts a Web Worker in, so that code the agent wrote can run in it. A worker cannot touch the page to begin with.
 * shut() also takes away the worker's ways to reach anything else, and a worker calls it once its own setup is done
 * and before any of the agent's code runs. This module keeps four things for the worker's own use: `answer`, which
 * sends a message to the page, `run` and `value`, which run source text, and `expose`, which gives the agent's code
 * its functions.
 *
 * Each name is deleted from the scope and from every prototype it inherits from, so the code cannot call it by
 * another path, such as WorkerGlobalScope.prototype.fetch. The timers go too, so all of a piece of code runs before
 * the worker answers for it.
 */
export const answer = self.postMessage.bind(self);
const load = self.importScripts.bind(self);

const TAKEN = [
  "importScripts",
  "postMessage",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Worker",
  "SharedWorker",
  "BroadcastChannel",
  "indexedDB",
  "caches",
  "setTimeout",
  "setInterval",
  "queueMicrotask",
  "requestAnimationFrame",
];

/** Takes away the worker's ways to reach anything outside it, and its timers. */
export function shut(): void {
  for (let o: object | null = self; o; o = Object.getPrototypeOf(o))
    for (const name of TAKEN) if (Object.hasOwn(o, name)) delete (o as Record<string, unknown>)[name];
}

/**
 * Runs JavaScript source text as a script of its own, so that what it declares at its top level stays declared for
 * the scripts run after it. Throws what the script throws, and a SyntaxError if the text is not a script.
 */
export function run(source: string): void {
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    load(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Returns the value of JavaScript source text that is one expression. Throws as run() does. */
export function value(source: string): unknown {
  const scope = self as unknown as { value?: unknown };
  run(`self.value = (${source}\n);`);
  const made = scope.value;
  delete scope.value;
  return made;
}

/**
 * Gives the code that runs in the worker each property of the sources as a global of its name: its value, or what
 * its getter gives each time it is read. Where two sources have a name, the later one's is given. The code cannot
 * give such a global another value: a block that says `line = 3`, or declares `var line = 3` at its top level, stops
 * there with an Error that says the name is taken. Call it once.
 */
export function expose(...sources: object[]): void {
  const names: PropertyDescriptorMap = Object.assign({}, ...sources.map((s) => Object.getOwnPropertyDescriptors(s)));
  for (const [name, d] of Object.entries(names))
    Object.defineProperty(self, name, {
      get: d.get ?? (() => d.value),
      set: () => {
        throw new Error(`${name} is one of the page's names, so give your own value another name`);
      },
      configurable: false,
      enumerable: true,
    });
}
