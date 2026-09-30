/**
 * What stands in a node's box. The canvas's engine draws the box, moves it
 * and sizes it, and hands over an empty element; what is shown in it is
 * painted here, in the plugin's own way of building an element, so a node
 * looks and answers as the rest of the plugin does and nothing of the engine
 * reaches what a node says.
 *
 * Each kind of node has a painter. A text node is typed into where it
 * stands; a scene is the corkboard's own card, dealt from the deck the
 * workspace holds; a character or a worldbuilding note shows its rows, as
 * many as its face has room for; a frame shows its title at its head; a
 * node whose resource has gone says so under the name it last went by; and
 * every other kind shows what it is called beside its symbol until the
 * stage that gives it a face of its own. Every face carries the way to its
 * menu, always in sight, so nothing a node can do is reached by the pointer
 * alone.
 */

import { Component, Keymap, MarkdownRenderer, setIcon, setTooltip, type App } from 'obsidian';

import { PROGRESS_STATUSES, type FreeformFrame } from '../domain';
import { CANVAS_FAR_KIND, CANVAS_FRAME_KIND, type NodePainter, type PaintContext, type PaintedNode } from './freeform-canvas-port';
import type { ForeshadowingOccurrenceRow, ForeshadowingTableItem } from './foreshadowing-rows';
import { faceKindOf, faceModeOf, type FreeformFaceMode } from './freeform-layout';
import type { FreeformFileKind, ResolvedNode } from './freeform-resources';
import type { Translate } from './modals';
import type { SceneCard } from './scene-card';
import type { SceneViewModel } from './view-model';

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
			moreButton(face, deps, id);
			const shown = face.createDiv({ cls: 'snowflake-method-freeform-text' });
			followLinks(shown, deps);

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
				// The field fills the face and pads its words as the face does.
				const typed = open.scrollHeight + edge();
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
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, { kind: 'text', height: next.height });
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
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, { kind: 'scene', height: next.height });
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

/** One row of a record's face: what it says, under the word for it; a row that opens something is a button. */
interface FaceRow {
	label: string;
	value: string;
	/** The barest face that shows the row. */
	from: Exclude<FreeformFaceMode, 'compact'>;
	open?: () => void;
}

/** What the first line of a record's face says of its standing, and the class that inks it. */
function statusOf(node: ResolvedNode, t: Translate): { words: string; tone: string } | null {
	switch (node.type) {
		case 'character':
			return node.character.progressStatus === null ? null : { words: t(`status.${node.character.progressStatus}`), tone: node.character.progressStatus };
		case 'worldbuilding':
			return node.entity.progressStatus === null ? null : { words: t(`status.${node.entity.progressStatus}`), tone: node.entity.progressStatus };
		case 'task':
			return { words: t(`tasks.status.${node.task.status}`), tone: node.task.status };
		case 'foreshadowing':
			return { words: t(`foreshadowing.status.${node.item.status}`), tone: node.item.status };
		case 'revision':
			return node.row.status === 'conflict' ? { words: t('manuscript.revision.conflict'), tone: 'conflict' } : null;
		default:
			return null;
	}
}

/** Every class a status may ink the first line with, so a change of standing takes the old one off. */
const STATUS_TONES = [
	...PROGRESS_STATUSES,
	'todo', 'in-progress', 'blocked', 'in-review', 'done', 'cancelled',
	'planned', 'active', 'resolved', 'abandoned',
	'conflict',
] as const;

/** The rows a record shows, fullest last; a row with nothing to say is left out. */
function rowsOf(node: ResolvedNode, t: Translate, deps: FreeformFaceDeps): FaceRow[] {
	const rows: FaceRow[] = [];
	const row = (label: string, value: string, from: FaceRow['from'], open?: () => void): void => {
		if (value.trim().length > 0) rows.push(open === undefined ? { label, value, from } : { label, value, from, open });
	};
	if (node.type === 'task') {
		const { task } = node;
		row(t('modal.task.priority'), t(`tasks.priority.${task.priority}`), 'standard');
		row(t('modal.task.dueDate'), task.dueDate ?? '', 'standard');
		row(t('modal.task.description'), task.description, 'extended');
		row(t('modal.task.related'), task.related.map((ref) => ref.name).join(', '), 'extended');
		return rows;
	}
	if (node.type === 'foreshadowing') {
		const { item } = node;
		row(t('modal.foreshadowing.description'), item.description, 'standard');
		const count = item.occurrences.length;
		// How many there are says enough on its own, so the row has no word over it.
		row('', t(count === 1 ? 'freeformCanvas.face.occurrencesOne' : 'freeformCanvas.face.occurrences', { count }), 'standard');
		// Each occurrence is a way into the manuscript, where it stands.
		for (const occurrence of item.occurrences) {
			row(t(`foreshadowing.role.${occurrence.role}`), occurrence.title, 'extended', () => {
				deps.openOccurrence(item, occurrence);
			});
		}
		return rows;
	}
	if (node.type === 'revision') {
		const { row: revision } = node;
		row(t('revisionTable.original'), revision.original, 'standard');
		row(t('revisionTable.proposed'), revision.proposed, 'standard');
		row(t('revisionTable.comment'), revision.comment, 'extended');
		return rows;
	}
	if (node.type === 'character') {
		const { character } = node;
		row(t('form.aliases'), character.aliases.join(', '), 'standard');
		row(t('modal.character.oneSentenceStoryline'), character.oneSentenceStoryline, 'standard');
		row(t('modal.character.motivation'), character.motivation, 'extended');
		row(t('modal.character.goal'), character.goal, 'extended');
		row(t('modal.character.conflict'), character.conflict, 'extended');
		row(t('modal.character.growth'), character.growth, 'extended');
		row(t('form.category'), character.categoryPaths.join(', '), 'extended');
		return rows;
	}
	if (node.type !== 'worldbuilding') return rows;
	const { entity } = node;
	if (entity.kind === 'time') {
		row(t('form.timeKind'), entity.timeKind === 'period' ? t('form.timeKind.period') : t('form.timeKind.point'), 'standard');
		row(t('form.timeStart'), entity.timeStart, 'standard');
		row(t('form.timeEnd'), entity.timeEnd, 'standard');
	}
	row(t('form.description'), entity.description, 'standard');
	row(t('form.aliases'), entity.aliases.join(', '), 'extended');
	row(t('form.category'), entity.categoryPaths.join(', '), 'extended');
	return rows;
}

/** The kinds of node the record painter dresses: read here, never written. */
const RECORD_TYPES = new Set<ResolvedNode['type']>(['character', 'worldbuilding', 'task', 'foreshadowing', 'revision']);

/**
 * A record's face, read and never written here: its symbol, its name and
 * its standing on the first line, and under them as many of its rows as
 * the face has room for. A character, a worldbuilding note, a task, a
 * foreshadowing and a revision are all records here; each opens from its
 * menu, and its own form or table is the way to change it.
 */
function recordPainter(deps: FreeformFaceDeps): NodePainter {
	const { t } = deps;
	return {
		mount: (body, id, context): PaintedNode => {
			const face = body.createDiv({ cls: 'snowflake-method-freeform-face is-record' });
			moreButton(face, deps, id);
			const head = face.createDiv({ cls: 'snowflake-method-freeform-face-head' });
			const symbol = head.createSpan({
				cls: 'snowflake-method-freeform-face-icon',
				attr: { 'aria-hidden': 'true' },
			});
			const name = head.createSpan({ cls: 'snowflake-method-freeform-face-name' });
			// The standing is the word every other surface shows, in its own ink.
			const status = head.createSpan({ cls: 'snowflake-method-entity-status snowflake-method-freeform-face-status' });
			const rows = face.createDiv({ cls: 'snowflake-method-freeform-face-rows' });
			let worn = '';
			let drawn = '';
			const dress = (next: PaintContext): void => {
				const node = deps.node(id);
				if (node === undefined || !RECORD_TYPES.has(node.type)) return;
				const icon = deps.icon(node);
				if (icon !== worn) {
					worn = icon;
					setIcon(symbol, icon);
				}
				const words = deps.label(node);
				if (name.textContent !== words) {
					name.setText(words);
					setTooltip(name, words);
				}
				const standing = statusOf(node, t);
				const said = standing?.words ?? '';
				if (status.textContent !== said) status.setText(said);
				for (const tone of STATUS_TONES) status.toggleClass(`is-${tone}`, tone === standing?.tone);
				status.toggleClass('is-hidden', standing === null);
				const lines = rowsOf(node, t, deps);
				const signature = JSON.stringify(lines.map((line) => [line.label, line.value, line.from, line.open !== undefined]));
				if (signature !== drawn) {
					drawn = signature;
					rows.empty();
					for (const line of lines) {
						const el = rows.createDiv({ cls: 'snowflake-method-freeform-face-row', attr: { 'data-from': line.from } });
						if (line.label.length > 0) el.createSpan({ cls: 'snowflake-method-freeform-face-row-label', text: line.label });
						const open = line.open;
						if (open === undefined) {
							el.createSpan({ cls: 'snowflake-method-freeform-face-row-value', text: line.value });
							continue;
						}
						const button = el.createEl('button', {
							cls: 'snowflake-method-freeform-face-row-value snowflake-method-freeform-face-row-open',
							text: line.value,
							attr: { type: 'button' },
						});
						button.addEventListener('click', (event) => {
							event.stopPropagation();
							open();
						});
					}
				}
				face.dataset.type = node.type;
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, { kind: 'record', height: next.height });
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
 * A sticky note's face: the note's own tint, its first line, and on the
 * fuller faces its words drawn as a note's are. Read here and never
 * written: the note floats from its menu, and the float is where it is
 * typed into.
 */
function stickyPainter(deps: FreeformFaceDeps): NodePainter {
	return {
		mount: (body, id, context): PaintedNode => {
			const face = body.createDiv({ cls: 'snowflake-method-freeform-face is-sticky snowflake-method-sticky-tint' });
			moreButton(face, deps, id);
			const first = face.createDiv({ cls: 'snowflake-method-freeform-sticky-first' });
			const shown = face.createDiv({ cls: 'snowflake-method-freeform-text' });
			followLinks(shown, deps);
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
				if (face.getAttribute('data-color') !== note.color) face.setAttribute('data-color', note.color);
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
						const box = shown.createDiv({ cls: 'snowflake-method-freeform-words markdown-rendered' });
						void MarkdownRenderer.render(deps.app, note.body, box, deps.sourcePath(), drawing).catch((error: unknown) => {
							console.error('Snowflake: a sticky note on the freeform canvas could not be drawn', error);
						});
					}
				}
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, { kind: 'record', height: next.height });
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
 * A file's face: its symbol and its name, the folder it stands in on the
 * standard face, and, for a picture, a video or a sound, the file itself
 * drawn from the vault. A note and anything else say only what they are
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
			moreButton(head, deps, id);
			const folder = face.createDiv({ cls: 'snowflake-method-freeform-file-folder' });
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
				const at = file.relativePath.slice(0, Math.max(0, file.relativePath.lastIndexOf('/')));
				if (folder.textContent !== at) folder.setText(at);
				folder.toggleClass('is-hidden', at.length === 0);
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
				}
				face.dataset.kind = file.kind;
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, { kind: 'record', height: next.height });
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
 * A link's face: what it is called, and on the fuller faces the address
 * whole. Nothing is fetched: the face knows the address and no more, so
 * the plugin asks nothing of the network.
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
			const address = face.createDiv({ cls: 'snowflake-method-freeform-link-address' });
			const dress = (next: PaintContext): void => {
				const node = deps.node(id);
				if (node?.type !== 'link') return;
				const words = deps.label(node);
				if (name.textContent !== words) {
					name.setText(words);
					setTooltip(name, words);
				}
				if (address.textContent !== node.url) address.setText(node.url);
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, { kind: 'record', height: next.height });
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
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, { kind: 'plain', height: next.height });
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
				face.dataset.mode = faceModeOf(node.placement.displayMode, next.band, { kind: faceKindOf(node.type), height: next.height });
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
	const text = textPainter(deps, texts);
	const scene = scenePainter(deps);
	const record = recordPainter(deps);
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
		character: record,
		worldbuilding: record,
		task: record,
		foreshadowing: record,
		revision: record,
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
