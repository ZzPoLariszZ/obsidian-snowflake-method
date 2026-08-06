/**
 * Scroll offsets and `<details>` open states live in the DOM, and the views that
 * refresh in place rebuild their DOM from an empty container every time. Reading
 * that state back before the teardown and reapplying it afterwards is what stops
 * a status change or a language switch from throwing the reader back to the top
 * of a list they had scrolled.
 *
 * This is only needed where the scroller element is itself discarded and
 * recreated, because its replacement necessarily starts at offset zero. A
 * scroller that survives while only its children are replaced keeps its offset
 * on its own: `empty()` followed by a synchronous refill never reaches a layout
 * in between, so the offset is never clamped.
 */

/** Marks a `<details>` whose open state should survive the next rebuild. */
export const DISCLOSURE_KEY_ATTRIBUTE = 'data-snowflake-disclosure';

export interface ScrollReveal {
	scrollTop: number;
	viewportStart: number;
	viewportEnd: number;
	itemStart: number;
	itemEnd: number;
}

/**
 * The scroll offset that brings one item inside its scroller, moving by the
 * smallest amount that works. An item already in view keeps the offset it has,
 * so restoring a remembered position never fights a reader who scrolled the list
 * away from the item that happens to be selected.
 */
export function scrollOffsetRevealing(reveal: ScrollReveal): number {
	if (reveal.itemStart < reveal.viewportStart) {
		return reveal.scrollTop - (reveal.viewportStart - reveal.itemStart);
	}
	if (reveal.itemEnd > reveal.viewportEnd) {
		return reveal.scrollTop + (reveal.itemEnd - reveal.viewportEnd);
	}
	return reveal.scrollTop;
}

/**
 * Carries scroll offsets and disclosure states across a rebuild that replaces
 * the elements holding them. Construct one per view with the selectors of the
 * scrollers it owns, `capture()` before emptying the container, and `restore()`
 * once the new content is fully in place.
 */
export class RenderStateKeeper {
	private readonly scrollOffsets = new Map<string, number>();
	private readonly disclosures = new Map<string, boolean>();

	constructor(private readonly scrollSelectors: readonly string[]) {}

	/** Reads back the state the reader controls, before it is discarded. */
	capture(root: HTMLElement): void {
		for (const selector of this.scrollSelectors) {
			const scroller = this.resolveScroller(root, selector);
			if (scroller !== null) {
				this.scrollOffsets.set(selector, scroller.scrollTop);
			}
		}
		const disclosures = root.querySelectorAll<HTMLDetailsElement>(
			`details[${DISCLOSURE_KEY_ATTRIBUTE}]`,
		);
		for (const details of Array.from(disclosures)) {
			const key = details.getAttribute(DISCLOSURE_KEY_ATTRIBUTE);
			if (key !== null) this.disclosures.set(key, details.open);
		}
	}

	/**
	 * Reapplies the captured offsets. Call this only once the rebuild is complete:
	 * a scroller measured against a half-built layout clamps to the wrong height.
	 */
	restore(root: HTMLElement): void {
		for (const selector of this.scrollSelectors) {
			const scroller = this.resolveScroller(root, selector);
			if (scroller === null) continue;
			scroller.scrollTop = this.scrollOffsets.get(selector) ?? 0;
			// Read back, because a rebuild with less content clamps the offset and
			// remembering the taller value would fight the next restore.
			this.scrollOffsets.set(selector, scroller.scrollTop);
		}
	}

	/** Scrolls one item just into view, and records the offset that resulted. */
	reveal(root: HTMLElement, selector: string, itemSelector: string): void {
		const scroller = this.resolveScroller(root, selector);
		const item = scroller?.querySelector<HTMLElement>(itemSelector) ?? null;
		if (scroller === null || item === null) return;
		const viewport = scroller.getBoundingClientRect();
		const bounds = item.getBoundingClientRect();
		scroller.scrollTop = scrollOffsetRevealing({
			scrollTop: scroller.scrollTop,
			viewportStart: viewport.top,
			viewportEnd: viewport.bottom,
			itemStart: bounds.top,
			itemEnd: bounds.bottom,
		});
		this.scrollOffsets.set(selector, scroller.scrollTop);
	}

	/**
	 * Creates a `<details>` whose open state outlives the next rebuild. Without a
	 * remembered key a disclosure snaps shut the moment a refresh lands, taking
	 * the reader's place in the panel with it.
	 */
	createDisclosure(
		parent: HTMLElement,
		key: string,
		cls: string,
		defaultOpen = false,
	): HTMLDetailsElement {
		const details = parent.createEl('details', {
			cls,
			attr: { [DISCLOSURE_KEY_ATTRIBUTE]: key },
		});
		details.open = this.disclosures.get(key) ?? defaultOpen;
		return details;
	}

	/** Drops one scroller's offset, so its rebuilt content starts at the top. */
	resetScroll(selector: string): void {
		this.scrollOffsets.delete(selector);
	}

	/** Drops everything, so the next render starts fresh. */
	clear(): void {
		this.scrollOffsets.clear();
		this.disclosures.clear();
	}

	/**
	 * A view's own container can be the scroller, as it is for a modal whose
	 * `.modal-content` scrolls, so a selector has to be able to match the root
	 * itself and not only its descendants.
	 */
	private resolveScroller(
		root: HTMLElement,
		selector: string,
	): HTMLElement | null {
		return root.matches(selector)
			? root
			: root.querySelector<HTMLElement>(selector);
	}
}
