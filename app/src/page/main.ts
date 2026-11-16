/**
 * The page: a sheet the person and the agent draw on together. Each module below sets itself up as it loads; this one
 * fits the canvas to the window, opens the view in the middle of the page, and sets which buttons are live. Built by `npm run build` into app.js.
 */
import "./backdrop.ts";
import "./rubber.ts";
import "./links.ts";
import "./drawings.ts";
import "./input.ts";
import "./menu.ts";
import "./voice.ts";
import "./autosend.ts";
import { ready } from "./tools.ts";
import { greet } from "./turn.ts";
import "./brush.ts";
import { fit, home } from "./view.ts";

window.addEventListener("resize", fit);
fit();
home();
ready();
greet();
