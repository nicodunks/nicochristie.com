/**
 * The web, for the agent's code: searches with the Brave Search API, and downloads of single files. The page asks
 * for these when the agent's code calls braveSearch or download, since the agent's code cannot reach the network
 * itself.
 *
 *   POST /api/draw/search     {endpoint, params}: Brave's JSON answer to GET {BRAVE}/{endpoint}/search?{params},
 *                             as Brave sent it. endpoint is web or images. The gateway adds only the key, and sets
 *                             safesearch to strict, since the people using the app are mostly kids.
 *   POST /api/draw/download   {url}: the file at an http or https URL, with its media type, at most 10 MB.
 *
 * BRAVE_API_KEY is the key of the Brave Search API. For tests, SEARCH_URL sends the searches to another server.
 */

const BRAVE = "https://api.search.brave.com/res/v1";
const ENDPOINTS = ["web", "images"]; // the Brave searches the agent's code may use
const LARGEST = 10_000_000; // the largest file downloaded, in bytes
const WAIT = 15_000; // how long a download may take, in milliseconds

/** What the web needs from the gateway's settings. */
export interface WebEnv {
  BRAVE_API_KEY?: string;
  SEARCH_URL?: string;
}

/** Returns Brave's answer to the search given, as Brave sent it, or why there is none. */
export async function search(given: { endpoint?: unknown; params?: unknown } | null, env: WebEnv): Promise<Response> {
  if (!env.BRAVE_API_KEY) return new Response("Search is not set up on this server.", { status: 503 });
  if (!ENDPOINTS.includes(String(given?.endpoint)) || typeof given?.params !== "object" || !given.params)
    return new Response(`Send {endpoint, params}, with endpoint one of ${ENDPOINTS.join(", ")}.`, { status: 422 });
  const params = new URLSearchParams(Object.entries(given.params).map(([k, v]) => [k, String(v)]));
  params.set("safesearch", "strict");
  const r = await fetch(`${env.SEARCH_URL || BRAVE}/${given.endpoint}/search?${params}`, {
    headers: { accept: "application/json", "x-subscription-token": env.BRAVE_API_KEY },
  });
  const body = await r.text();
  if (!r.ok) return new Response(`Brave answered ${r.status}: ${body.slice(0, 1000)}`, { status: 502 });
  return new Response(body, { headers: { "content-type": "application/json" } });
}

/** Returns the file at the URL given, with its media type, or why it cannot. */
export async function download(given: { url?: unknown } | null): Promise<Response> {
  let url: URL;
  try {
    url = new URL(String(given?.url));
  } catch {
    return new Response("Send {url}, with a whole URL such as https://example.com/cat.jpg.", { status: 422 });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return new Response("Only http and https URLs can be downloaded.", { status: 422 });
  const r = await fetch(url, { signal: AbortSignal.timeout(WAIT) }).catch(() => null);
  if (!r) return new Response(`${url} did not answer within ${WAIT / 1000} seconds.`, { status: 502 });
  if (!r.ok) return new Response(`${url} answered ${r.status}.`, { status: 502 });
  if (Number(r.headers.get("content-length")) > LARGEST)
    return new Response(`${url} is larger than ${LARGEST / 1_000_000} MB.`, { status: 413 });
  const data = await r.arrayBuffer();
  if (data.byteLength > LARGEST)
    return new Response(`${url} is larger than ${LARGEST / 1_000_000} MB.`, { status: 413 });
  const type = (r.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
  return new Response(data, { headers: { "content-type": type, "cache-control": "no-store" } });
}
