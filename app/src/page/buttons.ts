/** Which buttons are live: Undo and Redo, then the website's Send or Stop, New and My drawings. */
import { done, watch } from "../canvas/history.ts";
import { labelled } from "../canvas/icons.ts";
import { session } from "../canvas/state.ts";
import { ready as tools } from "../canvas/tools.ts";
import { spoken } from "./state.ts";

const send = document.getElementById("send") as HTMLButtonElement; // in the typing bar
const fresh = document.getElementById("new") as HTMLButtonElement,
  drawings = document.getElementById("drawings") as HTMLButtonElement;

/** Sets which buttons are live. */
export function ready(): void {
  tools();
  const word = session.busy ? "Stop" : "Send";
  labelled(send, session.busy ? "stop" : "plane");
  send.title = word;
  const typing = spoken.draft.trim() !== "",
    drew = done().length > 0; // the person did something to the sheet that the agent has not been told of
  send.disabled = send.hidden = !session.busy && !typing && !drew; // Send shows while there is something to send, or to stop
  fresh.disabled = drawings.disabled = session.busy || spoken.listening;
}

// any change to the sheet may make Send live
watch(ready);
