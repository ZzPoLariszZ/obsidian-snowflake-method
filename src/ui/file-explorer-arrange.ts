/**
 * Arrange mode in the file explorer: while it is on, a row dragged among its
 * siblings lands where the pointer says, and Obsidian's own drag, which
 * would move the file into a folder, is never let begin. The listeners sit
 * on the explorer's container in the capture phase, ahead of the rows'
 * own, and are taken away the moment the mode ends, so outside the mode
 * the explorer drags exactly as it always did.
 *
 * The rows the mode reaches wear a grip in the slot a folder's chevron
 * uses, which stands in the row's left gutter outside its flow, so no row
 * grows and nothing on the row moves. The rows it does not reach, and
 * while a row is held every row that is not a sibling it may land beside,
 * step back into placeholders that keep their place and take no pointer,
 * so there is no landing where a landing would mean nothing. A held row
 * lands by the rows it may land beside, and the placeholders among its
 * siblings keep their places in the order that is written.
 *
 * Every drag has a twin that needs no drag: the grip opens the move menu,
 * which is also the only way on a touch screen, where a drag never fires.
 * The grips come and go with the mode.
 */

import { setIcon, setTooltip, type KeymapEventHandler, type Scope } from 'obsidian';

import type { ExplorerItemShape } from './file-explorer-shapes';
import { dropIndexAt } from './task-board-rows';

export const EXPLORER_DRAG_TYPE = 'application/x-snowflake-method-explorer-order';
export const DROP_ATTRIBUTE = 'data-snowflake-method-drop';
const ARRANGING_CLASS = 'snowflake-method-explorer-arranging';
const DRAG_CLASS = 'snowflake-method-explorer-drag';
const DRAGGING_CLASS = 'snowflake-method-explorer-dragging';
/** A row the mode reaches: it floats, wears a grip and can be dragged. */
const ROW_CLASS = 'snowflake-method-explorer-row';
/** While a row is held, the rows it may land beside, itself among them. */
const SIBLING_CLASS = 'snowflake-method-explorer-sibling';
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
	/** Every entry of the item's folder, itself and the tidy view's hidden ones included, in the order shown. */
	siblingsOf(item: ExplorerItemShape): ExplorerItemShape[];
	/** Whether the mode reaches an entry: it can be dragged, and a held sibling can land beside it. */
	reaches(item: ExplorerItemShape): boolean;
	rowBounds(el: HTMLElement): RowBounds;
	commit(item: ExplorerItemShape, siblings: ExplorerItemShape[], insertAt: number): void;
	/** Opens the move menu for a row, under the grip that asked for it. */
	openMenu(item: ExplorerItemShape, anchor: HTMLElement): void;
	/** Told when a drag began on an entry the mode does not reach. */
	refuse(): void;
	gripLabel: string;
	onExit(): void;
}

interface Drag {
	item: ExplorerItemShape;
	/** Every entry of the folder, hidden ones too, in the order the landing is named in. */
	siblings: ExplorerItemShape[];
	/** The siblings the held row may land beside, itself among them. */
	landable: ExplorerItemShape[];
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

	/** Marks every rendered row the mode reaches and gives it its grip; the rest are left plain. */
	decorate(): void {
		if (!this.active) return;
		for (const row of Array.from(this.deps.container.querySelectorAll<HTMLElement>(ROW_SELECTOR))) {
			const item = this.deps.itemAt(row);
			const reached = item !== null && this.deps.reaches(item);
			row.toggleClass(ROW_CLASS, reached);
			const existing = row.querySelector<HTMLElement>(`.${GRIP_CLASS}`);
			if (!reached) {
				if (existing !== null) {
					existing.remove();
					this.grips.delete(existing);
				}
				continue;
			}
			if (existing !== null) continue;
			// In the chevron's slot: a tree item icon stands in the gutter
			// outside the row's flow, so the row keeps its height and its tag.
			const grip = row.createDiv({
				cls: `tree-item-icon ${GRIP_CLASS}`,
				attr: { role: 'button', tabindex: '0', 'aria-label': this.deps.gripLabel },
			});
			row.insertBefore(grip, row.children[0] ?? null);
			setIcon(grip, 'grip-vertical');
			setTooltip(grip, this.deps.gripLabel);
			const open = (event: Event): void => {
				event.preventDefault();
				event.stopPropagation();
				const target = this.deps.itemAt(row);
				if (target !== null) this.deps.openMenu(target, grip);
			};
			grip.addEventListener('click', open);
			grip.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' || event.key === ' ') open(event);
			});
			this.grips.add(grip);
		}
	}

	private undecorate(): void {
		for (const grip of this.grips) grip.remove();
		this.grips.clear();
		for (const row of Array.from(this.deps.container.querySelectorAll<HTMLElement>(ROW_SELECTOR))) {
			row.removeClass(ROW_CLASS);
		}
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
		if (!this.deps.reaches(item)) {
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
		const siblings = this.deps.siblingsOf(item);
		const landable = siblings.filter((sibling) => this.deps.reaches(sibling));
		this.drag = { item, siblings, landable, rendered: null, midpoints: null, band: null };
		for (const sibling of landable) sibling.selfEl.addClass(SIBLING_CLASS);
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
	 * siblings it may land beside, other than itself, by the middles of
	 * their title rows, so a pointer over an opened folder's children lands
	 * below that folder. Nowhere, when the pointer is above the first of
	 * them or below the last, the dragged one counted. The place is named
	 * in the whole folder's order, so the placeholders between keep theirs.
	 */
	landingAt(y: number): ArrangeLanding | null {
		const drag = this.drag;
		if (drag === null) return null;
		if (drag.rendered === null || drag.midpoints === null || drag.band === null) {
			const shown = drag.landable.filter((sibling) => sibling.el.isConnected);
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
		if (this.drag !== null) {
			this.drag.item.selfEl.removeClass(DRAGGING_CLASS);
			for (const sibling of this.drag.landable) sibling.selfEl.removeClass(SIBLING_CLASS);
		}
		this.drag = null;
		this.deps.container.removeClass(DRAG_CLASS);
	}
}
