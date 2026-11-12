// Makes or updates the homepage's drawing agent on Claude Managed Agents. Run with $ANTHROPIC_API_KEY set to the
// personal key, from this folder:
//
//   node setup.mjs setup     makes the sandbox and the agent, and writes their ids into wrangler.json
//   node setup.mjs update    sends the model, prompt and tools written in agent.mjs to the agent, as a new version
import Anthropic from "@anthropic-ai/sdk";
import {readFileSync, writeFileSync} from "node:fs";
import {agentArgs} from "./agent.mjs";

const client = new Anthropic();
const WRANGLER = new URL("./wrangler.json", import.meta.url);

// Makes the sandbox and the agent, and writes their ids into wrangler.json, where the Worker reads them. The agent has no tool that uses the sandbox, and the
// sandbox reaches no host, but every session must name one.
async function setup() {
  const sandbox = await client.beta.environments.create({
    name: "homepage-drawing-agent",
    config: {type: "cloud", networking: {type: "limited"}},
  });
  const agent = await client.beta.agents.create(agentArgs());
  const config = JSON.parse(readFileSync(WRANGLER, "utf8"));
  Object.assign(config.vars, {SHEET_AGENT: agent.id, SHEET_ENVIRONMENT: sandbox.id});
  writeFileSync(WRANGLER, JSON.stringify(config, null, 2) + "\n");
  console.log(`Made ${agent.id} and ${sandbox.id}, and wrote them into wrangler.json.`);
}

// Updates the agent named in wrangler.json to what agent.mjs says, and prints the new version.
async function update() {
  const {vars} = JSON.parse(readFileSync(WRANGLER, "utf8"));
  const agent = await client.beta.agents.retrieve(vars.SHEET_AGENT);
  const next = await client.beta.agents.update(agent.id, {version: agent.version, ...agentArgs()});
  console.log(`${next.id}: version ${next.version}`);
}

const run = {setup, update}[process.argv[2]];
if (!run) throw new Error("Usage: node setup.mjs setup | update");
await run();
