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

The homepage is the drawing agent's page from offpolicyinc.com/draw, without its accounts: one sheet of paper that the visitor and a Claude agent both draw on. The sheet opens with the words about Nico in the agent's handwriting, as the agent's own ink, so the agent can move, erase or rewrite them. The page's source is `../app/` (`src/page/about.ts` holds the words), and `cd ../app && npm install && npm run build` builds it into `../index.html` and `../draw/`, which are committed because GitHub Pages builds nothing. `draw/` here is the Worker's side: `index.ts` is the gateway, `agent.ts` holds the models, the prompt and the tool, and `reference.json` is the paint API the prompt shows the agent, which the page's build writes.

- The page keeps the sheet and the conversation in the visitor's browser and runs the code the agent writes, in two Web Workers. The gateway only adds the key, the prompt and the tool, and passes the conversation to Claude's Messages API with the Worker's `ANTHROPIC_API_KEY`. The page is always in brush mode, whose turns go to Claude Opus 5.5 at low effort.
- No one signs in. A drawing's first request needs a Turnstile token with the action `sheet`. The widget never shows: a visitor Turnstile would stop to question cannot send, and can still draw.
- One internet connection may start 30 drawings per rolling 24 hours, and all visitors together 200.
- Each call to the model is a row of `draw_calls` with its cost at list prices. A drawing may spend `DRAW_PAGE_CENTS` (50 cents), a connection `DRAW_IP_CENTS` ($1.50) per rolling day, and all visitors together `DRAW_DAY_CENTS` ($20) per rolling day. A turn costs a few cents. All drawing requests share a limit of 60 per minute per connection.
- The agent's code can search the web only if the secret `BRAVE_API_KEY` is set, and can download single files of at most 10 MB through the gateway.
- A reload wipes the drawing: the page always opens on a new sheet with the words about Nico, as Clear does.
- The blue words are links: `../app/src/page/links.ts` opens a link when its ink is tapped.

The key's workspace should have a monthly spend limit in the Anthropic Console: the caps above bound the cost to about $20 a day, and the workspace limit is the backstop. The Managed Agent the sheet used before (`setup.mjs`) is no longer called and can be archived in the Console.

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
