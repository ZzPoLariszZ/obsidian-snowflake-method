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
 * Dismissal is here too, for the panels that share one rule -- a press
 * outside the panel and its button, or Escape, puts it away -- with room for
 * a caller to name what else counts as inside (a suggestion list the panel's
 * own field opened, say); the two that need that still spell their own.
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

/** A panel hung under a button, and the way to take it down. */
export interface HungPanel {
	el: HTMLElement;
	/** Stops following and listening; the caller removes the element. */
	release: () => void;
}

/**
 * Hangs a panel under its anchor in the window's body -- so nothing clips
 * it -- following the anchor when the layout moves, and takes it down at a
 * press outside it or at Escape, which is stopped there so nothing under
 * the panel reads the same key: a card whose Escape leaves Editing, say.
 * Escape hands the focus back to the button.
 */
export function hangPanel(
	anchor: HTMLElement,
	spec: {
		cls: string;
		label: string;
		build(panel: HTMLElement): void;
		/** What a press inside counts as inside besides the panel and the button. */
		ignore?: string;
		onClose(): void;
	},
): HungPanel {
	const win = anchor.win;
	const panel = win.activeDocument.body.createDiv({
		cls: spec.cls,
		attr: { role: 'dialog', 'aria-label': spec.label },
	});
	spec.build(panel);
	const unfollow = followAnchor(panel, anchor, win);
	const dismiss = (event: MouseEvent): void => {
		const target = event.target as Node | null;
		if (target === null) return;
		if (panel.contains(target) || anchor.contains(target)) return;
		if (spec.ignore !== undefined) {
			// The target may be a text node; its element is what carries the class.
			const element = 'closest' in target ? (target as Element) : target.parentElement;
			if (element?.closest(spec.ignore) != null) return;
		}
		spec.onClose();
	};
	const onKey = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		spec.onClose();
		anchor.focus();
	};
	win.addEventListener('mousedown', dismiss, true);
	win.addEventListener('keydown', onKey, true);
	anchor.setAttribute('aria-expanded', 'true');
	return {
		el: panel,
		release: () => {
			win.removeEventListener('mousedown', dismiss, true);
			win.removeEventListener('keydown', onKey, true);
			unfollow();
			anchor.setAttribute('aria-expanded', 'false');
		},
	};
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
