/** The website's own state for the open drawing: the conversation and the person's notes. */
import { Agent } from "./conversation.ts";

/** Returns a new drawing's name in the gateway's record: the time it was started and a few random letters. */
export const named = (): string =>
  `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 6)}`;

/** The drawing open now: its agent, which holds the conversation and the drawing's name in the gateway's record. */
export const drawing = { agent: new Agent(named()) };

/** Something the person said: their words, whether the agent has been given them, and whether the note shows them all. */
export interface Note {
  text: string;
  sent: boolean;
  open: boolean;
}

/** Everything the person said, in order, whether the microphone is listening, and the words in the box not yet sent. */
export const spoken = { notes: [] as Note[], listening: false, draft: "" };
