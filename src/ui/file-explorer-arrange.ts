/**
 * Arrange mode in the file explorer: while it is on, a row dragged among its
 * siblings lands where the pointer says, and Obsidian's own drag, which
 * would move the file into a folder, is never let begin. The listeners sit
 * on the explorer's container in the capture phase, ahead of the rows'
 * own, and are taken away the moment the mode ends, so outside the mode
 * the explorer drags exactly as it always did.
 *
 * Every drag has a twin that needs no drag: a grip on each row opens the
 * move menu, which is also the only way on a touch screen, where a drag
 * never fires. The grips come and go with the mode.
 */

import { setIcon, setTooltip, type KeymapEventHandler, type Scope } from 'obsidian';

import type { ExplorerItemShape } from './file-explorer-shapes';
import { dropIndexAt } from './task-board-rows';

export const EXPLORER_DRAG_TYPE = 'application/x-snowflake-method-explorer-order';
export const DROP_ATTRIBUTE = 'data-snowflake-method-drop';
const ARRANGING_CLASS = 'snowflake-method-explorer-arranging';
const DRAG_CLASS = 'snowflake-method-explorer-drag';
const DRAGGING_CLASS = 'snowflake-method-explorer-dragging';
const GRIP_CLASS = 'snowflake-method-explorer-grip';
const ROW_SELECTOR = '.tree-item-self';
/** How far past the siblings' rows the pointer may stray and still land among them. */
const BAND_SLACK = 6;

export interface RowBounds {
	top: number;
	bottom: number;
}

export interface ArrangeLanding {
	/** Where the dragged entry goes, counted among every sibling with itself still in place. */
	insertAt: number;
	/** The rendered sibling the line is drawn against, and which side of it. */
	row: ExplorerItemShape;
	side: 'before' | 'after';
}

export interface ArrangeDeps {
	/** The explorer's own scroller, `.nav-files-container`. */
	container: HTMLElement;
	/**
	 * The app's global keymap scope, where Escape is heard only once nothing
	 * nearer has taken it: a menu, a dialog or the rename box each stand
	 * above it and keep the key for themselves.
	 */
	scope: Scope;
	itemAt(target: EventTarget | null): ExplorerItemShape | null;
	/** Every entry the explorer lists beside the item, itself included, in the order shown. */
	siblingsOf(item: ExplorerItemShape): ExplorerItemShape[];
	inScope(item: ExplorerItemShape): boolean;
	rowBounds(el: HTMLElement): RowBounds;
	commit(item: ExplorerItemShape, siblings: ExplorerItemShape[], insertAt: number): void;
	openMenu(item: ExplorerItemShape, event: MouseEvent): void;
	/** Told when a drag began on an entry the mode does not reach. */
	refuse(): void;
	gripLabel: string;
	onExit(): void;
}

interface Drag {
	item: ExplorerItemShape;
	siblings: ExplorerItemShape[];
	rendered: ExplorerItemShape[] | null;
	midpoints: number[] | null;
	band: RowBounds | null;
}

const TYPING_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

export class ArrangeController {
	active = false;
	private drag: Drag | null = null;
	private marked: HTMLElement | null = null;
	private escape: KeymapEventHandler | null = null;
	private readonly grips = new Set<HTMLElement>();
	private readonly removers: (() => void)[] = [];

	constructor(private readonly deps: ArrangeDeps) {}

	enter(): void {
		if (this.active) return;
		this.active = true;
		const { container } = this.deps;
		container.addClass(ARRANGING_CLASS);
		this.listen(container, 'dragstart', (event) => this.onDragStart(event as DragEvent));
		this.listen(container, 'dragover', (event) => this.onDragOver(event as DragEvent));
		this.listen(container, 'dragenter', (event) => this.onDragOver(event as DragEvent));
		this.listen(container, 'drop', (event) => this.onDrop(event as DragEvent));
		this.listen(container, 'dragend', () => this.clear());
		this.listen(container, 'scroll', () => {
			if (this.drag !== null) {
				this.drag.rendered = null;
				this.drag.midpoints = null;
				this.drag.band = null;
			}
		});
		this.escape = this.deps.scope.register([], 'Escape', (event) => this.onEscape(event));
		this.decorate();
	}

	exit(): void {
		if (!this.active) return;
		this.active = false;
		this.clear();
		for (const remove of this.removers.splice(0)) remove();
		if (this.escape !== null) {
			this.deps.scope.unregister(this.escape);
			this.escape = null;
		}
		this.undecorate();
		this.deps.container.removeClass(ARRANGING_CLASS);
	}

	/** Gives every rendered row the mode reaches its grip, and takes it from the rest. */
	decorate(): void {
		if (!this.active) return;
		for (const row of Array.from(this.deps.container.querySelectorAll<HTMLElement>(ROW_SELECTOR))) {
			const item = this.deps.itemAt(row);
			const existing = row.querySelector<HTMLElement>(`.${GRIP_CLASS}`);
			if (item === null || !this.deps.inScope(item)) {
				if (existing !== null) {
					existing.remove();
					this.grips.delete(existing);
				}
				continue;
			}
			if (existing !== null) continue;
			const grip = row.createEl('button', {
				cls: `clickable-icon ${GRIP_CLASS}`,
				attr: { type: 'button', 'aria-label': this.deps.gripLabel },
			});
			setIcon(grip, 'grip-vertical');
			setTooltip(grip, this.deps.gripLabel);
			grip.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				const target = this.deps.itemAt(row);
				if (target !== null) this.deps.openMenu(target, event);
			});
			this.grips.add(grip);
		}
	}

	private undecorate(): void {
		for (const grip of this.grips) grip.remove();
		this.grips.clear();
	}

	private listen(
		target: { addEventListener: (type: string, listener: (event: Event) => void, capture?: boolean) => void; removeEventListener: (type: string, listener: (event: Event) => void, capture?: boolean) => void },
		type: string,
		listener: (event: Event) => void,
	): void {
		target.addEventListener(type, listener, true);
		this.removers.push(() => target.removeEventListener(type, listener, true));
	}

	private onDragStart(event: DragEvent): void {
		const item = this.deps.itemAt(event.target);
		if (item === null) return;
		if (!this.deps.inScope(item)) {
			event.preventDefault();
			this.deps.refuse();
			return;
		}
		// Obsidian's own listener on the row would start a file move; it
		// never hears this one.
		event.stopPropagation();
		const transfer = event.dataTransfer;
		if (transfer !== null) {
			transfer.effectAllowed = 'move';
			transfer.setData(EXPLORER_DRAG_TYPE, item.file.path);
		}
		this.drag = { item, siblings: this.deps.siblingsOf(item), rendered: null, midpoints: null, band: null };
		item.selfEl.addClass(DRAGGING_CLASS);
		this.deps.container.addClass(DRAG_CLASS);
	}

	private onDragOver(event: DragEvent): void {
		if (this.drag === null) return;
		event.stopPropagation();
		const landing = this.landingAt(event.clientY);
		if (landing === null) {
			this.mark(null);
			if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'none';
			return;
		}
		event.preventDefault();
		if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move';
		this.mark(landing);
	}

	private onDrop(event: DragEvent): void {
		const drag = this.drag;
		if (drag === null) return;
		event.stopPropagation();
		event.preventDefault();
		const landing = this.landingAt(event.clientY);
		this.clear();
		if (landing === null) return;
		this.deps.commit(drag.item, drag.siblings, landing.insertAt);
	}

	/** Escape leaves the mode, unless a drag is under way or a field is being typed in. */
	private onEscape(event: KeyboardEvent): boolean | void {
		if (this.drag !== null) return;
		const node = event.target as { closest?: (selector: string) => unknown } | null;
		if (typeof node?.closest === 'function' && node.closest(TYPING_SELECTOR)) return;
		this.deps.onExit();
		return false;
	}

	/**
	 * Where the pointer would set the entry down: among the rendered
	 * siblings other than itself, by the middles of their title rows, so a
	 * pointer over an opened folder's children lands below that folder.
	 * Nowhere, when the pointer is above the first sibling or below the
	 * last, the dragged one counted.
	 */
	landingAt(y: number): ArrangeLanding | null {
		const drag = this.drag;
		if (drag === null) return null;
		if (drag.rendered === null || drag.midpoints === null || drag.band === null) {
			const shown = drag.siblings.filter((sibling) => sibling.el.isConnected);
			const rendered = shown.filter((sibling) => sibling !== drag.item);
			const first = shown[0];
			const last = shown[shown.length - 1];
			if (rendered.length === 0 || first === undefined || last === undefined) return null;
			drag.rendered = rendered;
			drag.midpoints = rendered.map((sibling) => {
				const bounds = this.deps.rowBounds(sibling.selfEl);
				return (bounds.top + bounds.bottom) / 2;
			});
			drag.band = {
				top: this.deps.rowBounds(first.selfEl).top - BAND_SLACK,
				bottom: this.deps.rowBounds(last.el).bottom + BAND_SLACK,
			};
		}
		if (y < drag.band.top || y > drag.band.bottom) return null;
		const at = dropIndexAt(drag.midpoints, y);
		const rendered = drag.rendered;
		if (at < rendered.length) {
			const row = rendered[at];
			if (row === undefined) return null;
			return { insertAt: drag.siblings.indexOf(row), row, side: 'before' };
		}
		const row = rendered[rendered.length - 1];
		if (row === undefined) return null;
		return { insertAt: drag.siblings.indexOf(row) + 1, row, side: 'after' };
	}

	private mark(landing: ArrangeLanding | null): void {
		const target = landing === null ? null : landing.row.el;
		if (this.marked !== null && this.marked !== target) {
			this.marked.removeAttribute(DROP_ATTRIBUTE);
		}
		this.marked = target;
		if (landing !== null) landing.row.el.setAttribute(DROP_ATTRIBUTE, landing.side);
	}

	private clear(): void {
		this.mark(null);
		if (this.drag !== null) this.drag.item.selfEl.removeClass(DRAGGING_CLASS);
		this.drag = null;
		this.deps.container.removeClass(DRAG_CLASS);
	}
}
