/**
 * Calls OpenAI's models with a call in Anthropic's format. The page, the record and the charging all speak Anthropic's
 * Messages API, and OpenAI's Responses API does not. So this module turns the call's conversation and tool into a
 * request to the Responses API, and turns OpenAI's streamed events back into Anthropic's, which the gateway reads with
 * the SDK's MessageStream as it reads Claude's.
 *
 * A reasoning item of OpenAI's reply becomes a thinking block whose signature holds the item's id and encrypted
 * content, so that the next call of the turn gives the model back its own reasoning, as OpenAI asks of a model that
 * calls tools. Its thinking text is OpenAI's summary of the reasoning, or empty.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  MessageStreamEvent,
  ThinkingBlockParam,
  Tool,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";

const URL = "https://api.openai.com/v1/responses";

/** What the gateway asks of OpenAI, in Anthropic's terms, with `model` as OpenAI names it, such as gpt-6-luna. */
interface Call {
  model: string;
  system: string;
  tools: Tool[];
  messages: MessageParam[];
  effort: string; // one of EFFORTS, where "off" asks the model not to reason at all
  max_tokens: number;
  page: string; // the drawing, which keeps its calls on the same OpenAI servers so that they find its cached prompt
}

type Item = Record<string, unknown>;
// a block of a message, or of a tool's result
type Part = ContentBlockParam | Exclude<ToolResultBlockParam["content"], string | undefined>[number];

/** Returns one block of a tool's result or a person's message as OpenAI's input content. */
function part(b: Part): Item[] {
  if (b.type === "text") return [{ type: "input_text", text: b.text }];
  if (b.type === "image" && b.source.type === "base64")
    return [{ type: "input_image", image_url: `data:${b.source.media_type};base64,${b.source.data}` }];
  if (b.type === "image" && b.source.type === "url") return [{ type: "input_image", image_url: b.source.url }];
  return [];
}

/** Returns a thinking block as the reasoning item it was made from, or nothing if it was not made by OpenAI. */
function reasoning(b: ThinkingBlockParam): Item[] {
  try {
    const { id, encrypted_content } = JSON.parse(b.signature) as Item;
    if (typeof id === "string" && typeof encrypted_content === "string")
      return [{ type: "reasoning", id, encrypted_content, summary: [] }];
  } catch {
    // a thinking block of Claude's, which OpenAI cannot read
  }
  return [];
}

/** Returns the conversation as the Responses API's input items, in the same order. */
function input(messages: MessageParam[]): Item[] {
  const items: Item[] = [];
  for (const m of messages) {
    const blocks = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
    let words: Item[] = []; // the text and pictures since the last tool call or result, which make one message
    const said = () => {
      if (words.length) items.push({ role: m.role, content: words });
      words = [];
    };
    for (const b of blocks) {
      if (b.type === "text" && m.role === "assistant") words.push({ type: "output_text", text: b.text });
      else if (b.type === "text" || b.type === "image") words.push(...part(b));
      else if (b.type === "thinking") {
        said();
        items.push(...reasoning(b));
      } else if (b.type === "tool_use") {
        said();
        items.push({ type: "function_call", call_id: b.id, name: b.name, arguments: JSON.stringify(b.input) });
      } else if (b.type === "tool_result") {
        said();
        const content =
          typeof b.content === "string" ? [{ type: "text" as const, text: b.content }] : (b.content ?? []);
        items.push({ type: "function_call_output", call_id: b.tool_use_id, output: content.flatMap(part) });
      }
    }
    said();
  }
  return items;
}

/** Returns the body of a Responses API request for the call, streamed, with nothing kept at OpenAI. */
function request(call: Call): Item {
  return {
    model: call.model,
    instructions: call.system,
    input: input(call.messages),
    tools: call.tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
      strict: false,
    })),
    reasoning: { effort: call.effort === "off" ? "none" : call.effort, summary: "auto" },
    max_output_tokens: call.max_tokens,
    prompt_cache_key: call.page,
    include: ["reasoning.encrypted_content"],
    store: false,
    stream: true,
  };
}

/** Returns OpenAI's message for a refused call, from the body of its answer, which may not be JSON. */
function refusal(text: string): string {
  try {
    return (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
  } catch {
    return text;
  }
}

/**
 * Returns the reply to the call as a stream of Anthropic's events, one JSON object a line, as MessageStream reads
 * them, and `connected`, which settles once OpenAI has answered: it fails with OpenAI's status and message if OpenAI
 * refused the call. Aborting `signal` stops the call.
 */
export function respond(key: string, call: Call, signal: AbortSignal) {
  let answered: () => void, refused: (e: unknown) => void;
  const connected = new Promise<void>((y, n) => ([answered, refused] = [y, n]));
  const lines = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(out) {
      const send = (e: MessageStreamEvent) => out.enqueue(lines.encode(JSON.stringify(e) + "\n"));
      try {
        const res = await fetch(URL, {
          method: "POST",
          signal,
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify(request(call)),
        });
        if (!res.ok) {
          const message = refusal(await res.text());
          throw Anthropic.APIError.generate(res.status, { message }, message, res.headers);
        }
        answered();
        let index = -1, // the index of the open block, counted as Anthropic counts them
          open = "", // the OpenAI item the open block comes from
          called = false; // whether the reply called a tool
        const close = () => {
          if (open) send({ type: "content_block_stop", index });
          open = "";
        };
        for await (const e of events(res.body!)) {
          const item = e.item as Item | undefined;
          if (e.type === "response.created") {
            const r = e.response as Item;
            send({
              type: "message_start",
              message: {
                id: String(r.id),
                type: "message",
                role: "assistant",
                model: call.model,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: {
                  input_tokens: 0,
                  output_tokens: 0,
                  cache_read_input_tokens: 0,
                  cache_creation_input_tokens: 0,
                },
              } as never,
            });
          } else if (e.type === "response.output_item.added" && item?.type === "function_call") {
            close();
            called = true;
            open = String(item.id);
            send({
              type: "content_block_start",
              index: ++index,
              content_block: {
                type: "tool_use",
                id: String(item.call_id),
                name: String(item.name),
                input: {},
              } as never,
            });
          } else if (e.type === "response.function_call_arguments.delta") {
            send({
              type: "content_block_delta",
              index,
              delta: { type: "input_json_delta", partial_json: String(e.delta) },
            });
          } else if (e.type === "response.output_text.delta") {
            if (open !== e.item_id) {
              close();
              open = String(e.item_id);
              send({
                type: "content_block_start",
                index: ++index,
                content_block: { type: "text", text: "", citations: null },
              });
            }
            send({ type: "content_block_delta", index, delta: { type: "text_delta", text: String(e.delta) } });
          } else if (e.type === "response.output_item.done" && item?.type === "reasoning") {
            close();
            const summary = ((item.summary ?? []) as { text: string }[]).map((s) => s.text).join("\n\n");
            send({
              type: "content_block_start",
              index: ++index,
              content_block: { type: "thinking", thinking: "", signature: "" },
            });
            if (summary)
              send({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: summary } });
            const signature = JSON.stringify({ id: item.id, encrypted_content: item.encrypted_content });
            send({ type: "content_block_delta", index, delta: { type: "signature_delta", signature } });
            send({ type: "content_block_stop", index });
          } else if (e.type === "response.output_item.done") {
            if (open === item?.id) close();
          } else if (e.type === "response.completed" || e.type === "response.incomplete") {
            close();
            const r = e.response as {
              usage?: {
                input_tokens: number;
                output_tokens: number;
                input_tokens_details?: { cached_tokens?: number };
              };
              incomplete_details?: { reason?: string };
            };
            const read = r.usage?.input_tokens_details?.cached_tokens ?? 0;
            const cut = r.incomplete_details?.reason === "max_output_tokens";
            send({
              type: "message_delta",
              delta: { stop_reason: cut ? "max_tokens" : called ? "tool_use" : "end_turn", stop_sequence: null },
              usage: {
                input_tokens: (r.usage?.input_tokens ?? 0) - read,
                output_tokens: r.usage?.output_tokens ?? 0,
                cache_read_input_tokens: read,
                cache_creation_input_tokens: 0,
              },
            } as never);
            send({ type: "message_stop" });
          } else if (e.type === "response.failed" || e.type === "error") {
            const r = e.response as { error?: { message?: string } } | undefined;
            throw new Error(`OpenAI failed the call: ${r?.error?.message ?? JSON.stringify(e)}`);
          }
        }
        out.close();
      } catch (err) {
        refused(err);
        out.error(err);
      }
    },
  });
  connected.catch(() => {}); // a refusal is read through connected or the stream, whichever is read first
  return { body, connected };
}

/** Returns each event of a server-sent event stream as the JSON object of its data line. */
async function* events(body: ReadableStream<Uint8Array>): AsyncGenerator<Item & { type: string }> {
  const text = new TextDecoder();
  let rest = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    rest += text.decode(chunk, { stream: true });
    let end;
    while ((end = rest.indexOf("\n")) >= 0) {
      const line = rest.slice(0, end).trim();
      rest = rest.slice(end + 1);
      if (line.startsWith("data: ") && line !== "data: [DONE]") yield JSON.parse(line.slice(6));
    }
  }
}
