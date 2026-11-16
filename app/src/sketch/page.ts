/**
 * A pretend web page inside a Web Worker, just enough for p5 to start. p5 expects a page: it reads `window` and
 * `document`, waits for the page to load, and makes a <canvas> element to draw on. A worker has none of these, so
 * this module makes them before p5 is loaded: a document that has loaded, elements that do nothing, and canvases whose
 * 2D context records shapes. Every shape a canvas records goes to the sink that `drawTo` set last.
 *
 * It must be imported before p5, since p5 reads the page as it loads.
 */
import { RecordedPath, Recorder, type Shape } from "./canvas.ts";

let sink: (shape: Shape) => void = () => undefined;

/** Has every shape the canvases record go to `to`. */
export function drawTo(to: (shape: Shape) => void): void {
  sink = to;
}

/** The one recording context, made when p5 first asks its canvas for a 2D context. */
let context: Recorder | undefined;

/** Returns a page element that does nothing, or a canvas whose 2D context is the recorder. */
function element(tag: string): Record<string, unknown> {
  const el: Record<string, unknown> = {
    tagName: tag.toUpperCase(),
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    width: 100,
    height: 100,
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    appendChild: (child: unknown) => child,
    removeChild: (child: unknown) => child,
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, x: 0, y: 0, width: 100, height: 100 }),
  };
  if (el.tagName === "CANVAS")
    el.getContext = (kind: string) => {
      if (kind !== "2d") return null; // so p5 cannot start WEBGL
      // a second canvas is for an image or a buffer of pixels, which the page does not keep
      if (context && context.canvas !== el)
        throw new Error("makes a picture of pixels, which the page does not keep: draw on the page directly");
      return (context ??= new Recorder(el, (shape) => sink(shape)));
    };
  return el;
}

const scope = self as unknown as Record<string, unknown>;
Object.assign(scope, {
  window: self,
  document: {
    readyState: "complete",
    body: element("body"),
    documentElement: element("html"),
    createElement: element,
    createElementNS: (_: string, tag: string) => element(tag),
    getElementById: () => null,
    getElementsByTagName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    hasFocus: () => false,
  },
  screen: { width: 1000, height: 1000 },
  innerWidth: 1000,
  innerHeight: 1000,
  devicePixelRatio: 1,
  Path2D: RecordedPath,
  matchMedia: () => ({ matches: false, addListener() {}, removeListener() {} }),
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
  // p5 carries a helper that sets this global as it loads. In strict code that fails unless the global exists, and
  // the helper then falls back to evaluating a string, which the workers' Content-Security-Policy forbids.
  regeneratorRuntime: undefined,
});
for (const name of ["HTMLCanvasElement", "HTMLElement", "HTMLImageElement", "HTMLVideoElement"])
  scope[name] ??= class {};
