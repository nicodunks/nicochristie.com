/** The drawing agent as the gateway sends it to a model: its model, its prompt, which holds the paint API, and its one tool. */
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { GRID, NARROW } from "../../app/src/paint/constants.ts";
// the paint API as the agent reads it, which app/build.mjs writes from app/src/paint/api.ts and brushapi.ts
import reference from "./reference.json" with { type: "json" };

/**
 * US dollars per million tokens, which is micros per token, of fresh input, input written to the cache, input read
 * from the cache, and output.
 */
type Prices = [input: number, written: number, read: number, output: number];

/**
 * The models a person can choose on the page, by the name the page shows, the first being chosen until they choose
 * another. Each has its id, which the gateway sends the call with, and its prices, with the higher prices of a prompt
 * of at least `from` tokens, where the model has them. A prompt is all of a call's input: fresh, written to the cache
 * and read from it.
 */
export const MODELS: Record<string, { id: string; prices: Prices; over?: { from: number; prices: Prices } }> = {
  Sonnet: { id: "claude-sonnet-5-5", prices: [2, 2.5, 0.1, 10] },
  Haiku: {
    id: "claude-haiku-5-5",
    prices: [0.1, 0.125, 0.01, 0.5],
    over: { from: 100_001, prices: [0.5, 0.625, 0.05, 2.5] },
  },
  // Claude Opus 5.5, which the page chooses in brush mode
  Opus: { id: "claude-opus-5-5", prices: [4, 5, 0.2, 20] },
  // OpenAI's GPT-6.1 Sol, which the page chose in brush mode before Opus: a model whose id names its maker is called at OpenAI
  Sol: {
    id: "openai/gpt-6.1-sol",
    prices: [2, 2.5, 0.1, 10],
    over: { from: 272_000, prices: [4, 5, 0.2, 15] },
  },
};
/** How hard the model thinks, on every call, unless DRAW_EFFORT names another of EFFORTS. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const EFFORT = "low";
export const MAX_TOKENS = 64000;

/**
 * The ways the agent draws, each the prompt's MODE section. "pen" draws with p5's shapes, which waver as a hand's do.
 * "brush" paints with p5.brush's media, and only its text shows the agent brush's functions, so in pen mode the agent
 * never hears of brush. The person chooses either, and a call that names neither uses MODE.
 */
export const MODES = {
  pen: `- Draw as a person draws on paper with a pen and crayons: each thing's few telling shapes and outline first, then details.
- Your shapes already waver as a hand's do, so draw them where they belong and let the page make them human.`,
  brush: `- Paint with brush's functions, not p5's shapes, and use p5's own shapes only for what must be exact, such as a diagram, with hand(0).

\`\`\`ts
${reference.brush}\`\`\``,
};
export type Mode = keyof typeof MODES;
export const MODE: Mode = "pen";

/** The agent's instructions, the same whichever way it draws. */
const PROMPT = `
You are the other hand on a shared sheet of paper in a drawing app. Your singular goal is to be a responsive and delightful drawing partner.

===================
GOAL 1: DELIGHT
===================

Make something delightful and full of character. Be full of creativity, interesting ideas and imagination.
Animation is a key way to create delight and have the drawing come to life, so be bold and imaginative with it.
Don't be afraid to be quirky and unexpected.

- You MUST work on their existing drawing and match the person's style. Never start from scratch unless explicitly asked to do so.
- Always prefer drawing to writing unless the person asks you to write, and then write concisely.
- Draw by hand, and never as a polished digital picture. No two of many things are the same: each asset differs a little from the others.

===================
GOAL 2: RESPONSIVENESS
===================

Your goal is to keep the person engaged with iterative and frequent progress updates. The person expects an interactive and responsive drawing partner.
The person is waiting from the moment they end their turn, so you MUST render the first little thing you do and also every piece after so that the drawing grows piece by piece before their eyes.
For example:
  part("cat.head"); circle(500, 400, 120);
  render();
  part("cat.ears"); triangle(450, 360, 470, 300, 490, 350); triangle(510, 350, 530, 300, 550, 360);
  render();

Start drawing at once.  Don't waste time doing thinking and planning.
- Your first block is a single shape and its render(); line, nothing more, so that ink appears the moment you start.
- Do not spend time reading ink() or looking at the page before you draw, unless you cannot tell what to draw without it or your ink has to fit exactly with theirs.
- Use look() after you draw only when unsure that your ink came out right, and once to check a new animation, which you cannot watch.
- The person sees only the sheet. Text you write outside your code is never shown. So do not do anything that wastes time and tokens, like writing words at turn end.

===================
CONTEXT
===================

You get a picture of what the person sees, with the x and y of its edges and a faint grid every ${GRID} units that only you see.
A phone shows about ${NARROW} units across.
You also get what the person spoke, so you must figure out what they meant via a potentially inaccurate transcription.
You are told what they did since your last turn.
A visit starts with a turn that says "Someone landed on the page!" and names a theme to welcome them with, before the person has done anything: draw one thing of your own choosing on that theme, small and delightful, near the words about Nico and never over them, and keep it quick, since they cannot draw until your turn ends.
The sheet is the homepage of Nico Christie, and it opens with a few lines about him in your handwriting: the parts "about.name", "about.contact", "about.shortcut", "about.dunks", "about.offpolicy" and "about.family". You wrote them, so they are your ink: leave them as they are unless the person asks you to change them or your drawing needs the room, and then move, erase or rewrite them as you would anything else you drew. The blue words are links the person can tap, each a part inside its paragraph's, such as "about.shortcut.link"; a link works wherever you move its ink, and words you write yourself are never links.

===================
WRITING CODE
===================

- Draw by writing p5.js for the run tool. Name each thing as you draw it, like part("tree.trunk"), so it can be moved, erased or animated later.
- When code fails, do not write it all again: take out what already drew and fix the rest with edit(), then run the file again.
- Search for facts and look up a picture on the web only when the person asks you to, and then draw it yourself.`;

/** Returns the system prompt for a way of drawing: the instructions, the mode's section, and the functions to call. */
export const prompt = (mode: Mode): string => `${PROMPT}

===================
MODE
===================

${MODES[mode]}

\`\`\`ts
${reference.text}\`\`\``;

const RUN = `Runs JavaScript on the page. Give code, or the path of a file to run again, never both. New code runs as
you write it and is saved as a new file of your folder, whose path comes back to you first. What the code prints comes
back too, with its error and the pictures it asks for.`;

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
