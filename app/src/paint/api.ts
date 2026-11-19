/**
 * The functions your code calls besides p5's. Your code is p5.js 1.11 in global mode, run on the page itself, and
 * these functions are globals beside p5's: fill("green"); noStroke(); ellipse(300, 200, 100, 60); part("sun");
 *
 * How the page differs from a p5 sketch:
 * - The page is the canvas. There is no setup(), draw() or createCanvas(): your code runs once, top to bottom, and
 *   what it draws stays on the page. To make something move, use animate().
 * - Positions and sizes are page units: (0, 0) is the top left of the page, and x grows right and y down without
 *   limit. A drawing opens with (2500, 2500) in the middle of the person's view. width and height are the size of the
 *   person's view, and view() says where it is.
 * - Settings carry over as in p5: fill, stroke, strokeWeight, colorMode, part and hand hold until you change them, and
 *   push() and pop() keep them. Each block starts with no translate, rotate or scale, as each draw() does.
 * - A turn starts with stroke in the page's black and strokeWeight 3, as the pen draws, and fill white, as p5's.
 * - The page's colours by name, such as fill("sky"), are the page's own colours; any other colour works as in p5.
 * - background() colours the paper, behind all ink, the person's too. It covers nothing.
 * - p5's functions for pixels, text, the DOM, loading files, the mouse and the keyboard are not here. Write text
 *   with write(), lay a picture from the folder on the page with image(), and inspect one with pixels(). image(),
 *   erase(), copy() and print() are the page's own, below.
 *
 * Numbers. Every position and size must be finite and within 100000 of 0. p5's angles are radians, unless you call
 * angleMode(DEGREES); a pose's rotate is in degrees, as CSS has it. Times are seconds. opacity runs from 0, unseen,
 * to 1, solid, which it is if left out.
 *
 * Blocks. Code you give runs while you write it, cut into blocks at each line that ends with render();. Blocks are
 * counted from 1 in each call. A block's top-level names carry over to later blocks and calls of this turn, and may be
 * declared again. A block may use await at its top level, which asynchronous functions such as pixels need. There are no
 * timers. A function given something malformed throws an Error that says what is wrong; the rest of the call does not
 * run, and what the block drew before the error stays.
 */

// ### Drawing
// p5's functions draw. What one call draws is one ink, and the call returns its id. A part names ink so that it moves
// and animates as one. A dot nests parts: "tree.leaf3" is inside "tree", so whatever moves "tree" moves it too.
// New ink covers old ink, as in p5. This holds for the person's ink too.
// copy() puts its copies on top. move() and setPart() do not change what covers what.
// ink() lists ink from the bottom to the top. Ink drawn in a frame function covers all other ink.

/**
 * Puts all that is drawn from here on in part `name`, or in no part if it is left out.
 * Example: part("tree.trunk"); rect(100, 300, 20, 80); part("tree.leaves"); circle(110, 280, 90); part();
 */
export declare function part(name?: string): void;
/**
 * Sets how much what is drawn from here on wavers, as a hand's drawing does, from 0 to 3. At 1, where a turn starts,
 * lines drift a little, a circle runs on past where it began, and a fill is coloured in with strokes that run past
 * its outline. At 0, shapes are exact, for a diagram that must be exact. Example: hand(0); line(0, 0, 100, 0); hand(1);
 */
export declare function hand(amount: number): void;
/**
 * One line of handwriting in the stroke colour, as large as fits the box and centred in it: a box 22 high for
 * writing, 32 for a title. It does not turn or scale with p5's transforms. LaTeX without $ works: x^2, z_i,
 * \frac{a}{b} (in a box 1.5 times as high), \sqrt{x}, Greek letters and the common maths symbols. The handwriting has
 * plain letters, digits and the common punctuation; any other character, such as é or an emoji, leaves a gap, so
 * draw it.
 * Example: stroke("red"); write({x: 100, y: 50, width: 300, height: 33, text: "y = \\frac{1}{2}x^2"});
 */
export declare function write(o: Box & { text: string }): number;
/**
 * Lays the picture at path in your folder on the page as one ink in the part of the moment, with its top left at
 * (x, y), `width` wide and `height` tall, or as tall as the picture's shape makes it if height is left out. It is
 * shrunk to at most 1568 pixels on its longest side. It moves, copies, stacks, animates and is erased as other ink is.
 * colorAt() does not see it. Example: await image({path: "/pictures/fox.png", x: 100, y: 100, width: 400});
 */
export declare function image(o: {
  path: string;
  x: number;
  y: number;
  width: number;
  height?: number;
  opacity?: number;
}): Promise<number>;

// ### The page
// Read what is on the page, and change ink already drawn.

/** The person's view. Example: const v = view(); circle(v.x + v.width / 2, v.y + v.height / 2, 50); */
export declare function view(): Box;
/**
 * Moves the person's view to left edge x and top edge y, width from 80 to 10000 wide.
 * Example: show({x: 0, y: 600, width: 800});
 */
export declare function show(o: { x: number; y: number; width: number }): void;
/**
 * The ink at least partly inside the box, or all ink.
 * Example: const theirs = ink().filter((i) => i.by === "person");
 */
export declare function ink(within?: Box): Ink[];
/**
 * The nearest page colour at (x, y): "white" where there is no ink.
 * Example: if (colorAt(200, 150) === "white") fill("sky");
 */
export declare function colorAt(x: number, y: number): Color;
/**
 * Asks for a picture, which comes with your call's result: of the page after your code from y down, or of the
 * person's view if y is left out, with the animations as they show t seconds after they all start; or of the picture
 * at path in your folder.
 * Example: look(); or look({y: 400}); or look({t: 2}); or look({path: "/pictures/fox.png"});
 */
export declare function look(o?: { y?: number; t?: number } | { path: string }): void;
/**
 * Rubs out everything inside the box, the person's ink too, or takes `ink` off the page whole.
 * Example: erase({x: 100, y: 100, width: 50, height: 50}); or erase({ink: "tree.leaves"}); or erase({ink: 7});
 */
export declare function erase(o: Box | { ink: Which }): void;
/**
 * Moves ink for good into pose `to`, which cannot hold opacity, gliding for seconds (0 if left out, 10 at most).
 * Example: move({ink: "sun", to: {dx: -200, dy: 50}, seconds: 2});
 */
export declare function move(o: { ink: Which; to: Pose; seconds?: number }): void;
/**
 * Copies ink, shifted, into `part` if given. A copied part keeps its inner parts: "tree.leaf3" to "tree2.leaf3".
 * Example: copy({ink: "tree", dx: 200, dy: 0, part: "tree2"});
 */
export declare function copy(o: { ink: Which; dx: number; dy: number; part?: string }): number;
/**
 * Puts ink in `part`, in place of its part. Given one part's name as ink, renames it and the parts inside it.
 * Example: const roof = triangle(100, 200, 200, 120, 300, 200); setPart({ink: roof, part: "house.roof"});
 */
export declare function setPart(o: { ink: Which; part: string }): void;
/**
 * Moves ink up or down the stack: to the front, over all ink, or to the back, under all ink; or just above or just
 * below other ink. The ink keeps its own order, and the person's ink counts as any other.
 * Example: part("sky"); fill("sky"); rect(0, 0, 2000, 900); arrange({ink: "sky", below: "house"});
 * or arrange({ink: "sun", to: "front"}); or arrange({ink: 12, above: "tree"});
 */
export declare function arrange(
  o: { ink: Which; to: "front" | "back" } | { ink: Which; above: Which } | { ink: Which; below: Which },
): void;
/** Prints to your call's result: text as it is, anything else as JSON. Example: print("trees:", ink().length); */
export declare function print(...values: unknown[]): void;
/**
 * Ends a block, and the person sees what the block drew. Write it as a line of its own at the top level, never inside
 * a loop or a function. Example, two blocks, the sky shown before the grass is written:
 *   fill("sky"); noStroke(); rect(0, 0, 800, 300);
 *   render();
 *   fill("green"); rect(0, 300, 800, 100);
 *   render();
 */
export declare function render(): void;

// ### Animation
// An animation moves parts for as long as it runs, and never changes ink: ink() and look() show it where it was drawn.

/**
 * Makes animation `name`, with a sticker, `sticker` or ✨, by the parts it moves. The page's animations share one clock,
 * which starts when the drawing opens and again whenever you make an animation. Each animation starts `at` seconds
 * in, or at 0 if `at` is left out.
 * - With `seconds`, it runs that long and then holds its last pose, so end it where its parts should stay. When the
 *   last of these animations is over, they all start again.
 * - Without `seconds`, it runs on and never starts again, as a background does.
 * A sequence is at: 0, seconds: 2, then at: 2, seconds: 3, and things that happen together share an `at`. To change a
 * sequence, change these numbers with retime(). When two animations pose the same part, the later one moves it on
 * from where the earlier one left it. A name already used replaces that animation. The person taps a sticker to stop
 * or start its animation. To see a moment, call look({t}).
 *
 * frame(t, data) draws the animation at t, about 60 times a second: pose() holds parts in poses, and p5's drawing
 * functions and write() add ink for this one picture, such as rain or a counting number, which moves with its part
 * if part() gave it one. Each picture starts with p5's settings as a turn starts them, and with no part. frame runs
 * apart from your code: write it as an arrow function that uses only t, data, p5's functions, part, hand, write and
 * pose, JavaScript's own such as Math, and what it declares itself. Pass what it needs in data, and make random
 * numbers in your code, since one t must always give one picture. For motion that repeats, use Math.sin(t); for
 * motion that ends and stays, k = Math.min(1, t / 3).
 *
 * If frame fails or poses a part with no ink, your call's result says so and the animation is not made. If it fails
 * later, it stops, and you are told next turn.
 * Example, the bird flies to the tree in the first 3 seconds and stays there, and then the cat looks up:
 *   animate({name: "the bird flies to the tree", sticker: "🐦", at: 0, seconds: 3,
 *     frame: (t) => pose("bird", {dx: 300 * t / 3})});
 *   animate({name: "the cat looks up", sticker: "🐱", at: 3, seconds: 1,
 *     frame: (t) => pose("cat.head", {rotate: -20 * t})});
 * Example, a tree that sways, with twelve leaves that flutter out of step:
 *   animate({name: "the tree sways", sticker: "🌳", data: {leaves: 12}, frame: (t, data) => {
 *     pose("tree", {rotate: 3 * Math.sin(1.5 * t), origin: "bottom"});
 *     for (let i = 0; i < data.leaves; i++) pose("tree.leaf" + i, {rotate: 12 * Math.sin(6 * t + i)});
 *   }});
 */
export declare function animate<Data>(o: {
  name: string;
  frame: (t: number, data: Data) => void;
  data?: Data;
  at?: number;
  seconds?: number;
  sticker?: string;
}): void;
/**
 * Changes when an animation starts, how long it runs, or both, without making it again.
 * Example: retime({name: "the cat looks up", at: 0}); retime({name: "the bird flies to the tree", at: 1});
 */
export declare function retime(o: { name: string; at?: number; seconds?: number }): void;
/** Takes the animation and its sticker off the page. Example: removeAnimation("the tree sways"); */
export declare function removeAnimation(name: string): void;
/**
 * Only in a frame function: holds a part, and the parts inside it, in a pose for this picture. An inner part's pose
 * applies first. Example: pose("bird", {dy: 10 * Math.sin(3 * t), rotate: 5});
 */
export declare function pose(part: string, how: Pose): void;

// ### Your folder
// Your folder holds files by path, such as "/code/1.js" or "/pictures/fox.png": your code, what your code wrote or
// downloaded, and any files copied in for you. A path starts with "/". Only you see the folder, and it lasts while the page is open.

/** The files under dir, or all of them. Example: for (const f of ls("/pictures")) print(f.path, f.size); */
export declare function ls(dir?: string): FileInfo[];
/** The file's text. Example: const notes = readFile("/notes.txt"); */
export declare function readFile(path: string): string;
/** Writes text, or anything else as JSON. Example: writeFile("/notes.json", {trees: 3}); */
export declare function writeFile(path: string, value: unknown): FileInfo;
/**
 * Replaces old, which must be in the file exactly once, with replacement. An empty replacement deletes old.
 * Example: edit("/code/1.js", 'fill("sky blue")', 'fill("sky")');
 */
export declare function edit(path: string, old: string, replacement: string): FileInfo;
/**
 * A picture's pixels, shrunk to at most 1568 on its longest side: red, green, blue and alpha from 0 to 255, row by
 * row from the top left, so pixel (i, j) starts at data[4 * (j * width + i)].
 * Example: const p = await pixels("/pictures/fox.png"); print(p.width, p.height, p.data[0]);
 */
export declare function pixels(path: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;

// ### The web

/**
 * Searches the web or its images with the Brave Search API, and returns Brave's JSON as it is.
 * Example: (await braveSearch("images", {q: "Mona Lisa"})).results[0].properties.url
 */
export declare function braveSearch(endpoint: "web", params: BraveParams): Promise<BraveWebSearch>;
export declare function braveSearch(endpoint: "images", params: BraveParams): Promise<BraveImageSearch>;
/**
 * Saves the file at url, at most 10 MB, at path in your folder.
 * Example: const found = await braveSearch("images", {q: "whale"});
 *   await download(found.results[0].properties.url, "/whale.jpg"); look({path: "/whale.jpg"});
 */
export declare function download(url: string, path: string): Promise<FileInfo>;

// ### Types

/** A page colour by name, or any colour as "#rrggbb". */
export type Color = Named | `#${string}`;

/** The page's colours, which are also the person's pen colours. */
export type Named =
  | "black"
  | "gray"
  | "brown"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "teal"
  | "sky"
  | "blue"
  | "purple"
  | "pink"
  | "white";

export type Point = [number, number];

/** x and y are the left and top edges, and width and height are above 0. */
export type Box = { x: number; y: number; width: number; height: number };

/** One thing on the page, as ink() gives it: what one call, or one stroke of the person's pen, made. */
export type Ink = {
  id: number;
  part?: string;
  by: "person" | "you";
  /** The function that made it, such as "ellipse", "endShape" or "write", or "pen" for a stroke of the person's pen. */
  made: string;
  text?: string; // what write wrote
  color?: Color; // of its lines
  fill?: Color;
  opacity?: number; // only if it is see-through
  box: Box; // around what is left of it
  points?: Point[][]; // for pen: what is left of it, simplified, in pieces
};

/** The ink to work on: an id, a part's name, meaning all ink in it and the parts inside it, an Ink, or a list. */
type Which = number | string | Ink | (number | string | Ink)[];

/**
 * A pose, as a CSS transform: scale, scaleX, scaleY and rotate, in degrees clockwise, about origin, then a shift by dx
 * and dy. origin is the middle of the ink's box, the middle of one of its edges, or a point; "center" if left out.
 * Scaling thickens lines.
 */
export type Pose = {
  dx?: number;
  dy?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotate?: number;
  origin?: "center" | "top" | "bottom" | "left" | "right" | Point;
  opacity?: number;
};

/** type is a media type, such as "image/jpeg", and size is in bytes. */
export type FileInfo = { path: string; type: string; size: number };

/** q, at most 400 characters, and any other query parameter Brave takes, such as count. */
type BraveParams = { q: string } & Record<string, string | number | boolean>;

type BraveWebSearch = { web?: { results: { title: string; url: string; description?: string }[] } };

/** properties.url is the image, thumbnail.src a small copy of it, and url the page it is on. */
type BraveImageSearch = {
  results: { title?: string; url?: string; thumbnail?: { src: string }; properties?: { url: string } }[];
};
