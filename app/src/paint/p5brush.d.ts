/** The little of p5.brush 3's standalone build that the page uses: it paints on a WebGL2 canvas without p5. */
declare module "p5.brush/standalone" {
  export function load(target: OffscreenCanvas): void;
  export function clear(color?: string): void;
  export function render(): void;
  export function push(): void;
  export function pop(): void;
  export function translate(x: number, y: number): void;
  export function scale(x: number, y: number): void;
  export function seed(n: number): void;
  export function noiseSeed(n: number): void;
  export function add(name: string, params: object): void;
  export function set(brush: string, color: string, weight: number): void;
  export function noStroke(): void;
  export function fill(color: string, opacity: number): void;
  export function noFill(): void;
  export function wash(color: string, opacity: number): void;
  export function noWash(): void;
  export function fillBleed(strength: number, direction: "out" | "in"): void;
  export function fillTexture(texture: number, border: number): void;
  export function hatch(
    distance: number,
    angle: number,
    options: { rand: number | false; gradient: number | false; continuous: boolean },
  ): void;
  export function hatchStyle(brush: string, color: string, weight: number): void;
  export function noHatch(): void;
  export function mass(
    brush: string,
    color: string,
    options: { precision: number; strength: number; gradient: number; style: "arcs" | "scribble" },
  ): void;
  export function noMass(): void;
  export function polygon(points: [number, number][]): void;
  export function spline(points: [number, number][], curvature: number): void;
}
