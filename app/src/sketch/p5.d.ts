/** The little of p5 1.11's own interface that the sketch uses: an instance-mode sketch on a page element. */
declare module "p5" {
  export default class p5 {
    /** Starts a sketch: calls `sketch` with the new instance, which then draws on a canvas it puts in `node`. */
    constructor(sketch: (p: p5) => void, node?: unknown);
    setup?: () => void;
    drawingContext: { fillStyle: unknown; strokeStyle: unknown };
    [name: string]: unknown;
  }
}
