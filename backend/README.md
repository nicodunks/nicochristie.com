# Nico's tiny backend

One Cloudflare Worker (`nico-personal-api`) and one private D1 database (`nico-personal-site`). No runtime packages, separate image bucket, public database credentials, or public admin endpoint.

The local preview and the future GitHub Pages frontend use the API URL in `../backend-config.js`. The website itself is still hosted through GitHub Pages; deploying the API does not publish frontend changes.

## Behavior

- The owner-requested visit baseline is **723**. New, Turnstile-verified browser sessions add to it atomically. Refreshes reuse a session ID in `sessionStorage`. Local previews have a separate counter, so development does not inflate the public total. This measures sessions, not unique human beings; multiple tabs or browsers may count separately.
- Art appears immediately after a successful post. The existing local drawing was imported. Failed retries with the same request ID do not duplicate a post.
- Drawings are resized to 800 × 560 and submitted as RGB pixels. The server accepts only that exact raster size, generates a fresh PNG, and caps the stored image at 250 KiB. It never decodes arbitrary uploaded image formats, scripts, or SVGs.
- Names and titles are plain text and rendered using `textContent`; all database values are bound parameters.
- Turnstile tokens are checked on the server for success, hostname, and action. Missing checks fail closed. Only exact configured frontend origins can write.
- Per internet connection: 12 post attempts per minute and 50 successful drawings per rolling 24 hours. Limits include shared connections, not just one person. The wall also allows 500 posts per rolling day and at most 250 MB of artwork overall. Existing art is never automatically deleted to make room.
- Visits allow 120 attempts per minute and 300 new sessions per hour per connection. Known sessions do not increment the count. IP addresses are stored only as keyed hashes. Visit deduplication rows expire after 48 hours; aggregate totals persist.
- Automated abuse is reduced, not eliminated. Human visitors can still post inappropriate art. The owner can remove it with authenticated Cloudflare access.

## The homepage's sheet

The homepage is one sheet of paper that the visitor and a Claude agent both draw on. When the homepage opens, the page itself draws one tiny greeting in the agent's colour, picked at random, with no request to anyone. When the visitor draws back, the agent answers. `../sheet.js` is the page's side, `sheet.mjs` is the Worker's side, and `agent.mjs` holds the agent's model, prompt and tools.

- Each visitor's sheet is one session of a Claude Managed Agent, started by `POST /api/sheets` at the visitor's first stroke, so a visitor who only reads costs nothing. The session's id stays in the database and never reaches the browser, which gets a random sheet id instead.
- A new sheet needs a Turnstile token with the action `sheet`. The widget never shows: a visitor Turnstile would stop to question gets no sheet instead. When the check, the Worker or the agent fails, the homepage is a plain homepage without ink.
- One internet connection may start 8 sheets per rolling 24 hours, and all visitors together 200. The database refuses a sheet over either cap before any session is paid for.
- Each sheet's session may spend at most `SHEET_CENTS` (25 cents) at list prices, enforced by Anthropic, and takes at most 40 turns. All sheet requests share a limit of 30 per minute per connection.
- The agent has only the page tools: draw, handwrite, erase, move, zoom and look. It has no shell, no files and no web. What the agent says outside these tools is dropped.
- A reload wipes the ink and the page greets the visitor again. The tab keeps the sheet's id in `sessionStorage`, so a reload goes on with the same sheet and counts against no cap but the sheet's own turns and budget.
- The sheet zooms between 0.2 and 1. A wide window opens at 1 and a phone at 0.7, the visitor zooms with two fingers, and the agent zooms with its zoom tool.

To set the agent up once, with the personal Anthropic key:

```sh
cd backend
ANTHROPIC_API_KEY=... node setup.mjs setup          # makes the agent and writes its two ids into wrangler.json
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler d1 migrations apply nico-personal-site --remote
npm run deploy
```

After changing the prompt or the tools in `agent.mjs`, run `ANTHROPIC_API_KEY=... node setup.mjs update`. The key's workspace should have a monthly spend limit in the Anthropic Console: the caps above bound the cost to about $50 a day at worst, and the workspace limit is the backstop.

## Development and deployment

Use Node 22.13+.

```sh
cd backend
npm install
npm test
npx wrangler d1 migrations apply nico-personal-site --remote
npm run deploy
```

Production secrets are stored in Cloudflare: `TURNSTILE_SECRET` and `IP_SECRET`. Never put them in frontend code or Git. Rotating `IP_SECRET` resets matching of existing visit IDs and rate-limit hashes, so do so deliberately.

Tests use a real in-memory SQLite database and mocked Turnstile responses. They cover image generation, input limits, atomic counters, duplicate submissions, origin checks, token checks, quotas, and image headers. Live smoke checks verify config/CORS, persisted art, serving images, and rejection of invalid tokens. Interactive Turnstile still depends on the visitor's browser/network being able to load Cloudflare.

## Owner maintenance

Use Cloudflare's authenticated D1 console or Wrangler, not a browser-visible admin key. List recent posts:

```sh
npx wrangler d1 execute nico-personal-site --remote --command 'SELECT id,title,name,created_at FROM wall_posts ORDER BY created_at DESC LIMIT 50'
```

To remove an unwanted drawing, delete its row by ID in the D1 console. The storage counter updates automatically. There is no anonymous delete/update route.

Backup before maintenance:

```sh
npx wrangler d1 export nico-personal-site --remote --output /path/outside/public-repo/nico-wall-backup.sql
```

Turnstile is a managed widget scoped to `nicochristie.com`, `www.nicochristie.com`, `nicodunks.github.io`, `localhost`, and `127.0.0.1`. Localhost is intentionally allowed for this local iteration workflow. The API still restricts local origins to port 8765. No paid plan was enabled by this setup.
