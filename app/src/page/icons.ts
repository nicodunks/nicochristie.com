/** The page's hand-drawn icons, which the page's sprite holds as symbols named i-<name>. */

/** Sets a button's content to the named icon over, or beside, its label, or to the icon alone. */
export function labelled(b: HTMLElement, icon: string, label?: string): void {
  b.innerHTML = `<svg class="icon"><use href="#i-${icon}"/></svg>${label ? `<span>${label}</span>` : ""}`;
}
