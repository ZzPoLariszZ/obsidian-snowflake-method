import { setIcon, setTooltip, type TooltipPlacement } from 'obsidian';

import type { ContentsRow } from './contents-hub';
import type { Translate } from './modals';

/** What the wheel is turned to: the chapters, the one the page stands in, and how far it shows. */
export interface ContentsWheelModel {
	/** Every chapter, in reading order; the same array while nothing in it changed. */
	rows: readonly ContentsRow[];
	/** The chapter the page stands in. */
	active: string | null;
	/** How many chapters show on either side of the one in the middle. */
	reach: number;
	/**
	 * Whether the chapters may be renamed and deleted. A manuscript that may
	 * not be written to offers neither, so its rows keep no menu, no keys
	 * and no dots. Left out, they may.
	 */
	editable?: boolean;
}

export interface ContentsWheelDeps {
	t: Translate;
	/** Brings a chapter's start to the top of the page. */
	go(path: string): void;
	/** Whether the plugin holds its animations still. The system's own wish is read here. */
	still(): boolean;
	/** Hands the keys back to the page, for an Escape pressed on the wheel. */
	leave?(): void;
	/**
	 * What a row offers besides the way to its chapter: its menu, for a
	 * right-click, a long press or the menu key, and the two keys the file
	 * explorer gives a file, F2 to rename and Delete to delete. Left out,
	 * rows offer none of them.
	 */
	menu?(path: string, event: MouseEvent): void;
	rename?(path: string): void;
	remove?(path: string): void;
	/**
	 * Whether a pointer can rest over a row, which is where the dots that
	 * say a row has a menu are shown. Read off the window unless a test
	 * says: a screen with no pointer to wait for shows them on the page's
	 * chapter instead.
	 */
	hovers?: boolean;
	/** The side a clipped name's tooltip opens on: away from the wheel's own column. */
	tooltip?: TooltipPlacement;
	/** How long a wheel a finger turned is let alone before it goes back; the default unless a test shortens it. */
	rest?: number;
	/** How long the wheel stands still before it is looked at; the default unless a test shortens it. */
	quiet?: number;
}

export interface ContentsWheel {
	readonly el: HTMLElement;
	/** Brings the wheel level with the manuscript. */
	sync(model: ContentsWheelModel): void;
	/**
	 * Called when the wheel is shown or its box has changed: a wheel that
	 * stood hidden has no place of its own, and is stood on the page's
	 * chapter without a glide.
	 */
	settle(): void;
	/**
	 * The chapter whose row holds the keys, or null while none does. For a
	 * key the app takes before the wheel can hear it: F2 is the app's own
	 * rename, read at the window, and reaches a row only through the scope
	 * of the view the wheel stands in.
	 */
	held(): string | null;
	dispose(): void;
}

/**
 * How long a wheel turned by a finger waits before it goes back to the
 * page's chapter: a finger has no way of leaving the wheel as a pointer
 * does, so the wheel is given back once it has been let alone this long.
 */
export const CONTENTS_REST_MS = 4000;

/**
 * How long the wheel must have stood still before it is looked at: no turn
 * of the mouse wheel, no finger, no scroll. A trackpad's flick goes on
 * turning the wheel for a second after the fingers have lifted, often after
 * the pointer has gone too, and after any turn the browser takes a moment to
 * bring a row to rest. A glide back begun while either is still running is
 * fought and lost: the wheel went home and was carried straight back to the
 * end it had been flicked to.
 */
export const CONTENTS_QUIET_MS = 160;

/** How many times running a wheel found off the page's chapter is sent back, before it is left where it is. */
const CONTENTS_SENDS = 3;

/** The rows the wheel shows at once: the one in the middle and the reach either side. */
export const contentsRows = (reach: number): number =>
	2 * Math.max(0, Math.floor(reach)) + 1;

/** Whether the system asks for less motion, where the window can say. */
const systemStill = (win: Window): boolean =>
	typeof win.matchMedia === 'function' &&
	win.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** How many wheels have been drawn, so each one's name has an id of its own. */
let drawn = 0;

/** Whether the window's pointer is one that can rest over things: a mouse, not a finger. */
const systemHovers = (win: Window): boolean =>
	typeof win.matchMedia !== 'function' || win.matchMedia('(hover: hover)').matches;

/**
 * The manuscript's chapters as a wheel: one row a chapter in a column that
 * scrolls on its own and brings a row to rest in its middle. The row in the
 * middle is drawn at full strength and the rows either side step back with
 * their distance, which the stylesheet does from each row's own place in
 * the column, so nothing here runs per frame.
 *
 * The wheel follows the page: the chapter the page stands in is marked, and
 * the wheel glides to it as the reader moves through the book. Turned by
 * hand, with the mouse wheel, a finger or the arrow keys, it only browses:
 * the page stays where it is until a row is pressed, and the wheel goes
 * back to the page's chapter when the pointer and the keys have left it
 * and it has come to rest. At rest and out of the reader's hand, it stands
 * on the page's chapter: whatever leaves it elsewhere is put right.
 *
 * To a keyboard it is one stop, the arrows walking the rows from there, and
 * to a screen reader a navigation landmark holding a list of buttons, the
 * page's chapter marked as the current one.
 */
export function renderContentsWheel(
	host: HTMLElement,
	deps: ContentsWheelDeps,
): ContentsWheel {
	const nav = host.createEl('nav', { cls: 'snowflake-method-contents-wheel' });
	// Named by words of its own, out of sight, and not by a label. The app
	// shows a label as a tooltip to a pointer resting on anything inside
	// the element that carries it, so a labelled wheel said "Contents"
	// under every name the pointer stopped at.
	drawn += 1;
	const name = nav.createSpan({
		cls: 'snowflake-method-contents-unseen',
		text: deps.t('contents.viewTitle'),
		attr: { id: `snowflake-method-contents-name-${String(drawn)}` },
	});
	nav.setAttribute('aria-labelledby', name.id);
	// Named a list outright: a list with no markers is not always read as one.
	const list = nav.createEl('ul', {
		cls: 'snowflake-method-contents-list',
		attr: { role: 'list' },
	});
	let rows: readonly ContentsRow[] = [];
	let items: HTMLButtonElement[] = [];
	const places = new Map<string, number>();
	let active: string | null = null;
	let reach = -1;
	/** The row wearing the page's mark. */
	let marked = -1;
	/** The row the Tab key stops at. */
	let stop = -1;
	/** Whether the reader is turning the wheel by hand. */
	let hand = false;
	/** Whether a mouse or pen is over the wheel. */
	let inside = false;
	/** Whether the pointer has left the wheel since it last came to it. */
	let departed = false;
	/**
	 * How long the wheel is to stand still before it is given back, while the
	 * reader has let go of it: a moment for a pointer or the keys that have
	 * left, the finger's rest for a finger. Null while the reader holds it.
	 */
	let owed: number | null = null;
	/** The look owed once the wheel has stood still. */
	let look: number | null = null;
	/** How many times running the wheel was found off the page's chapter and sent back. */
	let sent = 0;
	/** One row's height, measured when first asked for and after every change of box. */
	let pitch: number | null = null;
	/** The names already checked for a tooltip, so a row is measured once at each width of the wheel. */
	let tipped = new WeakSet<HTMLElement>();

	const still = (): boolean => deps.still() || systemStill(nav.win);

	const activeIndex = (): number =>
		active === null ? -1 : (places.get(active) ?? -1);

	/**
	 * A row's height, from where the first and the last row stand: the
	 * difference over the rows between them is exact to a fraction of a
	 * pixel, where one row's own height rounds, and the rounding of a
	 * thousand rows is a wheel that stops a chapter short. Zero while the
	 * wheel is hidden and nothing has a place.
	 */
	const rowPitch = (): number => {
		if (pitch !== null) return pitch;
		const first = items[0]?.parentElement;
		const last = items[items.length - 1]?.parentElement;
		if (first == null || last == null) return 0;
		const height =
			items.length > 1
				? (last.getBoundingClientRect().top - first.getBoundingClientRect().top) /
					(items.length - 1)
				: first.getBoundingClientRect().height;
		if (height > 0) pitch = height;
		return height;
	};

	/**
	 * Brings one row to the middle of the wheel, gliding unless told
	 * otherwise. A row further off than the wheel shows at once is not
	 * glided to all the way: across a long book that is seconds of rows
	 * flying past. The wheel is stood one wheelful short of the row, on the
	 * side it comes from, and glides the rest, so the move still reads as
	 * a turn and which way it went.
	 */
	const centre = (at: number, instant = false): void => {
		if (at < 0 || at >= items.length) return;
		const height = rowPitch();
		if (height <= 0) return;
		const top = at * height;
		const from = list.scrollTop;
		if (Math.abs(from - top) < 1) return;
		if (typeof list.scrollTo !== 'function') {
			list.scrollTop = top;
			return;
		}
		if (instant || still()) {
			list.scrollTo({ top, behavior: 'instant' });
			return;
		}
		const run = contentsRows(reach) * height;
		if (Math.abs(from - top) > run) {
			list.scrollTo({ top: top + (from < top ? -run : run), behavior: 'instant' });
		}
		list.scrollTo({ top, behavior: 'smooth' });
	};

	const quiet = (): number => deps.quiet ?? CONTENTS_QUIET_MS;

	const disarm = (): void => {
		if (look === null) return;
		nav.win.clearTimeout(look);
		look = null;
	};

	const holdsFocus = (): boolean => {
		const focused = nav.doc.activeElement;
		return focused !== null && nav.contains(focused);
	};

	/** The one stop the Tab key makes in the wheel, moved to a row. */
	const stopAt = (at: number): void => {
		if (stop === at) return;
		items[stop]?.setAttribute('tabindex', '-1');
		stop = at;
		items[stop]?.setAttribute('tabindex', '0');
	};

	/** The page's mark moved to its chapter, and the Tab stop with it unless a row is in hand. */
	const mark = (): void => {
		const at = activeIndex();
		if (marked !== at) {
			const was = items[marked];
			was?.removeClass('is-active');
			was?.removeAttribute('aria-current');
			marked = at;
			const now = items[marked];
			now?.addClass('is-active');
			now?.setAttribute('aria-current', 'true');
		}
		if (!holdsFocus()) stopAt(at >= 0 ? at : items.length > 0 ? 0 : -1);
	};

	/**
	 * Whether the wheel stands on a row: its middle nearer that row than any
	 * other, which is where the browser brings it to rest. A hidden wheel
	 * has nowhere to stand and nothing to put right.
	 */
	const standsOn = (at: number): boolean => {
		const height = rowPitch();
		return height <= 0 || Math.abs(list.scrollTop - at * height) < height / 2;
	};

	/**
	 * The look taken once the wheel has stood still.
	 *
	 * A wheel the reader has let go of is given back to the page here, and
	 * only here: not at the moment the pointer leaves, when a flick may still
	 * be running, but once nothing has moved the wheel for a moment.
	 *
	 * A wheel that is the page's and has come to rest off the page's chapter
	 * is sent back to it, whatever moved it: a turn that outran a glide, the
	 * browser settling on another row. A few times running at most, so a
	 * wheel that will not stay is left alone rather than chased.
	 */
	const atRest = (): void => {
		look = null;
		if (hand) {
			// A pointer back over the wheel, or a row holding the keys, keeps
			// it: leaving again is what asks again.
			if (inside || holdsFocus()) {
				owed = null;
				return;
			}
			hand = false;
			owed = null;
			sent = 0;
			centre(activeIndex());
			return;
		}
		const at = activeIndex();
		if (at < 0 || standsOn(at)) {
			sent = 0;
			return;
		}
		if (sent >= CONTENTS_SENDS) return;
		sent += 1;
		centre(at);
	};

	/**
	 * Asks for that look once the wheel has stood still, and is asked again
	 * by everything that moves the wheel meanwhile, so the look always comes
	 * a moment after the last movement. No look is owed while the reader
	 * holds the wheel.
	 */
	const arm = (): void => {
		disarm();
		const wait = hand ? owed : quiet();
		if (wait === null) return;
		look = nav.win.setTimeout(atRest, wait);
	};

	/** The reader has taken the wheel: it follows the hand until it is let go. */
	const take = (): void => {
		hand = true;
		sent = 0;
	};

	/** The reader has let go: the wheel is given back once it has stood still this long. */
	const release = (wait: number): void => {
		if (!hand) return;
		owed = wait;
		arm();
	};

	/** Whether a pointer's event happened over the wheel. */
	const within = (event: MouseEvent): boolean => {
		const box = nav.getBoundingClientRect();
		return (
			event.clientX >= box.left &&
			event.clientX <= box.right &&
			event.clientY >= box.top &&
			event.clientY <= box.bottom
		);
	};

	/** A mouse or pen known to be over the wheel: the reader holds it for as long as it stays. */
	const came = (): void => {
		inside = true;
		departed = false;
		if (!hand) return;
		owed = null;
		disarm();
	};

	const rowOf = (target: EventTarget | null): number => {
		if (target === null || !(target as Node).instanceOf(HTMLElement)) return -1;
		const button = (target as HTMLElement).closest<HTMLButtonElement>(
			'.snowflake-method-contents-item',
		);
		return button === null ? -1 : items.indexOf(button);
	};

	/** The row something stands in: its name, or the dots beside it. */
	const rowAround = (target: EventTarget | null): number => {
		if (target === null || !(target as Node).instanceOf(HTMLElement)) return -1;
		const line = (target as HTMLElement).closest('.snowflake-method-contents-row');
		const button = line?.firstElementChild ?? null;
		return button === null ? -1 : items.findIndex((item) => item === button);
	};

	/** Whether rows offer their menu and their keys: asked for, in a manuscript that may be written to. */
	let editable = true;
	const acts = (): boolean => editable && deps.menu !== undefined;
	const hovers = (): boolean => deps.hovers ?? systemHovers(nav.win);

	/**
	 * The dots: a row's quiet sign that it offers more than the way to its
	 * chapter, and a press on them opens what a right-click on the name
	 * opens. One set for the whole wheel, stood in the row under the
	 * pointer, since a set for every row of a long book would be fifteen
	 * hundred buttons to say one thing. They are named for a screen reader
	 * in words of their own and not by a label, which the app would also
	 * say to the eye in a tooltip: the dots are the whole of the hint.
	 */
	const more =
		deps.menu === undefined
			? null
			: createEl('button', {
					cls: 'clickable-icon snowflake-method-contents-more',
					attr: { type: 'button', tabindex: '-1', 'aria-haspopup': 'menu' },
				});
	if (more !== null) {
		setIcon(more, 'ellipsis');
		more.createSpan({
			cls: 'snowflake-method-contents-unseen',
			text: deps.t('table.actions'),
		});
	}

	/** Stands the dots in a row, or takes them off the wheel where there is no such row. */
	const offer = (at: number): void => {
		if (more === null) return;
		const line = acts() ? (items[at]?.parentElement ?? null) : null;
		const from = more.parentElement;
		if (from === line) return;
		from?.removeClass('has-more');
		if (line === null) {
			more.remove();
			return;
		}
		line.addClass('has-more');
		line.appendChild(more);
	};

	/** Where no pointer can rest over a row, the page's chapter keeps the dots. */
	const offerAtRest = (): void => {
		if (!hovers()) offer(activeIndex());
	};

	/** A row pressed: the page goes to its chapter, and the wheel stands on it at once. */
	const choose = (at: number): void => {
		const row = rows[at];
		if (row === undefined) return;
		hand = false;
		owed = null;
		sent = 0;
		// Marked before the page answers: bringing a chapter up takes the
		// page a moment, and the wheel should not wear the old mark for it.
		active = row.path;
		mark();
		stopAt(at);
		centre(at);
		deps.go(row.path);
	};

	const focusRow = (at: number): void => {
		const to = Math.min(items.length - 1, Math.max(0, at));
		const button = items[to];
		if (button === undefined) return;
		take();
		owed = null;
		disarm();
		stopAt(to);
		// The wheel brings the row to its middle itself: the browser's own
		// reveal would scroll the page around it as well.
		button.focus({ preventScroll: true });
		centre(to);
	};

	// A press with the mouse goes to a chapter and leaves the keys where
	// they were, in the words being written or on the page being read: the
	// arrows after it should move the page, not walk the wheel. The Tab key
	// is how the keys come to the wheel.
	list.addEventListener('mousedown', (event) => {
		event.preventDefault();
	});
	// A finger held on a row has asked for its menu, and lifting it is not a
	// press on the row. The lift is the hold's own: its `touchend` is
	// cancelled, so the browser makes no mouse events of it, which the menu
	// would read as a press beside it and close on; and a click that comes
	// of it regardless goes nowhere, so the page stays under the menu.
	let menued = false;
	list.addEventListener('pointerdown', () => {
		menued = false;
	});
	list.addEventListener(
		'touchend',
		(event) => {
			if (menued && event.cancelable) event.preventDefault();
		},
		{ passive: false },
	);
	list.addEventListener('click', (event) => {
		if (menued) {
			menued = false;
			return;
		}
		const pressed = event.target;
		if (
			more !== null &&
			pressed !== null &&
			(pressed as Node).instanceOf(Node) &&
			more.contains(pressed as Node)
		) {
			// The dots: the row's menu, where a press on its name is the way
			// to its chapter.
			const row = rows[rowAround(more)];
			if (row !== undefined && acts()) deps.menu?.(row.path, event);
			return;
		}
		const at = rowOf(event.target);
		if (at >= 0) choose(at);
	});
	list.addEventListener('contextmenu', (event) => {
		const row = rows[rowAround(event.target)];
		if (row === undefined || !acts()) return;
		event.preventDefault();
		menued = true;
		deps.menu?.(row.path, event);
	});
	// The dots follow a pointer that can rest: they stand in the row it is
	// over and leave the wheel with it. A finger's press is not a rest.
	list.addEventListener('pointerover', (event) => {
		if (event.pointerType === 'touch' || !hovers()) return;
		const at = rowAround(event.target);
		if (at >= 0) offer(at);
	});
	list.addEventListener(
		'wheel',
		(event) => {
			take();
			// A pointer that was resting here when the wheel was drawn under it
			// never came in, and the turn says where it is. Not once it has
			// left, though: a flick's turns go on arriving here after the
			// pointer has gone, wherever they say they are.
			if (!inside && !departed && within(event)) inside = true;
			owed = inside ? null : quiet();
			arm();
		},
		{ passive: true },
	);
	// A finger has no way of leaving the wheel as a pointer does: the wheel
	// is given back once it has been let alone for the finger's rest.
	const touched = (): void => {
		take();
		owed = deps.rest ?? CONTENTS_REST_MS;
		arm();
	};
	list.addEventListener('touchstart', touched, { passive: true });
	list.addEventListener('touchmove', touched, { passive: true });
	// Every movement of the wheel puts the look off: a flick running on, the
	// browser bringing a row to rest, the wheel's own glide.
	list.addEventListener('scroll', arm);
	nav.addEventListener('pointerenter', (event) => {
		if (event.pointerType !== 'touch') came();
	});
	// A pointer already here when the wheel was drawn says so by moving.
	nav.addEventListener('pointermove', (event) => {
		if (event.pointerType !== 'touch' && !inside) came();
	});
	nav.addEventListener('pointerleave', (event) => {
		if (event.pointerType === 'touch') return;
		inside = false;
		departed = true;
		if (hovers()) offer(-1);
		if (!holdsFocus()) release(quiet());
	});
	nav.addEventListener('focusout', (event) => {
		const to = event.relatedTarget;
		if (to !== null && (to as Node).instanceOf(Node) && nav.contains(to as Node)) return;
		// The stop goes back to the page's chapter once no row is in hand.
		const at = activeIndex();
		stopAt(at >= 0 ? at : items.length > 0 ? 0 : -1);
		if (!inside) release(quiet());
	});
	list.addEventListener('keydown', (event) => {
		const at = rowOf(event.target);
		if (at < 0) return;
		const row = rows[at];
		if (row !== undefined && !event.isComposing && acts()) {
			// The keys the file explorer gives a file: F2 names it anew, and
			// Delete, or Backspace with the command key, throws it away.
			const command = event.ctrlKey || event.metaKey;
			const bare = !command && !event.altKey && !event.shiftKey;
			if (bare && event.key === 'F2' && deps.rename !== undefined) {
				event.preventDefault();
				deps.rename(row.path);
				return;
			}
			const erase =
				(bare && event.key === 'Delete') ||
				(command && !event.altKey && !event.shiftKey && event.key === 'Backspace');
			if (erase && deps.remove !== undefined) {
				event.preventDefault();
				deps.remove(row.path);
				return;
			}
		}
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const page = Math.max(1, contentsRows(reach) - 1);
		const to =
			event.key === 'ArrowDown'
				? at + 1
				: event.key === 'ArrowUp'
					? at - 1
					: event.key === 'PageDown'
						? at + page
						: event.key === 'PageUp'
							? at - page
							: event.key === 'Home'
								? 0
								: event.key === 'End'
									? items.length - 1
									: null;
		if (to !== null) {
			event.preventDefault();
			focusRow(to);
			return;
		}
		if (event.key === 'Escape' && !event.isComposing && deps.leave !== undefined) {
			event.preventDefault();
			// Given back at once: the keys that held the wheel are leaving it.
			hand = false;
			owed = null;
			sent = 0;
			disarm();
			centre(activeIndex());
			deps.leave();
		}
	});
	// A name the wheel cuts short is said whole under the pointer, measured
	// when the pointer first comes to it: a thousand rows are never measured
	// to draw the wheel.
	list.addEventListener('mouseover', (event) => {
		const button = items[rowOf(event.target)];
		if (button === undefined || tipped.has(button)) return;
		tipped.add(button);
		if (button.scrollWidth <= button.clientWidth) return;
		setTooltip(button, button.textContent ?? '', {
			placement: deps.tooltip ?? 'right',
		});
	});

	/**
	 * Brings the list level with the manuscript's chapters, keeping every
	 * row that still has its chapter. A chapter renamed has its row reworded
	 * where it stands, a chapter added gets a row put in at its place, one
	 * taken away loses its row, and a row whose chapter kept its place is
	 * not touched at all. Drawing a long book's rows afresh costs a tenth of
	 * a second for fifteen hundred chapters, which the wheel pays once, when
	 * it is first drawn, and not again each time a chapter is renamed.
	 */
	const rebuild = (next: readonly ContentsRow[]): void => {
		const focused = holdsFocus() ? rows[stop]?.path : undefined;
		// The marks come off the rows that wore them: a row kept may stand
		// for the same chapter at another place.
		const was = items[marked];
		was?.removeClass('is-active');
		was?.removeAttribute('aria-current');
		items[stop]?.setAttribute('tabindex', '-1');
		// The rows whose chapters have left go first, so the walk below
		// meets only rows that stay.
		const staying = new Set(next.map((row) => row.path));
		const kept = new Map<string, HTMLButtonElement>();
		for (const [at, row] of rows.entries()) {
			const button = items[at];
			if (button === undefined) continue;
			if (staying.has(row.path)) kept.set(row.path, button);
			else button.parentElement?.remove();
		}
		rows = next;
		items = [];
		places.clear();
		marked = -1;
		stop = -1;
		pitch = null;
		// Walked against the rows as they stand: one in its place is left
		// there, and one out of it is carried in front of the row it belongs
		// before. Where the row standing in the way is the one out of place,
		// its neighbour being the one wanted, that row steps to the end to
		// be placed when its turn comes, so a chapter moved down the book
		// moves one row and not every row it passed.
		let cursor = list.firstElementChild;
		for (const [at, row] of rows.entries()) {
			places.set(row.path, at);
			let button = kept.get(row.path);
			if (button === undefined) {
				// Made apart from the list and put in once, at its place.
				button = createEl('li', { cls: 'snowflake-method-contents-row' }).createEl('button', {
					cls: 'snowflake-method-contents-item',
					text: row.title,
					attr: { type: 'button', tabindex: '-1' },
				});
			} else if (button.textContent !== row.title) {
				button.setText(row.title);
				// The old name's tooltip went with the old name.
				button.removeAttribute('aria-label');
				tipped.delete(button);
			}
			items.push(button);
			const line = button.parentElement;
			if (line === null) continue;
			if (cursor !== null && cursor !== line && cursor.nextElementSibling === line) {
				list.appendChild(cursor);
				cursor = line;
			}
			if (line === cursor) cursor = cursor.nextElementSibling;
			else if (line.parentElement !== list || line.nextElementSibling !== cursor) {
				list.insertBefore(line, cursor);
			}
		}
		// A row in hand keeps the keys where its chapter is still in the
		// book, and takes them back if being moved cost it them.
		const held = focused === undefined ? undefined : places.get(focused);
		if (held !== undefined) {
			stopAt(held);
			if (!holdsFocus()) items[held]?.focus({ preventScroll: true });
		}
	};

	return {
		el: nav,
		sync: (model) => {
			const redrawn = model.rows !== rows;
			if (redrawn) rebuild(model.rows);
			const resized = model.reach !== reach;
			if (resized) {
				reach = model.reach;
				nav.setCssProps({
					'--snowflake-method-contents-rows': String(contentsRows(reach)),
				});
				pitch = null;
			}
			const moved = model.active !== active;
			active = model.active;
			mark();
			const may = model.editable !== false;
			if (may !== editable) {
				editable = may;
				if (!may) offer(-1);
			}
			offerAtRest();
			// A list that changed may have moved every row after the change:
			// the row holding the keys is brought back to the middle at once,
			// and so is the page's chapter unless the wheel is in the
			// reader's hand, whose turn is left as it stands. A wheel of
			// another height is put right at once too, and a chapter the
			// page moved to is glided to.
			if (redrawn && holdsFocus()) centre(stop, true);
			else if (!hand && (redrawn || resized || moved)) {
				sent = 0;
				centre(activeIndex(), redrawn || resized);
			}
		},
		settle: () => {
			pitch = null;
			// A wheel of another width cuts other names short.
			tipped = new WeakSet<HTMLElement>();
			if (!hand) {
				sent = 0;
				centre(activeIndex(), true);
			}
		},
		held: () => {
			const focused = nav.doc.activeElement;
			const at = items.findIndex((button) => button === focused);
			return rows[at]?.path ?? null;
		},
		dispose: () => {
			disarm();
			nav.remove();
		},
	};
}
