import { AbstractInputSuggest, App } from 'obsidian';

/** Marks every suggestion list this plugin puts under a field. */
export const SUGGESTIONS_CLASS = 'snowflake-method-suggestions';

/**
 * What every suggestion list in this plugin has in common, whatever it lists.
 *
 * The framework places and sizes its popover from the element it is attached to,
 * which is the text box — inset from the control's frame by whatever padding
 * that box carries, and as wide as whichever entry happens to be longest. Left
 * alone, two lists under two identically sized controls come out different
 * widths and neither lines up with the control it belongs to.
 *
 * It also places the popover once and never revisits it, so a window resized
 * underneath leaves the list sitting where the control used to be — pointing at
 * nothing, and still taking the next thing typed.
 */
export abstract class FieldSuggest<T> extends AbstractInputSuggest<T> {
	/** Tears down the watch on a list that is showing. Null when none is. */
	private releaseLayoutWatch: (() => void) | null = null;

	protected constructor(
		app: App,
		protected readonly inputEl: HTMLInputElement,
		/**
		 * The control the list hangs off — the frame around the text box rather
		 * than the box itself, since that frame is what the reader sees as the
		 * field and what the list has to line up with.
		 */
		protected readonly fieldEl: HTMLElement,
	) {
		super(app, inputEl);
		// Every list here answers a question with a finite, knowable answer —
		// every folder in the vault, every character in the project — so a cap on
		// the rows rendered leaves some of them out with nothing on screen to say
		// so, and the one entry the author is hunting for is as likely as any
		// other to be the one dropped. Typing is what shortens these lists.
		this.limit = 0;
	}

	open(): void {
		super.open();
		this.matchPopoverToField();
		this.watchLayout();
	}

	close(): void {
		super.close();
		this.releasePopover();
		this.stopWatchingLayout();
	}

	/** Closes for good, for a field that is going away. */
	destroy(): void {
		this.close();
		this.stopWatchingLayout();
	}

	/**
	 * Squares the popover up with the control: its width, and its left edge.
	 *
	 * The left edge is nudged by the measured difference rather than assigned
	 * outright, so it keeps whatever coordinate space the framework placed the
	 * popover in.
	 *
	 * `suggestEl` is not in the published API, so this adjusts the popover only
	 * when it is there and otherwise leaves the framework's own placement alone.
	 */
	protected matchPopoverToField(): void {
		const suggestEl = this.popoverEl();
		if (suggestEl === null) return;
		suggestEl.addClass(SUGGESTIONS_CLASS);
		suggestEl.style.width = `${this.fieldEl.offsetWidth}px`;
		const drift =
			this.fieldEl.getBoundingClientRect().left -
			suggestEl.getBoundingClientRect().left;
		if (drift === 0) return;
		const placed = Number.parseFloat(suggestEl.style.left);
		if (Number.isNaN(placed)) return;
		suggestEl.style.left = `${placed + drift}px`;
	}

	/** Undoes the sizing, in case the popover is one the framework hands round. */
	protected releasePopover(): void {
		const suggestEl = this.popoverEl();
		if (suggestEl === null) return;
		suggestEl.removeClass(SUGGESTIONS_CLASS);
		suggestEl.style.removeProperty('width');
	}

	protected popoverEl(): HTMLElement | null {
		const { suggestEl } = this as unknown as { suggestEl?: HTMLElement };
		return suggestEl ?? null;
	}

	/**
	 * Dismisses a list once the field it belongs to has moved.
	 *
	 * Dismissed rather than moved: where the list goes is the framework's
	 * decision, made from the room above and below the field, and second-guessing
	 * it from here would only be right until it changed its mind.
	 *
	 * Both the window resizing and the field itself changing size are watched, so
	 * dragging a pane divider or folding a sidebar counts too — the window keeps
	 * its size through those, but the field does not keep its place.
	 */
	private watchLayout(): void {
		if (this.releaseLayoutWatch !== null) return;
		const view = this.inputEl.ownerDocument.defaultView;
		if (view === null) return;
		const dismiss = (): void => this.close();
		view.addEventListener('resize', dismiss);
		// Every observation opens with a callback reporting the size the field
		// already had. That one is told apart by the size it reports rather than
		// by being counted, because when the window is not painting it can arrive
		// arbitrarily late — after a real change, which a counter would then
		// mistake for the opening one and swallow.
		const opened = this.fieldEl.getBoundingClientRect();
		const observer = new view.ResizeObserver(() => {
			const now = this.fieldEl.getBoundingClientRect();
			if (now.width === opened.width && now.height === opened.height) return;
			dismiss();
		});
		observer.observe(this.fieldEl);
		this.releaseLayoutWatch = () => {
			view.removeEventListener('resize', dismiss);
			observer.disconnect();
		};
	}

	protected stopWatchingLayout(): void {
		this.releaseLayoutWatch?.();
		this.releaseLayoutWatch = null;
	}
}
