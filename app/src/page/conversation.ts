/**
 * The website's conversation with the model, through the gateway. It streams each reply, hands each call of run to
 * the model's environment on the canvas, and sends back the answers until the model's turn is over.
 */
import { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import type { ContentBlockParam, MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { Answer } from "../canvas/environment.ts";
import type { Ran, RunInput } from "../run/run.ts";

const TRIM_AT = 100_000; // once the conversation is this many tokens long, it keeps only its last KEEP turns
const KEEP = 5;
const STOPPED = "The person stopped your turn here.";
const CUT = "Your reply was cut off at the token limit, so this call's code may be unfinished.";
const DOING: Record<string, string> = {
  thinking: "thinking",
  run: "drawing",
};

/** The gateway refused the turn for a reason the person can fix; the message says what to do. */
export class Refused extends Error {}

/** What a turn needs from the page. */
interface Hooks {
  signal: AbortSignal; // aborts when the person presses Stop
  doing: (text: string) => void; // shows what the agent is busy with
  environment: Environment; // runs the model's calls of run
  model: string; // the name of the model the person chose, such as "Sol"
  effort?: string; // the effort an admin chose, such as "high"; left out, the gateway's default
  post: (path: string, body: unknown, signal: AbortSignal) => Promise<Response>; // a request to the gateway, as the person
  ran?: (r: Ran) => void; // told what each call of run gave back, once its code has run
}

/** The model's environment on the canvas, which runs its calls of run. */
interface Environment {
  wrote: (id: string, input: RunInput) => void;
  finish: (id: string, input: RunInput) => Promise<Ran>;
  answer: (r: Ran) => Promise<Answer>;
  stop: () => void;
}

export class Agent {
  /**
   * `page` is the page's name in the gateway's record. `history` is the conversation so far, `size` is how many tokens
   * it had at the last reply, and `model` is the name of the model that took the last turn; a new agent starts with
   * none of them, and a kept one is made again from all three.
   */
  constructor(
    readonly page: string,
    public history: MessageParam[] = [],
    public size = 0,
    public model?: string,
  ) {}

  /**
   * Gives the agent the person's turn, and carries out the agent's answer until its turn is over or the person stops
   * it. Throws with what went wrong if a request fails; the conversation keeps every message that arrived.
   */
  async turn(said: ContentBlockParam[], hooks: Hooks): Promise<void> {
    if (this.size > TRIM_AT) this.trim();
    if (hooks.model !== this.model) this.forgetThinking();
    this.model = hooks.model;
    this.answerLeft();
    this.history.push({ role: "user", content: said });
    let stream: MessageStream | undefined;
    const stop = () => {
      stream?.abort();
      hooks.environment.stop();
    };
    hooks.signal.addEventListener("abort", stop);
    try {
      while (!hooks.signal.aborted) {
        hooks.doing(DOING.thinking);
        const r = await hooks.post(
          "api/messages",
          { page: this.page, model: hooks.model, effort: hooks.effort, messages: this.history },
          hooks.signal,
        );
        if (r.status === 422) throw new Error("this page is out of date, so reload it");
        if (r.status === 402) throw new Refused(await r.text()); // no credits left
        if (!r.ok || !r.body) throw new Error((await r.text()) || `the server answered ${r.status}`);
        stream = MessageStream.fromReadableStream(r.body);
        const runs = new Map<string, Promise<Ran>>(); // what each call of run gave back, by the call's id
        const json = new Map<number, string>(); // the raw JSON of each call of run's input so far, by its index
        stream.on("streamEvent", (e, snapshot) => {
          if (e.type === "content_block_start") {
            const b = e.content_block;
            if (b.type === "thinking" || b.type === "tool_use")
              hooks.doing(DOING["name" in b ? b.name : b.type] ?? "working it out");
            if (b.type === "tool_use" && b.name === "run") json.set(e.index, "");
            return;
          }
          const b = "index" in e ? snapshot.content[e.index] : undefined;
          if (b?.type !== "tool_use") return;
          if (b.name !== "run") return;
          // the SDK shows a text of the input only once it is whole, so the code so far is read from the raw JSON
          if (e.type === "content_block_delta" && e.delta.type === "input_json_delta") {
            json.set(e.index, json.get(e.index) + e.delta.partial_json);
            hooks.environment.wrote(b.id, { code: codeSoFar(json.get(e.index)!) });
          } else if (e.type === "content_block_stop")
            runs.set(b.id, hooks.environment.finish(b.id, b.input as RunInput));
        });
        const reply = await stream.finalMessage().catch((err) => {
          if (hooks.signal.aborted) this.keep(stream!, json);
          throw err;
        });
        this.history.push({ role: "assistant", content: reply.content as ContentBlockParam[] });
        const used = reply.usage;
        this.size = used.input_tokens + (used.cache_read_input_tokens ?? 0) + (used.cache_creation_input_tokens ?? 0);
        const calls = reply.content.filter((b) => b.type === "tool_use");
        const cut = reply.stop_reason === "max_tokens";
        if (!calls.length || !(reply.stop_reason === "tool_use" || cut)) break;
        const results: ToolResultBlockParam[] = [];
        for (const call of calls) results.push(await answer(call.id, runs.get(call.id), hooks, cut));
        this.history.push({ role: "user", content: results });
      }
    } catch (err) {
      if (!hooks.signal.aborted) throw err;
    } finally {
      hooks.signal.removeEventListener("abort", stop);
      hooks.environment.stop();
    }
  }

  // Keeps what the person saw of a reply they stopped: its text, and its calls with their input as far as it was
  // written, which the next turn answers as stopped; a call of run keeps its code so far from `json`. Thinking is
  // left out, since a cut-off one is invalid.
  private keep(stream: MessageStream, json: Map<number, string>): void {
    const kept = (stream.currentMessage?.content ?? []).flatMap((b, i): ContentBlockParam[] => {
      if (b.type === "text" && b.text) return [{ type: "text", text: b.text }];
      if (b.type !== "tool_use") return [];
      const input = json.has(i) ? { ...(b.input ?? {}), code: codeSoFar(json.get(i)!) } : (b.input ?? {});
      return [{ type: "tool_use", id: b.id, name: b.name, input }];
    });
    if (kept.length) this.history.push({ role: "assistant", content: kept });
  }

  // Answers the calls of the conversation's last message, if it is the agent's and they were never answered because
  // the person stopped the turn: the Messages API needs an answer to every call.
  private answerLeft(): void {
    const last = this.history[this.history.length - 1];
    if (last?.role !== "assistant" || !Array.isArray(last.content)) return;
    const calls = last.content.filter((b) => b.type === "tool_use");
    if (calls.length)
      this.history.push({
        role: "user",
        content: calls.map((c) => ({ type: "tool_result", tool_use_id: c.id, content: STOPPED })),
      });
  }

  // Takes every thinking block out of the conversation's replies, when a turn goes to another model than the last one
  // did. One model cannot use another's thinking, and Claude refuses a conversation that holds thinking it did not
  // sign. The model is chosen as a turn starts, so the thinking of the turn under way is never taken out.
  private forgetThinking(): void {
    this.history = this.history.map((m) =>
      m.role === "assistant" && Array.isArray(m.content)
        ? { ...m, content: m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking") }
        : m,
    );
  }

  // Keeps the conversation from the person's KEEP-th last turn on: a turn starts with a message that has text in it.
  private trim(): void {
    const starts = this.history.flatMap((m, i) =>
      m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.type === "text") ? [i] : [],
    );
    if (starts.length > KEEP) this.history = this.history.slice(starts[starts.length - KEEP]);
  }
}

// Returns the code of a call of run as far as it has streamed: the value of "code" in the input's raw JSON so far,
// decoded, without an escape that is cut off at its end.
function codeSoFar(json: string): string {
  const start = /"code"\s*:\s*"/.exec(json);
  if (!start) return "";
  let raw = json.slice(start.index + start[0].length);
  const close = /(?<!\\)(?:\\\\)*"/.exec(raw); // the quote that ends the string, if it has come
  if (close) raw = raw.slice(0, close.index + close[0].length - 1);
  else raw = raw.replace(/(?<!\\)((?:\\\\)*)\\(u[0-9a-fA-F]{0,3})?$/, "$1"); // an escape cut off at the end
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return "";
  }
}

// Returns the answer to one call of run as the Messages API takes it: what it printed and its error, then the
// pictures of the page it asked for, taken once all its code has run, and the pictures in its folder it asked to see.
// `cut` says the reply was cut off at the token limit.
async function answer(
  id: string,
  ran: Promise<Ran> | undefined,
  hooks: Hooks,
  cut: boolean,
): Promise<ToolResultBlockParam> {
  if (!ran) return { type: "tool_result", tool_use_id: id, content: "Malformed input: nothing done.", is_error: true };
  const r = await ran;
  hooks.ran?.(r);
  if (hooks.signal.aborted) return { type: "tool_result", tool_use_id: id, content: STOPPED };
  const a = await hooks.environment.answer(r);
  const lines = [...(cut ? [CUT] : []), ...a.lines];
  const pictures = a.pictures.map((b) =>
    b.type === "text"
      ? b
      : {
          type: "image" as const,
          source: { type: "base64" as const, media_type: "image/jpeg" as const, data: b.jpeg },
        },
  );
  return {
    type: "tool_result",
    tool_use_id: id,
    content: [{ type: "text", text: lines.join("\n") || "Done." }, ...pictures],
    is_error: Boolean(a.error),
  };
}
