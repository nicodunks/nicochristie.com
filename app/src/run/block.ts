/**
 * Turns one block of the agent's code into the script the run worker runs. The blocks of a turn run one after the
 * other, and a block can use what the blocks before it declared, so each name a block declares at its top level must
 * become a global of the worker. A block may also declare a name that an earlier block declared, which JavaScript
 * refuses for `let`, `const` and `class`, and it may wait for a search or a download with `await`, which a script
 * allows only inside an async function.
 *
 * So the script declares each top-level name of the block as a global `var`, and runs the block's statements inside
 * an async function, with each top-level declaration turned into an assignment to that global. For example:
 *
 *   const p = await pixels("/oak.jpg");          var p, f; globalThis.__block = (async () => {
 *   function f() { return p.width; }        →    globalThis.f = f; (p = await pixels("/oak.jpg"));
 *                                                function f() { return p.width; }
 *                                                })();
 *
 * The worker waits for the promise in globalThis.__block. Every line of the block stays on the line it was on, so an
 * error names the line the agent wrote.
 */
import { type Node, type Pattern, parse } from "acorn";

/**
 * Returns the script that runs a block, which leaves the promise of its async function in globalThis.__block. Source
 * that does not parse comes back as it is, so that running it gives the browser's own error.
 */
export function script(source: string): string {
  let body;
  try {
    body = parse(source, { ecmaVersion: "latest", sourceType: "script", allowAwaitOutsideFunction: true }).body;
  } catch {
    return source;
  }
  const names: string[] = [], // every name the block declares at its top level
    functions: string[] = []; // the names of its function declarations, which are hoisted inside the async function
  let out = source;
  // from the last statement to the first, so that the places of the statements before a change stay as parsed
  for (const node of body.reverse()) {
    const text = source.slice(node.start, node.end);
    let made: string | undefined;
    if (node.type === "VariableDeclaration") {
      names.push(...node.declarations.flatMap((d) => bound(d.id)));
      // `var x;` keeps the value x had, while `let x;` makes it undefined
      const assigned = node.declarations.flatMap((d) =>
        d.init
          ? [`(${slice(source, d.id)} = ${slice(source, d.init)})`]
          : node.kind === "var"
            ? []
            : [`(${slice(source, d.id)} = undefined)`],
      );
      made = `${assigned.join(", ")};`;
    } else if (node.type === "ClassDeclaration" && node.id) {
      names.push(node.id.name);
      made = `(${node.id.name} = ${text});`;
    } else if (node.type === "FunctionDeclaration" && node.id) {
      names.push(node.id.name);
      functions.push(node.id.name);
    }
    if (made !== undefined) {
      const lost = text.split("\n").length - made.split("\n").length; // the line breaks the change took out
      out = out.slice(0, node.start) + made + "\n".repeat(Math.max(0, lost)) + out.slice(node.end);
    }
  }
  const declared = names.length ? `var ${[...new Set(names)].join(", ")}; ` : "",
    shared = functions.map((f) => `globalThis.${f} = ${f}; `).join("");
  return `${declared}globalThis.__block = (async () => { ${shared}${out}\n})();`;
}

/** Returns the source text of a node. */
function slice(source: string, node: Node): string {
  return source.slice(node.start, node.end);
}

/** Returns the names a declaration's target binds: `x`, or each name inside `{a, b: [c, ...d]}`. */
function bound(p: Pattern | null): string[] {
  if (!p) return [];
  if (p.type === "Identifier") return [p.name];
  if (p.type === "ObjectPattern")
    return p.properties.flatMap((q) => (q.type === "RestElement" ? bound(q.argument) : bound(q.value)));
  if (p.type === "ArrayPattern") return p.elements.flatMap(bound);
  if (p.type === "AssignmentPattern") return bound(p.left);
  if (p.type === "RestElement") return bound(p.argument);
  return [];
}
