/**
 * Keeps an element where the reader found it across a repaint that may
 * change the height of whatever stands above it in its scroller. A
 * vocabulary pane too narrow for two columns stands its inspector above the
 * trees, and the inspector takes the height of the entry it shows, so
 * choosing an entry used to drop the row just tapped by the inspector's own
 * growth. The anchor is measured before and after, and the scroller moved by
 * the difference, after the repaint has done all it does, so whatever the
 * repaint itself did to the scroller is corrected with it. The anchor is any
 * object that can be measured, so a caller whose repaint makes the element
 * anew hands in one that finds the current element each time. Where nothing
 * above the anchor changes, as beside a two-column pane's inspector, nothing
 * moves.
 */
export function holdInPlace(
	anchor: { getBoundingClientRect(): { top: number } } | undefined,
	scroller: { scrollTop: number } | null,
	repaint: () => void,
): void {
	if (anchor === undefined || scroller === null) {
		repaint();
		return;
	}
	const before = anchor.getBoundingClientRect().top;
	repaint();
	const moved = anchor.getBoundingClientRect().top - before;
	if (moved !== 0) scroller.scrollTop += moved;
}
