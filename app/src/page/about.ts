/**
 * The words about Nico that every new sheet opens with, written in the agent's handwriting as the agent's own ink, so
 * the agent can move, erase or redraw them as it can anything it drew. Each paragraph is a part, such as
 * "about.shortcut", and each link in it is a part inside that one, such as "about.shortcut.link", written in blue.
 * The words stand in a column in the middle of the view the page opens on, from side to side and, a little raised, from top to bottom,
 * as wide as fits it, and wrap to it.
 */
import HAND from "../../hand.json";
import { START } from "../paint/constants.ts";
import { apply } from "../paint/ops.ts";
import { Sheet, type Snapshot } from "../paint/sheet.ts";
import { OPEN } from "../canvas/state.ts";

/** A stretch of a paragraph's words: plain, or a link, whose ink is in the part `to` under the paragraph's. */
type Stretch = string | { text: string; to: string; href: string };

/** The paragraphs, from the top: each one's part, the height of its lines in page units, and its words. */
const PARAGRAPHS: { part: string; size: number; words: Stretch[] }[] = [
  { part: "about.name", size: 36, words: ["Nico Christie"] },
  {
    part: "about.contact",
    size: 22,
    words: [
      "San Francisco, CA · ",
      { text: "ndjpro@gmail.com", to: "email", href: "mailto:ndjpro@gmail.com" },
      " · ",
      { text: "X", to: "x", href: "https://x.com/nicochristie" },
      " · ",
      { text: "GitHub", to: "github", href: "https://github.com/nicodunks" },
    ],
  },
  {
    part: "about.shortcut",
    size: 22,
    words: [
      "I created ",
      { text: "Shortcut.ai", to: "link", href: "https://x.com/nicochristie/status/1940440489972649989" },
      " in early 2025 and played a small role in changing how people use Excel.",
    ],
  },
  {
    part: "about.dunks",
    size: 22,
    words: [
      "Before that, I ",
      { text: "dunked basketballs professionally", to: "video", href: "https://www.youtube.com/watch?v=res17FLLcPM" },
      " and somehow ",
      { text: "jumped higher than LeBron", to: "essay", href: "/how-i-learned-to-jump-higher-than-lebron-james.pdf" },
      ".",
    ],
  },
  {
    part: "about.offpolicy",
    size: 22,
    words: [
      "I'm now exploring new things at ",
      { text: "Off Policy", to: "link", href: "https://offpolicyinc.com/" },
      ".",
    ],
  },
  { part: "about.family", size: 22, words: ["Most importantly, I have two wonderful kids and a wife that is much cooler than me."] },
];

/** Where each link's ink leads, by its part: links.ts opens it when the person taps the ink. */
export const LINKS: Record<string, string> = Object.fromEntries(
  PARAGRAPHS.flatMap((p) => p.words.flatMap((w) => (typeof w === "string" ? [] : [[`${p.part}.${w.to}`, w.href]]))),
);

const COLUMN = 760; // the most page units the column is wide, with its margins
const MARGIN = 24; // the column's margin on each side, in page units
const LIFT = 0.07; // how far above the middle of the view the words stand, as a share of the view's height
const EM = 135; // the height of a line of handwriting in the units of hand.json, as hand.ts has it
const LETTERS = HAND as Record<string, { w: number }>;

/** Returns how many page units wide the handwriting writes `text` in a line `size` high. */
const wide = (text: string, size: number): number =>
  ([...text].reduce((sum, ch) => sum + (LETTERS[ch] ?? LETTERS[" "]).w, 0) * size) / EM;

/** Returns the sheet a new drawing opens with: the words about Nico, laid out for this window. */
export function about(): Snapshot {
  const sheet = new Sheet(),
    width = Math.min(COLUMN, OPEN) - 2 * MARGIN,
    left = START - width / 2;
  // every ink to write, with y counted from the top of the first line
  const inks: { x: number; y: number; width: number; height: number; text: string; part: string; color: string }[] = [];
  let y = 0;
  for (const p of PARAGRAPHS) {
    // each character with the part its ink goes in
    const letters = p.words.flatMap((w) =>
      [...(typeof w === "string" ? w : w.text)].map((ch) => ({
        ch,
        part: typeof w === "string" ? p.part : `${p.part}.${w.to}`,
      })),
    );
    // the lines: as many whole words as fit the column in each
    const lines: (typeof letters)[] = [[]];
    for (let i = 0; i < letters.length;) {
      let end = i;
      while (end < letters.length && letters[end].ch !== " ") end++;
      while (end < letters.length && letters[end].ch === " ") end++; // a word takes the spaces after it
      const word = letters.slice(i, end),
        line = lines[lines.length - 1],
        text = (l: typeof letters) => l.map((c) => c.ch).join("");
      if (line.length && wide(text([...line, ...word]).trimEnd(), p.size) > width) lines.push(word);
      else line.push(...word);
      i = end;
    }
    for (const line of lines) {
      // each stretch of the line that is in one part is one ink, written where the stretches before it end
      let x = left;
      for (let i = 0; i < line.length;) {
        let end = i;
        while (end < line.length && line[end].part === line[i].part) end++;
        const text = line
            .slice(i, end)
            .map((c) => c.ch)
            .join(""),
          box = { x, y, width: wide(text, p.size), height: p.size };
        if (text.trim())
          inks.push({ ...box, text, part: line[i].part, color: line[i].part === p.part ? "black" : "blue" });
        x += box.width;
        i = end;
      }
      y += p.size * 1.5;
    }
    y += p.size * 0.8;
  }
  // The words are in the middle of the view from side to side, and a little above its middle from top to bottom, by
  // LIFT of the view's height, where they look centred. A window that has no size yet, as a tab opened in the
  // background has, is taken to be 800 pixels tall.
  const tall = ((innerHeight || 800) * OPEN) / (innerWidth || OPEN),
    top = START - y / 2 - LIFT * tall;
  inks.forEach((ink, i) => apply(sheet, { fn: "write", id: i + 1, given: { ...ink, y: top + ink.y } }));
  return sheet.snapshot();
}
