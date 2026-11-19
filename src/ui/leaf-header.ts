import type { View, WorkspaceLeaf } from 'obsidian';

/**
 * A view of the plugin's that can say its title again where the app shows
 * it, for a change of language: the app reads the title once as the leaf
 * opens and keeps it until it is told.
 */
export interface RelabelsHeader {
	relabelHeader(): void;
}

export function relabelsHeader(view: unknown): view is RelabelsHeader {
	return (
		typeof view === 'object' &&
		view !== null &&
		typeof (view as Partial<RelabelsHeader>).relabelHeader === 'function'
	);
}

/**
 * Writes a view's title again in both places the app shows it: the tab,
 * through the leaf's own `updateHeader`, which is not in the published API
 * and so is asked for only where it stands, and the bar over the view, which
 * `updateHeader` leaves as it was. A tab stands in the tab bar, or as an
 * icon in a sidebar with its title for a tooltip, while its view is put
 * away, so this is owed at once, whatever waits for the view's reveal.
 */
export function relabelLeafHeader(view: View, title: string = view.getDisplayText()): void {
	const leaf = view.leaf as WorkspaceLeaf & { updateHeader?: () => void };
	leaf.updateHeader?.();
	view.containerEl.querySelector<HTMLElement>('.view-header-title')?.setText(title);
}
