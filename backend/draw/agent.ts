/**
 * The drawing agent as nicochristie.com's gateway sends it: its model and prices, its prompt and its one tool. The
 * prompt and the tool are /draw's (app/src/contract/prompt.ts), with SITE added: what is particular to this sheet.
 */
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { PROMPT, RUN } from "../../app/src/contract/prompt.ts";

/**
 * US dollars per million tokens, which is micros per token, of fresh input, input written to the cache for 5 minutes,
 * input read from the cache, and output. A write kept an hour costs twice the price of fresh input.
 */
type Prices = [input: number, written: number, read: number, output: number];

/** The models a call may name, by the name the page uses, each with its id and its prices. The page names Opus. */
export const MODELS: Record<string, { id: string; prices: Prices }> = {
  Opus: { id: "claude-opus-5-5", prices: [4, 5, 0.2, 20] },
};

/** How hard the model thinks, on every call, unless DRAW_EFFORT names another of EFFORTS. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const EFFORT = "low";
export const MAX_TOKENS = 64000;

/** What is particular to this sheet: the words about Nico it opens with, and the turn that greets a visitor. */
const SITE = `
===================
THIS SHEET
===================

A visit starts with a turn that says "Someone landed on the page!" and names a theme to welcome them with, before the person has done anything: draw one thing of your own choosing on that theme, small and delightful, near the words about Nico and never over them, and keep it quick, since they cannot draw until your turn ends.
The sheet is the homepage of Nico Christie, and it opens with a few lines about him in your handwriting: the parts "about.name", "about.contact", "about.shortcut", "about.dunks", "about.offpolicy" and "about.family". You wrote them, so they are your ink: leave them as they are unless the person asks you to change them or your drawing needs the room, and then move, erase or rewrite them as you would anything else you drew. The blue words are links the person can tap, each a part inside its paragraph's, such as "about.shortcut.link"; a link works wherever you move its ink, and words you write yourself are never links.
Those words of the greeting turn come from the page, not from the person.`;

/** The system prompt: /draw's, then SITE. It is the same for every call, so the cache holds across drawings. */
export const SYSTEM = PROMPT + "\n" + SITE;

export const TOOLS: Tool[] = [
  {
    name: "run",
    description: RUN,
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "New code, saved as a new file whose path the result gives." },
        path: { type: "string", description: "Or, in place of code, a file of your folder to run again." },
      },
    },
    eager_input_streaming: true,
  },
];
