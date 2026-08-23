/**
 * Where a panel hung under a button goes, and what keeps it there.
 *
 * Two panels in this plugin float over the workspace against a button of
 * their own: the dashboard's filter panel and the manuscript's typography
 * popover. Both are body-parented, because the page each hangs over scrolls
 * and clips; both must stay inside the window; and both must follow their
 * button when the layout moves. That arithmetic and that watching are here,
 * once, so the two cannot fall out of step -- which they had already begun to,
 * one of them having learnt to stay on screen while the other had not.
 *
 * Dismissal is left to each caller: what counts as a click outside differs
 * between them, and that is a question about the panel's contents rather than
 * about where it sits.
 */

/** The gap between a panel and the button it hangs from. */
export const PANEL_ANCHOR_GAP = 4;
/** The gap a panel keeps from the edges of the window. */
export const PANEL_EDGE_GAP = 8;

/**
 * Puts the panel under its anchor, or above it when there is no room below.
 *
 * The vertical clamp is not a nicety. A toolbar wraps in a narrow pane, so the
 * button can sit a row or two down the page, and a panel of a dozen rows then
 * runs past the bottom of the window -- where nothing can reach it, since a
 * panel's own scroller ends where the panel does and the page behind it does
 * not scroll in Obsidian. Failing both, it stands at the top edge and lets its
 * scroller do the rest.
 */
export function placePanel(panel: HTMLElement, anchor: HTMLElement, win: Window): void {
	const box = anchor.getBoundingClientRect();
	const room = win.innerWidth - panel.offsetWidth - PANEL_EDGE_GAP;
	const height = panel.offsetHeight;
	const below = box.bottom + PANEL_ANCHOR_GAP;
	const above = box.top - PANEL_ANCHOR_GAP - height;
	const floor = win.innerHeight - height - PANEL_EDGE_GAP;
	const top =
		below <= floor
			? below
			: above >= PANEL_EDGE_GAP
				? above
				: Math.max(PANEL_EDGE_GAP, floor);
	panel.style.top = `${String(top)}px`;
	panel.style.left = `${String(
		Math.max(PANEL_EDGE_GAP, Math.min(box.right - panel.offsetWidth, room)),
	)}px`;
}

/**
 * Keeps a panel against its anchor, and reports how to stop.
 *
 * The window is watched, and so is the button itself: folding a sidebar or
 * dragging a pane divider moves the button without the window changing size at
 * all, and a panel that only listened for a resize simply drifted away from
 * what it belonged to.
 */
export function followAnchor(
	panel: HTMLElement,
	anchor: HTMLElement,
	win: Window,
): () => void {
	const place = (): void => {
		placePanel(panel, anchor, win);
	};
	place();
	win.addEventListener('resize', place);
	const frame = anchor.ownerDocument.defaultView;
	const watcher = frame === null ? null : new frame.ResizeObserver(place);
	watcher?.observe(anchor);
	return () => {
		win.removeEventListener('resize', place);
		watcher?.disconnect();
	};
}
