/**
 * The person's drawings, kept in this browser's IndexedDB. A drawing is everything the page holds for one sheet: its
 * ink and animations, the agent's conversation about it, the agent's folder, and the person's notes and photos.
 *
 * The open drawing is not written anywhere: a reload starts a new sheet. Only Save, in the menu, puts it on
 * the shelf of saved drawings. My drawings, the folder at the top left, opens the shelf on the left, which shows every saved drawing,
 * last saved first; tapping one opens it as it was saved, and the agent goes on from where its conversation about that
 * drawing stopped. Clear, at the top right, wipes the open drawing for a new sheet, which holds only the words about
 * Nico (about.ts), and an agent that remembers nothing, and asks first if the drawing has changed since it was last saved. Download, in the menu, saves a PNG of the whole
 * drawing.
 */
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { Agent } from "../agent/loop.ts";
import type { Point } from "../paint/api.ts";
import { type Snapshot, even } from "../paint/sheet.ts";
import type { Folder } from "../run/run.ts";
import { about } from "./about.ts";
import { forget } from "./animations.ts";
import { say } from "./caption.ts";
import { tell, watch } from "./history.ts";
import { pinned } from "./photos.ts";
import { whole } from "./picture.ts";
import { type Note, type Photo, attached, drawing, folder, named, session, sheet, spoken } from "./state.ts";
import { ready } from "./tools.ts";
import { track } from "./track.ts";
import { home, redraw } from "./view.ts";
import { list } from "./voice.ts";

const COVER = 320; // the most pixels across or down a drawing's picture on the shelf
const EXPORT = 4096; // the most pixels across or down an exported drawing
const QUIET = 1000; // how long after the person's last change the open drawing is written, in milliseconds
const OPEN = "open"; // the key of the open drawing in its store

/**
 * Returns a mark as it was kept before version 3 of the database, in the form it has now. Then a line had one width,
 * and an eraser's cut held its points and one width; now each point of a line, and of an eraser's line, holds its own
 * width.
 */
function widthAtEachPoint(m: Record<string, unknown>): Record<string, unknown> {
  if (m.kind === "line") {
    const { width, pieces, ...rest } = m as { width: number; pieces: Point[][] };
    return { ...rest, pieces: pieces.map((p) => even(p, width)) };
  }
  const cuts = m.cuts as ({ ring: Point[] } | { points: Point[]; width: number })[];
  return { ...m, cuts: cuts.map((c) => ("ring" in c ? c : { line: even(c.points, c.width) })) };
}

/** A drawing, by its name in the gateway's record: everything the page needs to open it again. */
interface Kept {
  page: string;
  sheet: Snapshot;
  history: MessageParam[]; // the agent's conversation
  size: number; // how many tokens the conversation had at its last reply
  model?: string; // the name of the model that took the last turn; absent in a drawing saved before the page kept it
  folder: Folder;
  notes: Note[];
  photos: Photo[];
}

/** What the shelf shows of a saved drawing: its name, when it was last saved in milliseconds since 1970, and its picture as a data URL. */
interface Cover {
  page: string;
  saved: number;
  picture: string;
}

const clear = document.getElementById("clear")!,
  button = document.getElementById("drawings")!,
  shelf = document.getElementById("shelf")!;

let unsaved = false; // the open drawing has changed since it was opened or last saved

// The browser's database holds three stores. Two hold the saved drawings by name: the whole drawings, and their
// covers, so the shelf reads the small covers and not every conversation. The third holds the open drawing, with
// whether it is unsaved. Version 3 gave each point of a line its own width, so opening a database of an earlier
// version rewrites the drawings it holds in that form.
const db: Promise<IDBDatabase> = new Promise((done, fail) => {
  const r = indexedDB.open("drawing-agent", 3);
  r.onupgradeneeded = (e) => {
    const has = r.result.objectStoreNames;
    if (!has.contains("drawings")) r.result.createObjectStore("drawings", { keyPath: "page" });
    if (!has.contains("covers")) r.result.createObjectStore("covers", { keyPath: "page" });
    if (!has.contains(OPEN)) r.result.createObjectStore(OPEN);
    if (e.oldVersion < 3)
      for (const store of ["drawings", OPEN]) {
        const cursor = r.transaction!.objectStore(store).openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          const kept = c.value as { sheet: { marks: Record<string, unknown>[] } };
          kept.sheet.marks = kept.sheet.marks.map(widthAtEachPoint);
          c.update(kept);
          c.continue();
        };
      }
  };
  r.onsuccess = () => done(r.result);
  r.onerror = () => fail(r.error);
});

/**
 * Resolves with the result of the request `ask` makes in a transaction over both stores, once the transaction is done.
 * `ask` runs in the same moment the transaction starts, so what it reads from the page is what is stored.
 */
async function stored<T>(mode: IDBTransactionMode, ask: (t: IDBTransaction) => IDBRequest<T>): Promise<T> {
  const t = (await db).transaction(["drawings", "covers", OPEN], mode),
    r = ask(t);
  return new Promise((done, fail) => {
    t.oncomplete = () => done(r.result);
    t.onerror = t.onabort = () => fail(t.error);
  });
}

let soon: ReturnType<typeof setTimeout> | undefined; // the writing that waits for the person to pause

/** Returns the open drawing as it is now. */
function now(): Kept {
  const { page, history, size, model } = drawing.agent;
  return { page, sheet: sheet.snapshot(), history, size, model, folder, notes: spoken.notes, photos: attached };
}

/** Keeps nothing: on this site a reload starts a new sheet, so the open drawing is not written to the browser. */
async function keep(): Promise<void> {
  clearTimeout(soon);
}

/** Marks the open drawing as changed by the agent's turn, and writes it. */
export function changed(): void {
  unsaved = true;
  void keep();
}

/** Puts the open drawing and its cover on the shelf. */
async function save(): Promise<void> {
  try {
    await stored("readwrite", (t) => {
      const k = now();
      t.objectStore("covers").put({
        page: k.page,
        saved: Date.now(),
        picture: whole(COVER).toDataURL(),
      } satisfies Cover);
      return t.objectStore("drawings").put(k);
    });
    unsaved = false;
    say("Saved in My drawings.");
  } catch (e) {
    say(`Could not save this drawing: ${e instanceof Error ? e.message : String(e)}`);
  }
  void keep();
  if (!shelf.hidden) void show();
}

/** Returns whether the person lets the open drawing go: it is saved as it is, or the person says it may be lost. */
const letGo = (): boolean =>
  !unsaved || confirm("This drawing has changed since it was saved. Let the changes go? Save in the menu keeps them.");

/** Makes `k` the open drawing, as saved or not: its sheet, its agent, its folder, notes and photos, seen from the middle of the page. */
function load(k: Kept, changes = false): void {
  unsaved = changes;
  sheet.restore(k.sheet);
  drawing.agent = new Agent(k.page, k.history, k.size, k.model);
  for (const path of Object.keys(folder)) delete folder[path];
  Object.assign(folder, k.folder);
  spoken.notes = k.notes.filter((n) => n.text); // a note saved while it was still being heard has no words yet
  attached.splice(0, attached.length, ...k.photos);
  tell(); // Undo reaches back no further than the drawing's opening, and the agent is told of nothing done before it
  home();
  forget();
  list();
  pinned();
  ready();
  redraw();
  say("");
  void keep();
}

/** Returns a new drawing: the sheet about Nico, as the agent's ink, an empty conversation and an empty folder. */
const blank = (): Kept => ({
  page: named(),
  sheet: about(),
  history: [],
  size: 0,
  folder: {},
  notes: [],
  photos: [],
});

/** Opens the saved drawing called `page`, if there is one and the person lets the open drawing go. */
async function open(page: string): Promise<void> {
  if (session.busy || spoken.heard || !letGo()) return;
  const k = await stored<Kept | undefined>("readonly", (t) => t.objectStore("drawings").get(page)).catch(() => {
    say("This browser cannot keep drawings.");
    return undefined;
  });
  if (k) load(k);
}

/** Opens the shelf, or closes it. */
function shelve(on: boolean): void {
  shelf.hidden = !on;
  button.classList.toggle("on", on);
  if (on) void show();
}

/** Fills the shelf with every saved drawing's cover, last saved first. The open drawing's cover is marked and has no ×. */
async function show(): Promise<void> {
  const covers = await stored<Cover[]>("readonly", (t) => t.objectStore("covers").getAll()).catch(() => []);
  covers.sort((a, b) => b.saved - a.saved);
  const when = (ms: number) =>
    new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  shelf.replaceChildren(
    ...covers.map((c) => {
      const item = document.createElement("div"),
        img = document.createElement("img"),
        label = document.createElement("span");
      item.className = c.page === drawing.agent.page ? "cover open" : "cover";
      img.src = c.picture;
      img.alt = `The drawing of ${when(c.saved)}`;
      label.textContent = when(c.saved);
      item.append(img, label);
      item.addEventListener("click", () => {
        track("drawing_opened", { page: c.page });
        void open(c.page).then(() => shelve(false));
      });
      if (c.page !== drawing.agent.page) {
        const drop = document.createElement("button");
        drop.textContent = "×";
        drop.title = "Delete";
        drop.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!confirm("Delete this drawing? It cannot be brought back.")) return;
          track("drawing_deleted", { page: c.page });
          void stored("readwrite", (t) => {
            t.objectStore("covers").delete(c.page);
            return t.objectStore("drawings").delete(c.page);
          }).then(show);
        });
        item.append(drop);
      }
      return item;
    }),
  );
  if (!covers.length) shelf.textContent = "Your drawings will show here.";
}

// Clear wipes the open drawing for a new one, if the person lets it go.
clear.addEventListener("click", () => {
  if (!letGo()) return;
  load(blank());
  track("drawing_new", { page: drawing.agent.page, props: { from: "clear" } });
});

document.getElementById("save")!.addEventListener("click", () => {
  track("saved", { page: drawing.agent.page });
  void save();
});
button.addEventListener("click", () => shelve(shelf.hidden));

// Download saves a PNG of the whole drawing to the person's downloads.
document.getElementById("export")!.addEventListener("click", () =>
  whole(EXPORT).toBlob((png) => {
    if (!png) return;
    track("exported", { page: drawing.agent.page, props: { bytes: png.size } });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(png);
    a.download = `drawing-${drawing.agent.page}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }),
);

// The open drawing is written a moment after the person's last change, and at once when the tab is hidden or closed.
watch(() => {
  unsaved = true;
  clearTimeout(soon);
  soon = setTimeout(() => void keep(), QUIET);
});
addEventListener("pagehide", () => void keep());

// The page always opens on a new sheet with the words about Nico: a reload wipes what was drawn.
load(blank());
