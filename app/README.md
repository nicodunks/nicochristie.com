# The homepage's sheet

nicochristie.com is /draw's sheet (off-policy-private, `draw/`), hosted lightly: no sign-in, credits, shelf, sharing,
live voice, trace or analytics. `npm install && npm run build` here writes `../index.html` and `../draw/`, which are
committed, since GitHub Pages builds nothing. The Worker's side is `../backend/draw/`.

## Copied from /draw

`src/canvas`, `src/paint`, `src/run`, `src/sandbox`, `src/sketch`, `src/stage` and `src/contract` are /draw's, and so
are these modules of its website in `src/page`: `turn`, `conversation`, `voice`, `talk`, `swirl`, `buttons`, `style`,
`state`, `caption` and `main`. `index.html` is /draw's `src/page/index.html` without the parts this site leaves out.
Last synced from /draw at 8283f6b (#234).

To sync again, copy those folders and modules over and re-apply the changes below, each marked in its file.

| File | This site's change |
|---|---|
| `src/canvas/state.ts` | `OPEN`: opens a little zoomed out (0.75), and at least 700 units across on a phone |
| `src/canvas/environment.ts` | `still.view`: the greeting turn's `show()` does not move the view |
| `src/contract/prompt.ts` | the JSON import carries `with { type: "json" }`, for the Worker's tests in Node |
| `src/page/style.ts` | the style pictures are under `/draw/styles/` |
| `src/page/turn.ts` | `greet()`: the turn on page load, with its themes; its bot check is quiet and its failures unshown |
| `src/page/talk.ts`, `buttons.ts` | the swirl rests as the swirl (not a microphone), and a new drawing turns its caption to Send |
| `src/page/main.ts` | this site's own entry point |
| `index.html` | this site's title, icons, Worker address, Clear as a trash can, the words about Nico for readers |

## This site's own

| File | What it does |
|---|---|
| `src/page/about.ts`, `links.ts` | The words about Nico as the agent's ink, and the taps that open their links |
| `src/page/fresh.ts` | Every visit and Clear open a new sheet with those words; nothing is kept |
| `src/page/backdrop.ts` | The faint clouds of digits on the paper |
| `src/page/account.ts` | Requests to the Worker, with the silent Turnstile check in place of sign-in |
| `src/page/track.ts`, `model.ts`, `drawings.ts`, `trace.ts` | Stand-ins for /draw's modules this site leaves out |
