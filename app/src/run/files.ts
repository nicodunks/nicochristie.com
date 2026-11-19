/**
 * The agent's folder, as its code reaches it in the run worker. The folder holds files by path, such as
 * "/code/1.js": what the agent's code wrote or downloaded, and any files copied in for it. The code lists,
 * reads, writes and edits files, reads a picture's pixels, and asks to see a picture. It also searches with Brave and
 * downloads files, which the worker cannot do itself, so it asks the page, which asks the gateway.
 *
 * The page owns the folder and sends it with every block. A block's own writes go into `wrote` as well, which goes
 * back to the page with the block's answer.
 */
import type * as Api from "../paint/api.ts";
import type { FileInfo } from "../paint/api.ts";
import type { Folder, Need, Saved } from "./run.ts";

const LONGEST = 1568; // the longest side, in pixels, of a picture the agent sees or reads the pixels of

/** The folder a block runs on, and the files the block wrote. The worker sets both for each block. */
export const disk = { folder: {} as Folder, wrote: {} as Folder };

/**
 * Returns the functions of the folder for the agent's code. `need` asks the page for what the worker cannot do, and
 * resolves with the page's answer.
 */
export function folderFunctions(
  need: (n: Need) => Promise<unknown>,
): Pick<typeof Api, "ls" | "readFile" | "writeFile" | "edit" | "pixels" | "braveSearch" | "download"> {
  return {
    ls: (dir = "/") => {
      const under = checked(dir).replace(/\/?$/, "/");
      return Object.keys(disk.folder)
        .filter((p) => p === dir || p.startsWith(under))
        .sort()
        .map((path) => ({ path, type: disk.folder[path].type, size: disk.folder[path].data.length }));
    },
    readFile: (path: string): string => new TextDecoder().decode(found(path).data),
    writeFile: (path: string, value: unknown) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return saved(path, { type: "text/plain", data: new TextEncoder().encode(text) });
    },
    edit: (path: string, old: string, replacement: string) => {
      if (typeof old !== "string" || typeof replacement !== "string" || !old)
        throw new Error("edit takes a path, old and replacement, all text, and old must not be empty");
      const file = found(path),
        text = new TextDecoder().decode(file.data),
        times = text.split(old).length - 1;
      if (times !== 1)
        throw new Error(
          times
            ? `${path} holds old ${times} times, so give more of the text around the place to edit`
            : `${path} does not hold old`,
        );
      return saved(path, { type: file.type, data: new TextEncoder().encode(text.replace(old, () => replacement)) });
    },
    pixels: async (path: string) => {
      const c = await decoded(path);
      return { width: c.width, height: c.height, data: c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data };
    },
    braveSearch: ((endpoint: string, params: object) =>
      need({ fn: "braveSearch", endpoint: String(endpoint), params: { ...params } })) as typeof Api.braveSearch,
    download: async (url: string, path: string) => {
      checked(path);
      return saved(path, (await need({ fn: "download", url: String(url) })) as Saved);
    },
  };
}

/** Returns a picture in the folder as a base64 JPEG no larger than LONGEST on its longest side. */
export async function seen(path: string): Promise<string> {
  return jpeg(await decoded(path));
}

/**
 * Returns the picture at a path, shrunk to LONGEST on its longest side, as a WebP data URL, which keeps its
 * transparency, or PNG where the browser cannot write WebP; and its width and height in pixels.
 */
export async function laid(path: string): Promise<Laid> {
  return webp(await decoded(path));
}

/** Returns a picture the person chose from their device as laid() returns one; throws if the file is not a picture. */
export async function picked(file: Blob): Promise<Laid> {
  return webp(await drawn({ type: file.type, data: new Uint8Array(await file.arrayBuffer()) }, "this file"));
}

/** A picture to lay on the page: a data URL, and its width and height in pixels. */
type Laid = { src: string; width: number; height: number };

// Returns what is on a canvas as a WebP data URL, or PNG where the browser cannot write WebP, with its size.
async function webp(c: OffscreenCanvas): Promise<Laid> {
  const blob = await c.convertToBlob({ type: "image/webp", quality: 0.9 });
  return {
    src: `data:${blob.type};base64,${base64(new Uint8Array(await blob.arrayBuffer()))}`,
    width: c.width,
    height: c.height,
  };
}

// Returns the path if it is one: it starts with "/".
function checked(path: string): string {
  if (typeof path !== "string" || !path.startsWith("/")) throw new Error(`a path starts with "/", as "/notes.txt"`);
  return path;
}

// Returns the file at a path, or throws if there is none.
function found(path: string): Saved {
  const file = Object.hasOwn(disk.folder, checked(path)) ? disk.folder[path] : undefined;
  if (!file) throw new Error(`there is no file ${path}`);
  return file;
}

// Saves a file at a path, and returns its listing.
function saved(path: string, file: Saved): FileInfo {
  disk.folder[checked(path)] = disk.wrote[path] = file;
  return { path, type: file.type, size: file.data.length };
}

// Returns the picture at a path drawn on a canvas, shrunk to LONGEST on its longest side.
async function decoded(path: string): Promise<OffscreenCanvas> {
  return drawn(found(path), path);
}

// Returns a picture's bytes drawn on a canvas, shrunk to LONGEST on its longest side. `name` names it in an error.
async function drawn(file: Saved, name: string): Promise<OffscreenCanvas> {
  const bitmap = await createImageBitmap(new Blob([file.data as Uint8Array<ArrayBuffer>], { type: file.type })).catch(
    () => {
      throw new Error(`${name} is not a picture`);
    },
  );
  const k = Math.min(1, LONGEST / Math.max(bitmap.width, bitmap.height)),
    canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * k)), Math.max(1, Math.round(bitmap.height * k)));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

// Returns what is on a canvas as a base64 JPEG.
async function jpeg(canvas: OffscreenCanvas): Promise<string> {
  return base64(
    new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 })).arrayBuffer()),
  );
}

// Returns bytes in base64.
function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
