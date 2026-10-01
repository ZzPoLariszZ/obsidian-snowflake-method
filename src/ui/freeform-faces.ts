/**
 * What stands in a node's box. The canvas's engine draws the box, moves it
 * and sizes it, and hands over an empty element; what is shown in it is
 * painted here, in the plugin's own way of building an element, so a node
 * looks and answers as the rest of the plugin does and nothing of the engine
 * reaches what a node says.
 *
 * Each kind of node has a painter. A text node is typed into where it
 * stands; a scene is the corkboard's own card, dealt from the deck the
 * workspace holds, and a character or a worldbuilding note wears that
 * card's shape, read and never written; a task is the board's own card, a
 * foreshadowing or a revision the card the manuscript's margin pins, and a
 * sticky note its own card, each read here and written where it lives; a
 * frame shows its title at its head; a node whose resource has gone says so
 * under the name it last went by; and every other kind shows what it is
 * called beside its symbol. Every face carries the way to its menu, always
 * in sight, so nothing a node can do is reached by the pointer alone.
 */

import { Component, Keymap, MarkdownRenderer, setIcon, setTooltip, type App } from 'obsidian';

import { FORESHADOWING_STATUSES, PROGRESS_STATUSES, type DateFormat, type FreeformFrame, type MacaronColor, type ProgressStatus } from '../domain';
import { hangPanel, type HungPanel } from './anchored-panel';
import { CANVAS_FAR_KIND, CANVAS_FRAME_KIND, type NodePainter, type PaintContext, type PaintedNode } from './freeform-canvas-port';
import type { ForeshadowingOccurrenceRow, ForeshadowingTableItem } from './foreshadowing-rows';
import { faceKindOf, faceModeOf } from './freeform-layout';
import type { FreeformFileKind, ResolvedNode } from './freeform-resources';
import type { Translate } from './modals';
import { railParts, type RailParts } from './rail-parts';
import type { SceneCard } from './scene-card';
import { renderStickySwatches } from './sticky-note-card';
import { formatStickyCreated } from './sticky-note-layout';
import { paintTaskMeta } from './task-card-parts';
import type { SceneViewModel } from './view-model';

/** A character's or a worldbuilding note's node, the two that wear the corkboard card's shape. */
export type CardNode = Extract<ResolvedNode, { type: 'character' | 'worldbuilding' }>;

export interface FreeformFaceDeps {
	app: App;
	t: Translate;
	/** What rendered Markdown lives under: the view that mounts the workspace. */
	component: Component;
	/** Where a link in a text node's words is read from: the project's own folder. */
	sourcePath: () => string;
	/** What a node stands for now; nothing for one that has gone from the view. */
	node: (id: string) => ResolvedNode | undefined;
	frame: (id: string) => FreeformFrame | undefined;
	icon: (node: ResolvedNode) => string;
	label: (node: ResolvedNode) => string;
	frameLabel: (frame: FreeformFrame) => string;
	/** The node being typed into, by id; null where none is. */
	editing: () => string | null;
	/** How long a text node's words may run. */
	textLimit: () => number;
	/** Opens a node's menu, under the pointer or by the button it was asked from. */
	menu: (id: string, event: MouseEvent) => void;
	/** Words typed into a text node and kept, with how tall a box they need. */
	keepText: (id: string, words: string, needed: number) => void;
	/** A text node left as it was. */
	leaveText: (id: string) => void;
	/** Opens one occurrence of a foreshadowing in the manuscript, from a row of its fullest face. */
	openOccurrence: (item: ForeshadowingTableItem, occurrence: ForeshadowingOccurrenceRow) => void;
	/** The day the reading device is on, which a task's due date is measured against. */
	today: () => string;
	/** How a day is written, as the author chose. */
	dateFormat: () => DateFormat;
	/** The language a sticky note's birth is said in, under the pointer. */
	locale: () => string;
	/** What a card's foot calls its note's kind: a character, a time's point or period, a location, an item, an authored kind by its name. */
	kindWord: (node: CardNode) => string;
	/** Gives a character's or a worldbuilding note's card its tint, written to the note, or takes it off. */
	setColor: (node: CardNode, color: MacaronColor | null) => void;
	/**
	 * The deck the corkboard's cards are dealt from, for a scene's face: the
	 * card is the deck's, wired and written by it, and the face only holds
	 * it. A card is keyed by its placement, so a scene placed twice is two
	 * cards.
	 */
	scenes: {
		mount: (parent: HTMLElement, key: string, scene: SceneViewModel, index: number) => SceneCard;
		dress: (card: SceneCard, scene: SceneViewModel, index: number) => void;
		/** Keeps a card's open words without taking it down. */
		settle: (key: string) => void;
		/** Keeps a card's open words and takes it down. */
		retire: (key: string) => void;
	};
}

export interface FreeformFaces {
	painter: (kind: string) => NodePainter;
	/** Opens a text node for typing where its face stands; true once it is open. */
	edit: (id: string) => boolean;
	/** Keeps the words of the text node holding the focus; true when one did. */
	keepFocused: () => boolean;
	/** Puts away the swatches hanging under a card's palette, where the card has moved from under them. */
	closeColorPanel: () => void;
}

/** A text node's face as the workspace reaches it. */
interface TextFace {
	open: () => boolean;
	keep: () => void;
	holdsFocus: () => boolean;
}

/**
 * The way to a node's menu, which every face carries in its corner. It is
 * made before what the face says, so the words run round it and never under it.
 */
function moreButton(face: HTMLElement, deps: FreeformFaceDeps, id: string): HTMLButtonElement {
	const label = deps.t('table.actions');
	const more = face.createEl('button', {
		cls: 'clickable-icon snowflake-method-freeform-node-more',
		attr: { type: 'button', 'aria-label': label, 'aria-haspopup': 'menu' },
	});
	setIcon(more, 'ellipsis');
	setTooltip(more, label);
	more.addEventListener('click', (event) => {
		// The press is the button's: it neither chooses the node nor is read as a press on it.
		event.stopPropagation();
		deps.menu(id, event);
	});
	more.addEventListener('dblclick', (event) => {
		event.stopPropagation();
	});
	return more;
}

/** A link among rendered words is a link: one into the vault is the workspace's to open. */
function followLinks(shown: HTMLElement, deps: FreeformFaceDeps): void {
	shown.addEventListener('click', (event) => {
		const target = event.target as HTMLElement | null;
		const anchor = target?.closest('a') ?? null;
		if (anchor === null || !anchor.classList.contains('internal-link')) return;
		event.preventDefault();
		const linktext = anchor.getAttribute('data-href') ?? anchor.getAttribute('href') ?? '';
		if (linktext.length === 0) return;
		void deps.app.workspace
			.openLinkText(linktext, deps.sourcePath(), Keymap.isModEvent(event))
			.catch((error: unknown) => {
				console.error('Snowflake: a link on the freeform canvas could not be opened', error);
			});
	});
}

function textPainter(deps: FreeformFaceDeps, texts: Map<string, TextFace>): NodePainter {
	const { t } = deps;
	return {
		mount: (body, id, context): PaintedNode => {
			const face = body.createDiv({ cls: 'snowflake-method-freeform-face is-text' });
			// The symbol at the first line's start and the way to the menu at its end, the words between them: three columns, so
			// the words never run under either, typed or drawn.
			const symbol = face.createSpan({ cls: 'snowflake-method-freeform-face-icon', attr: { 'aria-hidden': 'true' } });
			const shown = face.createDiv({ cls: 'snowflake-method-freeform-text' });
			moreButton(face, deps, id);
			followLinks(shown, deps);
			let worn = '';

			let held: PaintContext = context;
			let field: HTMLTextAreaElement | null = null;
			/** The words the rendered face shows now; null before the first rendering. */
			let rendered: string | null = null;
			let child: Component | null = null;
			/** Words kept and measured but not yet handed over, while their rendering is on its way. */
			let owed: { words: string; needed: number } | null = null;
			let gone = false;

			const letChildGo = (): void => {
				if (child === null) return;
				deps.component.removeChild(child);
				child = null;
			};

			/**
			 * The words drawn as Markdown, under a component of their own so the
			 * next drawing lets this one go, and in a box of their own: a
			 * drawing still on its way when the next begins finishes in a box
			 * that has been taken out, and adds nothing to what is shown.
			 */
			const render = (words: string): Promise<void> => {
				rendered = words;
				letChildGo();
				shown.empty();
				face.toggleClass('is-blank', words.trim().length === 0);
				if (words.trim().length === 0) return Promise.resolve();
				const next = new Component();
				child = next;
				deps.component.addChild(next);
				const box = shown.createDiv({ cls: 'snowflake-method-freeform-words markdown-rendered' });
				return MarkdownRenderer.render(deps.app, words, box, deps.sourcePath(), next);
			};

			const handOver = (): void => {
				const kept = owed;
				if (kept === null) return;
				owed = null;
				deps.keepText(id, kept.words, kept.needed);
			};

			/**
			 * What the node's own edge takes of its height, which the face
			 * stands inside of. Nothing where the face has not been laid out, as
			 * in a tab that is not shown: there is no measure to take there.
			 */
			const edge = (): number => {
				const laid = face.offsetHeight;
				return laid > 0 ? Math.max(0, held.height - laid) : 0;
			};

			/** The room the face keeps above and below its words. */
			const padding = (): number => {
				const style = face.win.getComputedStyle(face);
				const above = Number.parseFloat(style.paddingTop);
				const below = Number.parseFloat(style.paddingBottom);
				return (Number.isFinite(above) ? above : 0) + (Number.isFinite(below) ? below : 0);
			};

			/**
			 * The words typed are kept. They are drawn first where there is time
			 * to, so the box is grown to what the drawn words need and not to
			 * what the letters typed did; with no time, as the canvas goes, the
			 * field's own measure serves.
			 */
			const keep = (now = false): void => {
				const open = field;
				if (open === null) return;
				const words = open.value;
				// The field stands in the words' own place, inside the room the face keeps about them.
				const typed = open.scrollHeight + padding() + edge();
				// Let go before the field is taken out, whose going is a blur of its own.
				field = null;
				face.removeClass('is-editing');
				open.remove();
				owed = { words, needed: typed };
				if (now || gone) {
					handOver();
					return;
				}
				void render(words).then(
					() => {
						// Taken up again meanwhile, or handed over as the face went: nothing is owed.
						if (owed === null) return;
						owed = { words: owed.words, needed: shown.scrollHeight + padding() + edge() };
						handOver();
					},
					(error: unknown) => {
						console.error('Snowflake: a text node could not be drawn', error);
						handOver();
					},
				);
			};

			const leave = (): void => {
				const open = field;
				if (open === null) return;
				field = null;
				face.removeClass('is-editing');
				open.remove();
				deps.leaveText(id);
			};

			const open = (): boolean => {
				if (field !== null) return true;
				if (gone || held.readOnly) return false;
				const node = deps.node(id);
				if (node?.type !== 'text') return false;
				// Words on their way are the words to go on from.
				const words = owed?.words ?? node.text;
				owed = null;
				const input = face.createEl('textarea', {
					cls: 'snowflake-method-freeform-text-field nodrag nopan nowheel',
					attr: {
						'aria-label': t('freeformCanvas.text.label'),
						placeholder: t('freeformCanvas.text.placeholder'),
						maxlength: String(deps.textLimit()),
						spellcheck: 'true',
					},
				});
				input.value = words;
				field = input;
				face.addClass('is-editing');
				input.addEventListener('keydown', (event) => {
					// A key that is part of putting a character together is the input method's.
					if (event.isComposing) return;
					if (event.key === 'Escape') {
						event.preventDefault();
						event.stopPropagation();
						leave();
						return;
					}
					if (event.key === 'Enter' && Keymap.isModifier(event, 'Mod')) {
						event.preventDefault();
						event.stopPropagation();
						keep();
					}
				});
				input.addEventListener('blur', () => {
					if (field === input) keep();
				});
				input.focus({ preventScroll: true });
				input.setSelectionRange(words.length, words.length);
				return true;
			};

			const dress = (next: PaintContext): void => {
				held = next;
				const node = deps.node(id);
				if (node?.type !== 'text') return;
				const icon = deps.icon(node);
				if (icon !== worn) {
					worn = icon;
					setIcon(symbol, icon);
				}
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, 'text', next.height);
				face.toggleClass('is-selected', next.selected);
				// A project that can no longer be written keeps what was typed and takes no more.
				if (next.readOnly && field !== null) keep(true);
				// What is being typed, and what was typed and is on its way, are
				// never drawn over with what the file holds.
				if (field === null && owed === null && node.text !== rendered) {
					void render(node.text).catch((error: unknown) => {
						console.error('Snowflake: a text node could not be drawn', error);
					});
				}
				if (deps.editing() === id && field === null && owed === null) open();
			};

			texts.set(id, {
				open,
				keep: () => {
					keep();
				},
				holdsFocus: () => field !== null && face.doc.activeElement === field,
			});
			dress(context);

			return {
				dress,
				settle: () => {
					if (field !== null) keep(true);
					else handOver();
				},
				unmount: () => {
					gone = true;
					if (field !== null) keep(true);
					else handOver();
					if (texts.get(id)?.open === open) texts.delete(id);
					letChildGo();
					face.remove();
				},
			};
		},
	};
}

/**
 * A scene's face is the corkboard's card itself: typed into, coloured and
 * set in its status where it stands, as it is on the board. The card
 * answers a press on its own controls and opens its own menu, which the
 * workspace lends it; the face sets which of the card's three styles is
 * shown, and stands selected with the node.
 */
function scenePainter(deps: FreeformFaceDeps): NodePainter {
	return {
		mount: (body, id, context): PaintedNode => {
			const face = body.createDiv({ cls: 'snowflake-method-freeform-face is-scene' });
			let card: SceneCard | null = null;
			const dress = (next: PaintContext): void => {
				const node = deps.node(id);
				if (node?.type !== 'scene') return;
				// Dealt bare, a card is dressed by the deck as it is shown and every time after.
				if (card === null) card = deps.scenes.mount(face, id, node.scene, node.index);
				deps.scenes.dress(card, node.scene, node.index);
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, 'scene', next.height);
				face.toggleClass('is-selected', next.selected);
			};
			dress(context);
			return {
				dress,
				settle: () => {
					if (card !== null) deps.scenes.settle(id);
				},
				unmount: () => {
					if (card !== null) deps.scenes.retire(id);
					card = null;
					face.remove();
				},
			};
		},
	};
}

// -- The cards the entities wear ----------------------------------------------------

/** What a card's head says of the note's standing, and the class that inks it. */
function standingOf(node: CardNode, t: Translate): { words: string; tone: ProgressStatus } | null {
	const status = node.type === 'character' ? node.character.progressStatus : node.entity.progressStatus;
	return status === null ? null : { words: t(`status.${status}`), tone: status };
}

/** The words a card's body holds: a character's one-sentence storyline, a worldbuilding note's description. */
const bodyWordsOf = (node: CardNode): string =>
	node.type === 'character' ? node.character.oneSentenceStoryline : node.entity.description;

/** The tint a card's note wears. */
const tintOf = (node: CardNode): MacaronColor | null => (node.type === 'character' ? node.character.color : node.entity.color);

/** What hangs under a card's palette: the one panel open over the canvas, as the corkboard keeps one over its deck. */
interface TintPanel {
	toggle: (anchor: HTMLElement, id: string) => void;
	/** Puts the panel away if it hangs under this button. */
	closeFor: (anchor: HTMLElement) => void;
	close: () => void;
}

function createTintPanel(deps: FreeformFaceDeps): TintPanel {
	const { t } = deps;
	let open: { anchor: HTMLElement; hung: HungPanel } | null = null;
	const close = (): void => {
		const held = open;
		if (held === null) return;
		open = null;
		held.hung.release();
		held.hung.el.remove();
	};
	/** The node as it stands when a swatch is picked, which may be a newer reading than the one the panel was hung from. */
	const cardOf = (id: string): CardNode | null => {
		const node = deps.node(id);
		return node?.type === 'character' || node?.type === 'worldbuilding' ? node : null;
	};
	const toggle = (anchor: HTMLElement, id: string): void => {
		if (open?.anchor === anchor) {
			close();
			return;
		}
		close();
		const node = cardOf(id);
		if (node === null) return;
		const hung = hangPanel(anchor, {
			cls: 'snowflake-method-corkboard-color-panel',
			label: t('stickyNotes.color'),
			build: (panel) => {
				renderStickySwatches(panel, {
					value: tintOf(node) ?? '',
					t,
					onPick: (value) => {
						close();
						const now = cardOf(id);
						if (now !== null) deps.setColor(now, value);
					},
					none: {
						label: t('modal.scene.colorNone'),
						onPick: () => {
							close();
							const now = cardOf(id);
							if (now !== null) deps.setColor(now, null);
						},
					},
				});
			},
			onClose: close,
		});
		open = { anchor, hung };
	};
	return {
		toggle,
		closeFor: (anchor) => {
			if (open?.anchor === anchor) close();
		},
		close,
	};
}

/**
 * A character's or a worldbuilding note's face: the corkboard card's own
 * shape, read and never written here but for its tint. Its symbol, its name
 * and its standing on the head, as a scene carries its own; its
 * one-sentence storyline or its description as the body, where a scene
 * shows its conflict; and on the foot what kind of note it is, with its
 * palette and the way to its menu at the foot's end, where a scene keeps
 * its own.
 */
function cardPainter(deps: FreeformFaceDeps, tints: TintPanel): NodePainter {
	const { t } = deps;
	return {
		mount: (body, id, context): PaintedNode => {
			const face = body.createDiv({ cls: 'snowflake-method-freeform-face is-card' });
			const card = face.createDiv({ cls: 'snowflake-method-corkboard-card snowflake-method-sticky-tint' });
			const head = card.createDiv({ cls: 'snowflake-method-corkboard-head' });
			const symbol = head.createSpan({ cls: 'snowflake-method-corkboard-symbol', attr: { 'aria-hidden': 'true' } });
			const name = head.createSpan({ cls: 'snowflake-method-freeform-card-title' });
			const status = head.createSpan({ cls: 'snowflake-method-entity-status snowflake-method-freeform-card-status' });
			const words = card.createDiv({ cls: 'snowflake-method-corkboard-body' }).createDiv({ cls: 'snowflake-method-freeform-card-words' });
			const foot = card.createDiv({ cls: 'snowflake-method-corkboard-footer' }).createDiv({ cls: 'snowflake-method-corkboard-footer-row' });
			const extra = foot.createSpan({ cls: 'snowflake-method-freeform-card-extra' });
			const actions = foot.createDiv({ cls: 'snowflake-method-corkboard-actions' });
			// The palette stands where a scene's does, and hangs the same swatches.
			const palette = actions.createEl('button', {
				cls: 'clickable-icon snowflake-method-corkboard-color',
				attr: { type: 'button', 'aria-haspopup': 'dialog' },
			});
			setIcon(palette, 'palette');
			palette.addEventListener('click', (event) => {
				event.stopPropagation();
				tints.toggle(palette, id);
			});
			moreButton(actions, deps, id);
			let worn = '';
			const dress = (next: PaintContext): void => {
				const node = deps.node(id);
				if (node?.type !== 'character' && node?.type !== 'worldbuilding') return;
				const icon = deps.icon(node);
				if (icon !== worn) {
					worn = icon;
					setIcon(symbol, icon);
				}
				const called = deps.label(node);
				if (name.textContent !== called) {
					name.setText(called);
					setTooltip(name, called);
				}
				const standing = standingOf(node, t);
				const said = standing?.words ?? '';
				if (status.textContent !== said) status.setText(said);
				for (const tone of PROGRESS_STATUSES) status.toggleClass(`is-${tone}`, tone === standing?.tone);
				status.toggleClass('is-hidden', standing === null);
				const held = bodyWordsOf(node);
				if (words.textContent !== held) words.setText(held);
				const under = deps.kindWord(node);
				if (extra.textContent !== under) extra.setText(under);
				const tint = tintOf(node);
				if (tint === null) card.removeAttribute('data-color');
				else if (card.getAttribute('data-color') !== tint) card.setAttribute('data-color', tint);
				const tintWord = tint === null ? t('modal.scene.colorNone') : t(`stickyNotes.color.${tint}`);
				const tintLabel = t('corkboard.colorLabel', { color: tintWord });
				if (palette.getAttribute('aria-label') !== tintLabel) {
					palette.setAttribute('aria-label', tintLabel);
					setTooltip(palette, tintWord);
				}
				palette.disabled = next.readOnly;
				if (next.readOnly) tints.closeFor(palette);
				face.dataset.type = node.type;
				face.dataset.kind = node.type === 'character' ? 'character' : node.entity.kind;
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, 'card', next.height);
				face.toggleClass('is-selected', next.selected);
			};
			dress(context);
			return {
				dress,
				settle: () => undefined,
				unmount: () => {
					tints.closeFor(palette);
					face.remove();
				},
			};
		},
	};
}

// -- The task management cards ------------------------------------------------------

/**
 * A task's face: the board's own card, read and never written. Its title on
 * the first row, with the task's symbol and the way to its menu at the row's
 * end, where the board keeps the card's own menu; its priority and the day
 * it is due on the second; and along its top edge the hue of the column it
 * stands in on the board, worn as a card set aside wears it, since off the
 * board nothing else says which column that is.
 */
function taskPainter(deps: FreeformFaceDeps): NodePainter {
	const { t } = deps;
	return {
		mount: (body, id, context): PaintedNode => {
			const face = body.createDiv({ cls: 'snowflake-method-freeform-face is-task' });
			const card = face.createDiv({ cls: 'snowflake-method-task-card', attr: { 'data-origin': 'manual' } });
			const head = card.createDiv({ cls: 'snowflake-method-task-card-head' });
			const title = head.createDiv({ cls: 'snowflake-method-task-card-title' });
			const symbol = railTools(head, deps, id);
			const meta = card.createDiv({ cls: 'snowflake-method-task-card-meta' });
			let worn = '';
			let drawn = '';
			const dress = (next: PaintContext): void => {
				const node = deps.node(id);
				if (node?.type !== 'task') return;
				const { task } = node;
				const icon = deps.icon(node);
				if (icon !== worn) {
					worn = icon;
					setIcon(symbol, icon);
				}
				if (title.textContent !== task.title) {
					title.setText(task.title);
					setTooltip(title, task.title);
				}
				card.setAttribute('data-priority', task.priority);
				card.setAttribute('data-status', task.status);
				// The second row is drawn again when what it says moves: the
				// priority, the day, how a day is written, or whether it has passed.
				const when = { today: deps.today(), dateFormat: deps.dateFormat() };
				const signature = [task.priority, task.dueDate ?? '', task.status, when.today, when.dateFormat].join('\n');
				if (signature !== drawn) {
					drawn = signature;
					paintTaskMeta(meta, task, when, t);
				}
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, 'task', next.height);
				face.toggleClass('is-selected', next.selected);
			};
			dress(context);
			return {
				dress,
				settle: () => undefined,
				unmount: () => {
					face.remove();
				},
			};
		},
	};
}

/**
 * The corner of a margin card where the rail keeps its compass. There is
 * no rail here to step along, so the corner holds the card's symbol and
 * the way to its menu instead.
 */
function railTools(host: HTMLElement, deps: FreeformFaceDeps, id: string): HTMLElement {
	const tools = host.createDiv({ cls: 'snowflake-method-freeform-rail-tools' });
	const symbol = tools.createSpan({ cls: 'snowflake-method-freeform-face-icon', attr: { 'aria-hidden': 'true' } });
	moreButton(tools, deps, id);
	return symbol;
}

/** One named block of a margin card, and the barest face that shows it. */
function railValue(
	parts: RailParts,
	fields: HTMLElement,
	part: string,
	label: string,
	text: string,
	from: 'compact' | 'standard',
): void {
	const field = parts.fieldBlock(fields, part, label);
	field.setAttribute('data-from', from);
	field.createDiv({ cls: 'snowflake-method-rail-value', text });
}

/**
 * A foreshadowing's face: the card the manuscript's margin pins beside
 * each of its occurrences, read here for the thread whole and never
 * written. Its head is the rail's own two-by-two: the thread's name under
 * the word for it, its standing under the corner that holds its symbol
 * and the way to its menu. Under the head its description, and its
 * occurrences, each a way into the manuscript where it stands, with the
 * words it marks under it. No compass, since there is
 * no rail to step along, and no row of buttons, since what the card can do
 * is its menu's.
 */
function threadPainter(deps: FreeformFaceDeps, parts: RailParts): NodePainter {
	const { t } = deps;
	return {
		mount: (body, id, context): PaintedNode => {
			const face = body.createDiv({ cls: 'snowflake-method-freeform-face is-foreshadowing' });
			const card = face.createDiv({ cls: 'snowflake-method-rail-card snowflake-method-foreshadowing-card' });
			const field = parts.fieldBlock(parts.headBlock(card), 'name', t('manuscript.foreshadowing.name'));
			const symbol = railTools(field, deps, id);
			const name = field.createDiv({ cls: 'snowflake-method-rail-value' });
			const status = field.createSpan({ cls: 'snowflake-method-entity-status snowflake-method-rail-status' });
			const fields = parts.fieldsBlock(card);
			let worn = '';
			let drawn = '';
			const dress = (next: PaintContext): void => {
				const node = deps.node(id);
				if (node?.type !== 'foreshadowing') return;
				const { item } = node;
				const icon = deps.icon(node);
				if (icon !== worn) {
					worn = icon;
					setIcon(symbol, icon);
				}
				if (name.textContent !== item.name) name.setText(item.name);
				const standing = t(`foreshadowing.status.${item.status}`);
				if (status.textContent !== standing) status.setText(standing);
				for (const tone of FORESHADOWING_STATUSES) status.toggleClass(`is-${tone}`, tone === item.status);
				const signature = JSON.stringify([
					item.description,
					item.occurrences.map((occurrence) => [occurrence.id, occurrence.role, occurrence.title, occurrence.standing, occurrence.originalText]),
				]);
				if (signature !== drawn) {
					drawn = signature;
					fields.empty();
					if (item.description.length > 0) {
						railValue(parts, fields, 'description', t('manuscript.foreshadowing.description'), item.description, 'standard');
					}
					const count = item.occurrences.length;
					const block = parts.fieldBlock(
						fields,
						'occurrences',
						t(count === 1 ? 'freeformCanvas.face.occurrencesOne' : 'freeformCanvas.face.occurrences', { count }),
					);
					block.setAttribute('data-from', 'standard');
					for (const occurrence of item.occurrences) {
						const unresolved = occurrence.standing === 'unresolved';
						const button = block.createEl('button', {
							cls: 'snowflake-method-rail-value snowflake-method-freeform-occurrence',
							attr: { type: 'button' },
						});
						const line = button.createSpan({ cls: 'snowflake-method-freeform-occurrence-line' });
						line.createSpan({
							cls: 'snowflake-method-foreshadowing-role',
							attr: { 'data-role': unresolved ? 'unresolved' : occurrence.role },
							text: t(`foreshadowing.role.${occurrence.role}`),
						});
						line.createSpan({ text: ` · ${occurrence.title}` });
						if (unresolved) line.createSpan({ cls: 'snowflake-method-rail-badge', text: t('manuscript.foreshadowing.unresolved') });
						if (occurrence.originalText.length > 0) {
							button.createSpan({ cls: 'snowflake-method-freeform-occurrence-passage', text: occurrence.originalText });
						}
						button.addEventListener('click', (event) => {
							event.stopPropagation();
							deps.openOccurrence(item, occurrence);
						});
					}
				}
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, 'thread', next.height);
				face.toggleClass('is-selected', next.selected);
			};
			dress(context);
			return {
				dress,
				settle: () => undefined,
				unmount: () => {
					face.remove();
				},
			};
		},
	};
}

/**
 * A revision's face: the card the manuscript's margin pins beside it, read
 * here and never written. What it would do at the head, in the ink of its
 * kind, with the badge a conflict wears after it, and the corner that holds
 * its symbol and the way to its menu; under the head the chapter it stands
 * in, the words it would take and the words it would put, and the aside
 * about them.
 */
function revisionPainter(deps: FreeformFaceDeps, parts: RailParts): NodePainter {
	const { t } = deps;
	return {
		mount: (body, id, context): PaintedNode => {
			const face = body.createDiv({ cls: 'snowflake-method-freeform-face is-revision' });
			const card = face.createDiv({ cls: 'snowflake-method-rail-card snowflake-method-revision-card' });
			const head = parts.headBlock(card);
			const type = parts.fieldBlock(head, 'type', t('manuscript.revision.type')).createDiv({ cls: 'snowflake-method-rail-value' });
			const kind = type.createSpan();
			const badge = type.createSpan({ cls: 'snowflake-method-rail-badge is-hidden', text: t('manuscript.revision.conflict') });
			const symbol = railTools(head, deps, id);
			const fields = parts.fieldsBlock(card);
			let worn = '';
			let drawn = '';
			const dress = (next: PaintContext): void => {
				const node = deps.node(id);
				if (node?.type !== 'revision') return;
				const { row } = node;
				const icon = deps.icon(node);
				if (icon !== worn) {
					worn = icon;
					setIcon(symbol, icon);
				}
				const conflict = row.status === 'conflict';
				const does = t(`manuscript.revision.kind.${row.kind}`);
				if (kind.textContent !== does) kind.setText(does);
				type.setAttribute('data-kind', conflict ? 'conflict' : row.kind);
				badge.toggleClass('is-hidden', !conflict);
				card.toggleClass('is-conflict', conflict);
				const signature = JSON.stringify([row.title, row.kind, row.original, row.proposed, row.comment]);
				if (signature !== drawn) {
					drawn = signature;
					fields.empty();
					railValue(parts, fields, 'place', t('revisionTable.place'), row.title, 'compact');
					if (row.kind !== 'insert') railValue(parts, fields, 'original', t('manuscript.revision.original'), row.original, 'standard');
					if (row.kind !== 'delete') railValue(parts, fields, 'proposed', t('manuscript.revision.proposed'), row.proposed, 'standard');
					if (row.comment.length > 0) railValue(parts, fields, 'comment', t('manuscript.revision.comment'), row.comment, 'standard');
				}
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, 'revision', next.height);
				face.toggleClass('is-selected', next.selected);
			};
			dress(context);
			return {
				dress,
				settle: () => undefined,
				unmount: () => {
					face.remove();
				},
			};
		},
	};
}

/**
 * A sticky note's face: the note's own card, read and never written, since
 * the note floats from its menu and the float is where it is typed into.
 * Its head says when the note was made, and holds the note's symbol and the
 * way to its menu where the board keeps the note's tools; under it the
 * note's words drawn as a note's are, and on the barest face their first
 * line alone.
 */
function stickyPainter(deps: FreeformFaceDeps): NodePainter {
	const { t } = deps;
	return {
		mount: (body, id, context): PaintedNode => {
			const face = body.createDiv({ cls: 'snowflake-method-freeform-face is-sticky' });
			const card = face.createDiv({ cls: 'snowflake-method-sticky-card snowflake-method-sticky-tint' });
			const head = card.createDiv({ cls: 'snowflake-method-sticky-head' });
			const created = head.createSpan({ cls: 'snowflake-method-sticky-created' });
			const tools = head.createDiv({ cls: 'snowflake-method-sticky-tools' });
			const symbol = tools.createSpan({ cls: 'snowflake-method-freeform-face-icon', attr: { 'aria-hidden': 'true' } });
			moreButton(tools, deps, id);
			const words = card.createDiv({ cls: 'snowflake-method-sticky-body' });
			const first = words.createDiv({ cls: 'snowflake-method-freeform-sticky-first' });
			const shown = words.createDiv({ cls: 'snowflake-method-freeform-text' });
			followLinks(shown, deps);
			let worn = '';
			let born = '';
			let rendered: string | null = null;
			let child: Component | null = null;
			const letChildGo = (): void => {
				if (child === null) return;
				deps.component.removeChild(child);
				child = null;
			};
			const dress = (next: PaintContext): void => {
				const node = deps.node(id);
				if (node?.type !== 'sticky-note') return;
				const { note } = node;
				if (card.getAttribute('data-color') !== note.color) card.setAttribute('data-color', note.color);
				const icon = deps.icon(node);
				if (icon !== worn) {
					worn = icon;
					setIcon(symbol, icon);
				}
				const when = formatStickyCreated(note.createdAt, deps.locale());
				if (when.short !== born) {
					born = when.short;
					created.setText(when.short);
					const full = t('stickyNotes.created', { when: when.full });
					created.setAttribute('aria-label', full);
					setTooltip(created, full);
				}
				const line = deps.label(node);
				if (first.textContent !== line) first.setText(line);
				if (note.body !== rendered) {
					rendered = note.body;
					letChildGo();
					shown.empty();
					if (note.body.trim().length > 0) {
						const drawing = new Component();
						child = drawing;
						deps.component.addChild(drawing);
						const box = shown.createDiv({ cls: 'snowflake-method-sticky-rendered markdown-rendered' });
						void MarkdownRenderer.render(deps.app, note.body, box, deps.sourcePath(), drawing).catch((error: unknown) => {
							console.error('Snowflake: a sticky note on the freeform canvas could not be drawn', error);
						});
					}
				}
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, 'sticky', next.height);
				face.toggleClass('is-selected', next.selected);
			};
			dress(context);
			return {
				dress,
				settle: () => undefined,
				unmount: () => {
					letChildGo();
					face.remove();
				},
			};
		},
	};
}

/** The symbol a file wears, by how it is shown. */
const FILE_ICONS: Readonly<Record<FreeformFileKind, string>> = {
	markdown: 'file-text',
	image: 'image',
	video: 'film',
	audio: 'music',
	pdf: 'file-text',
	other: 'file',
};

/**
 * A file's face: its symbol and its name, and, for a picture, a video or a
 * sound, the file itself drawn from the vault under them, as much of it as
 * the box has room for. A note and anything else say only what they are
 * called, and open where the app shows them.
 */
function filePainter(deps: FreeformFaceDeps): NodePainter {
	return {
		mount: (body, id, context): PaintedNode => {
			const face = body.createDiv({ cls: 'snowflake-method-freeform-face is-file' });
			// The face is a column, so the way to the menu stands in the head's row rather than floating over it.
			const head = face.createDiv({ cls: 'snowflake-method-freeform-face-head' });
			const symbol = head.createSpan({
				cls: 'snowflake-method-freeform-face-icon',
				attr: { 'aria-hidden': 'true' },
			});
			const name = head.createSpan({ cls: 'snowflake-method-freeform-face-name' });
			// The extension, as the app's own file list tags a file with it.
			const extension = head.createSpan({ cls: 'snowflake-method-freeform-file-ext' });
			moreButton(head, deps, id);
			const media = face.createDiv({ cls: 'snowflake-method-freeform-file-media' });
			let worn = '';
			/** The file the media was drawn from last: its path and how the vault saw it. */
			let drawn = '';
			const dress = (next: PaintContext): void => {
				const node = deps.node(id);
				if (node?.type !== 'file') return;
				const { file } = node;
				const icon = FILE_ICONS[file.kind];
				if (icon !== worn) {
					worn = icon;
					setIcon(symbol, icon);
				}
				const words = deps.label(node);
				if (name.textContent !== words) {
					name.setText(words);
					setTooltip(name, words);
				}
				if (extension.textContent !== file.extension) extension.setText(file.extension);
				extension.toggleClass('is-hidden', file.extension.length === 0);
				const stamp = `${file.path}|${file.stamp}|${file.kind}`;
				if (stamp !== drawn) {
					drawn = stamp;
					media.empty();
					// The file as the vault serves it to the window; gone from the vault since it was read, there is nothing to draw.
					const held = deps.app.vault.getFileByPath(file.path);
					const source = held === null ? null : deps.app.vault.getResourcePath(held);
					if (source !== null && file.kind === 'image') {
						media.createEl('img', { attr: { src: source, alt: file.name, loading: 'lazy' } });
					} else if (source !== null && file.kind === 'video') {
						media.createEl('video', { attr: { src: source, controls: '', preload: 'metadata' } });
					} else if (source !== null && file.kind === 'audio') {
						media.createEl('audio', { attr: { src: source, controls: '', preload: 'metadata' } });
					}
					// A file that is none of these has nothing under its name, so nothing stands there to push the name off the middle.
					media.toggleClass('is-hidden', media.children.length === 0);
				}
				face.dataset.kind = file.kind;
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, 'record', next.height);
				face.toggleClass('is-selected', next.selected);
			};
			dress(context);
			return {
				dress,
				settle: () => undefined,
				unmount: () => {
					face.remove();
				},
			};
		},
	};
}

/**
 * A link's face: what it is called, on one line. Nothing is fetched: the
 * face knows the address and no more, so the plugin asks nothing of the
 * network, and the address itself is the menu's to open and to copy.
 */
function linkPainter(deps: FreeformFaceDeps): NodePainter {
	return {
		mount: (body, id, context): PaintedNode => {
			const face = body.createDiv({ cls: 'snowflake-method-freeform-face is-link' });
			const head = face.createDiv({ cls: 'snowflake-method-freeform-face-head' });
			const symbol = head.createSpan({
				cls: 'snowflake-method-freeform-face-icon',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(symbol, 'link');
			const name = head.createSpan({ cls: 'snowflake-method-freeform-face-name' });
			moreButton(head, deps, id);
			const dress = (next: PaintContext): void => {
				const node = deps.node(id);
				if (node?.type !== 'link') return;
				const words = deps.label(node);
				if (name.textContent !== words) {
					name.setText(words);
					setTooltip(name, words);
				}
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, 'record', next.height);
				face.toggleClass('is-selected', next.selected);
			};
			dress(context);
			return {
				dress,
				settle: () => undefined,
				unmount: () => {
					face.remove();
				},
			};
		},
	};
}

/** What a missing resource is called by the kind it was last seen as. */
function missingWord(node: Extract<ResolvedNode, { type: 'missing' }>, t: Translate): string {
	if (node.of === 'entity') {
		if (node.kind === 'scene') return t('timeline.scene.missing');
		if (node.kind === 'time') return t('timeline.time.missing');
		if (node.kind === 'character' || node.kind === 'location' || node.kind === 'item') {
			return t(`freeformCanvas.missing.${node.kind}`);
		}
		return t('freeformCanvas.missing.entity');
	}
	if (node.of === 'sticky-note') return t('freeformCanvas.missing.stickyNote');
	return t(`freeformCanvas.missing.${node.of}`);
}

/**
 * The face of a node whose resource has gone, been set aside or been
 * settled: a warning, what kind of thing it was, and what it was last
 * called. Nothing opens from it; it can only be taken off the view.
 */
function missingPainter(deps: FreeformFaceDeps): NodePainter {
	const { t } = deps;
	return {
		mount: (body, id, context): PaintedNode => {
			const face = body.createDiv({ cls: 'snowflake-method-freeform-face is-missing' });
			moreButton(face, deps, id);
			const head = face.createDiv({ cls: 'snowflake-method-freeform-face-head' });
			const symbol = head.createSpan({
				cls: 'snowflake-method-freeform-face-icon',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(symbol, 'triangle-alert');
			const name = head.createSpan({ cls: 'snowflake-method-freeform-face-name' });
			const seen = face.createDiv({ cls: 'snowflake-method-freeform-face-seen' });
			const dress = (next: PaintContext): void => {
				const node = deps.node(id);
				if (node?.type !== 'missing') return;
				const words = missingWord(node, t);
				if (name.textContent !== words) name.setText(words);
				const last = node.name.trim().length === 0 ? '' : t('freeformCanvas.missing.lastSeen', { name: node.name });
				if (seen.textContent !== last) seen.setText(last);
				seen.toggleClass('is-hidden', last.length === 0);
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, 'plain', next.height);
				face.toggleClass('is-selected', next.selected);
			};
			dress(context);
			return {
				dress,
				settle: () => undefined,
				unmount: () => {
					face.remove();
				},
			};
		},
	};
}

/**
 * The face a node shows from far off: its symbol and its name, and nothing
 * else, since nothing else could be read at that distance. It carries no
 * button, since none could be pressed there either; the node's menu is still
 * the pointer's and the keyboard's by way of the node itself.
 */
function farPainter(deps: FreeformFaceDeps): NodePainter {
	return {
		mount: (body, id, context): PaintedNode => {
			const face = body.createDiv({ cls: 'snowflake-method-freeform-face is-far' });
			const symbol = face.createSpan({ cls: 'snowflake-method-freeform-face-icon', attr: { 'aria-hidden': 'true' } });
			const name = face.createSpan({ cls: 'snowflake-method-freeform-face-name' });
			let shown = '';
			const dress = (next: PaintContext): void => {
				const node = deps.node(id);
				if (node === undefined) return;
				const icon = deps.icon(node);
				if (icon !== shown) {
					shown = icon;
					setIcon(symbol, icon);
				}
				const words = deps.label(node);
				if (name.textContent !== words) name.setText(words);
				face.toggleClass('is-selected', next.selected);
			};
			dress(context);
			return {
				dress,
				settle: () => undefined,
				unmount: () => {
					face.remove();
				},
			};
		},
	};
}

/**
 * A frame's face: its title at its head, and the tint it wears, which is
 * one of the sticky notes' own macarons and painted from the same rules.
 */
function framePainter(deps: FreeformFaceDeps): NodePainter {
	return {
		mount: (body, id, context): PaintedNode => {
			const face = body.createDiv({ cls: 'snowflake-method-freeform-face is-frame snowflake-method-sticky-tint' });
			const head = face.createDiv({ cls: 'snowflake-method-freeform-frame-head' });
			moreButton(head, deps, id);
			const title = head.createSpan({ cls: 'snowflake-method-freeform-frame-title' });
			const dress = (next: PaintContext): void => {
				const frame = deps.frame(id);
				if (frame === undefined) return;
				const words = deps.frameLabel(frame);
				if (title.textContent !== words) title.setText(words);
				title.toggleClass('is-untitled', frame.title.trim().length === 0);
				if (frame.color === null) face.removeAttribute('data-color');
				else if (face.getAttribute('data-color') !== frame.color) face.setAttribute('data-color', frame.color);
				face.toggleClass('is-selected', next.selected);
			};
			dress(context);
			return {
				dress,
				settle: () => undefined,
				unmount: () => {
					face.remove();
				},
			};
		},
	};
}

/**
 * The face of every kind that has none of its own yet: its symbol, and what
 * it is called. A node whose resource has gone, or has not been read yet, is
 * called what it was last called.
 */
function plainPainter(deps: FreeformFaceDeps): NodePainter {
	return {
		mount: (body, id, context): PaintedNode => {
			const face = body.createDiv({ cls: 'snowflake-method-freeform-face is-plain' });
			moreButton(face, deps, id);
			const symbol = face.createSpan({
				cls: 'snowflake-method-freeform-face-icon',
				attr: { 'aria-hidden': 'true' },
			});
			const name = face.createSpan({ cls: 'snowflake-method-freeform-face-name' });
			let worn = '';
			const dress = (next: PaintContext): void => {
				const node = deps.node(id);
				if (node === undefined) return;
				const icon = deps.icon(node);
				if (icon !== worn) {
					worn = icon;
					setIcon(symbol, icon);
				}
				const words = deps.label(node);
				if (name.textContent !== words) name.setText(words);
				face.dataset.type = node.type;
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, faceKindOf(node.type), next.height);
				face.toggleClass('is-selected', next.selected);
			};
			dress(context);
			return {
				dress,
				settle: () => undefined,
				unmount: () => {
					face.remove();
				},
			};
		},
	};
}

export function createFreeformFaces(deps: FreeformFaceDeps): FreeformFaces {
	const texts = new Map<string, TextFace>();
	// The margin's own parts, so a thread's card and a revision's read as the rail's; nothing here grows under the hand, so nothing restacks.
	const parts = railParts(() => undefined);
	const text = textPainter(deps, texts);
	const scene = scenePainter(deps);
	const tints = createTintPanel(deps);
	const card = cardPainter(deps, tints);
	const task = taskPainter(deps);
	const thread = threadPainter(deps, parts);
	const revision = revisionPainter(deps, parts);
	const missing = missingPainter(deps);
	const frame = framePainter(deps);
	const plain = plainPainter(deps);
	const sticky = stickyPainter(deps);
	const file = filePainter(deps);
	const link = linkPainter(deps);
	const far = farPainter(deps);
	const painters: Record<string, NodePainter> = {
		text,
		scene,
		character: card,
		worldbuilding: card,
		task,
		foreshadowing: thread,
		revision,
		'sticky-note': sticky,
		file,
		link,
		missing,
		[CANVAS_FRAME_KIND]: frame,
		[CANVAS_FAR_KIND]: far,
	};
	return {
		painter: (kind) => painters[kind] ?? plain,
		edit: (id) => texts.get(id)?.open() ?? false,
		closeColorPanel: tints.close,
		keepFocused: () => {
			for (const face of texts.values()) {
				if (!face.holdsFocus()) continue;
				face.keep();
				return true;
			}
			return false;
		},
	};
}
