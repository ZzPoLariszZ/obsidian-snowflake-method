/**
 * One sticky note as a card: the same card on the dashboard's board, in the
 * sidebar and as a floating panel, differing only in the chrome around it.
 * The body shows the note rendered, or the Markdown itself under the plugin's
 * own editor; the head names the note's birth and carries its colour and its
 * buttons. Entering Editing claims the note through the hub, so no two cards
 * anywhere hold an editor for one note, and leaving it flushes what was typed
 * before the rendered face returns.
 */

import {
	Component,
	Keymap,
	MarkdownRenderer,
	Menu,
	Notice,
	setIcon,
	setTooltip,
	type App,
} from 'obsidian';

import {
	STICKY_NOTE_ALPHA_MAX,
	STICKY_NOTE_ALPHA_MIN,
	STICKY_NOTE_ALPHA_STEP,
	STICKY_NOTE_COLORS,
	stepStickyNoteAlpha,
	type StickyNoteColor,
	type StickyNoteMode,
} from '../domain';
import type { StickyNoteRecord } from '../services';
import { hangPanel, placePanel } from './anchored-panel';
import { clickedWords, type ClickedWords } from './clicked-words';
import type { Translate } from './modals';
import type {
	SegmentEditorBackend,
	SegmentEditorHandle,
} from './segment-editor-backend';
import type { StickyNoteBridge } from './sticky-note-bridge';
import type { StickyNoteEditOwner } from './sticky-note-claims';
import { StickyNoteEditSession } from './sticky-note-editing';
import { formatStickyCreated, RESIZE_EDGES } from './sticky-note-layout';

/** The hover-link source a rendered note's internal links preview under. */
export const STICKY_NOTE_HOVER_SOURCE = 'snowflake-method-sticky-note';

export type StickyNoteSurface = 'dashboard' | 'sidebar' | 'floating';

export interface StickyNoteCardDeps {
	app: App;
	t: Translate;
	bridge: StickyNoteBridge;
	/** What the rendered Markdown lives under: the view, or a floating layer's own component. */
	component: Component;
	/** The surface's editor backend; one editor per note is the hub's rule, not this one's. */
	backend: SegmentEditorBackend;
	locale: string;
	/** The project may not be written to: every control that writes is off. */
	readOnly: boolean;
	/** Names this surface to the claims registry; one per board or layer. */
	ownerId: string;
}

/** The floating panel's own chrome: pin, transparency and close, answered by the layer. */
export interface StickyNoteFloatingChrome {
	/** Pinned in place: neither dragged nor resized until unpinned. */
	locked: boolean;
	alpha: number;
	onLock(next: boolean): void;
	onAlpha(next: number): void;
	onClose(): void;
}

export interface StickyNoteCardOptions {
	surface: StickyNoteSurface;
	initialMode?: StickyNoteMode;
	/** With `initialMode` editing: whether the caret is put in the note at once. */
	initialFocus?: boolean;
	floating?: StickyNoteFloatingChrome;
	/** A set-aside note: shown as it is, never edited or floated; its tools are open, restore and delete. */
	archived?: boolean;
	onModeChange?(mode: StickyNoteMode): void;
}

export interface StickyNoteCardHandle {
	readonly el: HTMLElement;
	/** The drag grip, when the card floats. */
	readonly head: HTMLElement;
	/** The eight resize grips, each naming its edge in `data-edge`; none unless the card floats. */
	readonly resizeGrips: readonly HTMLElement[];
	readonly id: string;
	readonly mode: StickyNoteMode;
	readonly note: StickyNoteRecord;
	update(note: StickyNoteRecord): void;
	setMode(mode: StickyNoteMode, focus?: boolean): Promise<void>;
	setLocked(locked: boolean): void;
	setAlpha(alpha: number): void;
	/** After the card was moved in the DOM with an editor mounted. */
	remeasure(): void;
	/** After the card moved on screen: a panel hanging off one of its buttons moves along. */
	followMove(): void;
	flush(): Promise<void>;
	dispose(): Promise<void>;
}

/** Each card answers to the claims as itself, not as its surface: see the constructor. */
let cardSerial = 0;

function iconButton(
	parent: HTMLElement,
	cls: string,
	icon: string,
	label: string,
): HTMLButtonElement {
	const button = parent.createEl('button', {
		cls: `clickable-icon ${cls}`,
		attr: { type: 'button', 'aria-label': label },
	});
	setIcon(button, icon);
	setTooltip(button, label);
	return button;
}

/**
 * The strip of the eight colour swatches, one or none of them chosen. The
 * strip's look is the manuscript tint strip's; each swatch carries its colour
 * through the shared tint class rather than a hex.
 */
export function renderStickySwatches(
	host: HTMLElement,
	spec: {
		value: StickyNoteColor | '';
		t: Translate;
		onPick(value: StickyNoteColor): void;
	},
): { sync(value: StickyNoteColor | ''): void } {
	const strip = host.createDiv({
		cls: 'snowflake-method-tint-swatches snowflake-method-sticky-swatches',
		attr: { role: 'radiogroup', 'aria-label': spec.t('stickyNotes.color') },
	});
	const swatches: { value: StickyNoteColor; el: HTMLButtonElement }[] = [];
	for (const value of STICKY_NOTE_COLORS) {
		const label = spec.t(`stickyNotes.color.${value}`);
		const el = strip.createEl('button', {
			cls: 'snowflake-method-tint-swatch snowflake-method-sticky-swatch snowflake-method-sticky-tint',
			attr: { type: 'button', role: 'radio', 'aria-label': label, 'data-color': value },
		});
		setTooltip(el, label);
		el.addEventListener('click', () => {
			spec.onPick(value);
		});
		swatches.push({ value, el });
	}
	const sync = (current: StickyNoteColor | ''): void => {
		for (const swatch of swatches) {
			const chosen = swatch.value === current;
			swatch.el.toggleClass('is-selected', chosen);
			swatch.el.setAttribute('aria-checked', String(chosen));
		}
	};
	sync(spec.value);
	return { sync };
}

class StickyNoteCard implements StickyNoteCardHandle {
	readonly el: HTMLElement;
	readonly head: HTMLElement;
	readonly resizeGrips: readonly HTMLElement[];
	mode: StickyNoteMode = 'viewing';
	note: StickyNoteRecord;

	private readonly rendered: HTMLElement;
	private readonly emptyEl: HTMLElement;
	private readonly bodyEl: HTMLElement;
	private readonly editorEl: HTMLElement;
	private readonly createdEl: HTMLElement;
	private readonly modeButton: HTMLButtonElement | null = null;
	private readonly floatButton: HTMLButtonElement | null = null;
	private readonly pinButton: HTMLButtonElement | null = null;
	private readonly alphaButton: HTMLButtonElement | null = null;
	private alphaInput: HTMLInputElement | null = null;
	private alpha = STICKY_NOTE_ALPHA_MAX;

	private renderChild: Component | null = null;
	private renderPass = 0;
	private renderedRevision: string | null = null;
	private editor: SegmentEditorHandle | null = null;
	private mountedPath: string | null = null;
	private session: StickyNoteEditSession | null = null;
	private swap: Promise<void> = Promise.resolve();
	/** The one panel hanging off a head button: the colours or the transparency. */
	private panel: { el: HTMLElement; anchor: HTMLElement; release(): void } | null = null;
	private disposed = false;
	private readonly archived: boolean;
	private readonly owner: StickyNoteEditOwner;

	constructor(
		host: HTMLElement,
		note: StickyNoteRecord,
		private readonly deps: StickyNoteCardDeps,
		private readonly options: StickyNoteCardOptions,
	) {
		const t = deps.t;
		this.note = note;
		// One owner per card, not per surface: a card built for a note while
		// the card it replaces is still flushing must wait for that one to let
		// go, or the two would share one claim and one editor path -- the old
		// card's unmount taking the new card's editor down with it.
		cardSerial += 1;
		this.owner = {
			id: `${deps.ownerId}/${String(cardSerial)}`,
			release: () => this.setMode('viewing'),
		};
		this.el = host.createDiv({
			cls: 'snowflake-method-sticky-card snowflake-method-sticky-tint is-viewing',
			attr: {
				'data-color': note.color,
				'data-surface': options.surface,
				'data-id': note.id,
				tabindex: '-1',
			},
		});
		const floating = options.floating;
		if (floating !== undefined) this.el.addClass('is-floating');
		this.archived = options.archived === true;
		if (this.archived) this.el.addClass('is-archived');

		this.head = this.el.createDiv({ cls: 'snowflake-method-sticky-head' });
		const colorButton = this.head.createEl('button', {
			cls: 'clickable-icon snowflake-method-sticky-color',
			attr: {
				type: 'button',
				'aria-haspopup': 'dialog',
				'aria-label': t('stickyNotes.color'),
			},
		});
		setIcon(colorButton, 'palette');
		setTooltip(colorButton, t('stickyNotes.color'));
		colorButton.disabled = deps.readOnly || this.archived;
		colorButton.addEventListener('click', () => {
			this.toggleColorPanel(colorButton);
		});
		this.createdEl = this.head.createSpan({ cls: 'snowflake-method-sticky-created' });
		this.paintCreated();

		const tools = this.head.createDiv({ cls: 'snowflake-method-sticky-tools' });
		if (this.archived) {
			// A note set aside: the way to its file, the way back, and the way out.
			const openButton = iconButton(
				tools,
				'snowflake-method-sticky-open',
				'file-text',
				t('actions.openNote'),
			);
			openButton.addEventListener('click', () => {
				void deps.bridge.openNote(this.note.path).catch((error: unknown) => {
					this.showError(error);
				});
			});
			const restoreButton = iconButton(
				tools,
				'snowflake-method-sticky-restore',
				'archive-restore',
				t('stickyNotes.restore'),
			);
			restoreButton.disabled = deps.readOnly;
			restoreButton.addEventListener('click', () => {
				this.act(deps.bridge.restore({ id: this.note.id, path: this.note.path }));
			});
			const trashButton = iconButton(
				tools,
				'snowflake-method-sticky-trash',
				'trash-2',
				t('actions.delete'),
			);
			trashButton.disabled = deps.readOnly;
			trashButton.addEventListener('click', () => {
				this.act(deps.bridge.deleteNote({ id: this.note.id, path: this.note.path }));
			});
		} else {
			this.modeButton = iconButton(
				tools,
				'snowflake-method-sticky-mode',
				'pencil',
				t('stickyNotes.edit'),
			);
			this.modeButton.addEventListener('click', () => {
				void this.setMode(this.mode === 'editing' ? 'viewing' : 'editing', true);
			});
			if (floating === undefined) {
				this.floatButton = iconButton(
					tools,
					'snowflake-method-sticky-float',
					'picture-in-picture-2',
					t('stickyNotes.float'),
				);
				this.floatButton.addEventListener('click', () => {
					void deps.bridge
						.float(this.note.id, this.el.win)
						.then(() => {
							this.paintFloatButton();
						})
						.catch((error: unknown) => {
							this.showError(error);
						});
				});
			} else {
				this.pinButton = iconButton(
					tools,
					'snowflake-method-sticky-pin',
					'pin',
					t('stickyNotes.pin'),
				);
				this.pinButton.addEventListener('click', () => {
					floating.onLock(!this.el.hasClass('is-locked'));
				});
				this.alphaButton = iconButton(
					tools,
					'snowflake-method-sticky-alpha-toggle',
					'droplet',
					t('stickyNotes.transparency'),
				);
				this.alphaButton.setAttribute('aria-haspopup', 'dialog');
				this.alphaButton.addEventListener('click', () => {
					this.toggleAlphaPanel(floating);
				});
			}
			const moreButton = iconButton(
				tools,
				'snowflake-method-sticky-more',
				'ellipsis',
				t('table.actions'),
			);
			moreButton.setAttribute('aria-haspopup', 'menu');
			moreButton.addEventListener('click', (event) => {
				this.openMenu(moreButton, event);
			});
			if (floating !== undefined) {
				const closeButton = iconButton(
					tools,
					'snowflake-method-sticky-close',
					'x',
					t('common.close'),
				);
				closeButton.addEventListener('click', () => {
					floating.onClose();
				});
				this.setLocked(floating.locked);
				this.setAlpha(floating.alpha);
			}

		}

		const body = this.el.createDiv({
			cls: 'snowflake-method-sticky-body snowflake-method-two-faces',
		});
		this.bodyEl = body;
		this.rendered = body.createDiv({
			cls: 'snowflake-method-sticky-rendered markdown-rendered',
			attr: { tabindex: '0' },
		});
		this.emptyEl = body.createEl('p', {
			cls: 'snowflake-method-sticky-empty',
			text: t('stickyNotes.placeholder'),
		});
		this.editorEl = body.createDiv({ cls: 'snowflake-method-sticky-editor' });
		this.resizeGrips =
			floating === undefined
				? []
				: RESIZE_EDGES.map((edge) =>
						this.el.createDiv({
							cls: 'snowflake-method-sticky-resize',
							attr: { 'data-edge': edge, 'aria-hidden': 'true' },
						}),
					);

		// A click anywhere on the note that is not a control is the way into
		// Editing; the rendered face adds the word clicked as the caret's place.
		this.el.addEventListener('click', (event) => {
			this.onCardClick(event);
		});
		// While editing, the editor is only as tall as its lines: a press on
		// the blank space under them keeps the focus in the editor and puts the
		// caret at the end, as the app's own editor does below its last line.
		body.addEventListener('mousedown', (event) => {
			if (this.mode !== 'editing' || this.editor === null || event.button !== 0) return;
			const target = event.target as HTMLElement | null;
			if (target === null || target.closest('.cm-editor') !== null) return;
			// The body is the scroll container: a press on its own scrollbar
			// lands here too, and is a scroll, not a click below the text.
			const box = body.getBoundingClientRect();
			const x = event.clientX - box.left - body.clientLeft;
			const y = event.clientY - box.top - body.clientTop;
			if (x < 0 || y < 0 || x >= body.clientWidth || y >= body.clientHeight) return;
			event.preventDefault();
			this.editor.focus();
			this.editor.enter('end');
		});
		this.rendered.addEventListener('mouseover', (event) => {
			const anchor =
				(event.target as HTMLElement | null)?.closest('a.internal-link') ??
				null;
			if (anchor === null) return;
			const linktext =
				anchor.getAttribute('data-href') ?? anchor.getAttribute('href') ?? '';
			if (linktext.length === 0) return;
			deps.app.workspace.trigger('hover-link', {
				event,
				source: STICKY_NOTE_HOVER_SOURCE,
				hoverParent: deps.component,
				targetEl: anchor,
				linktext,
				sourcePath: this.note.path,
			});
		});
		this.el.addEventListener('keydown', (event) => {
			this.onKeyDown(event);
		});

		this.paintModeButton();
		this.paintFloatButton();
		this.render();
		if (options.initialMode === 'editing' && !this.archived) {
			void this.setMode('editing', options.initialFocus === true);
		}
	}

	get id(): string {
		return this.note.id;
	}

	update(note: StickyNoteRecord): void {
		if (this.disposed) return;
		const previous = this.note;
		if (this.mode === 'editing' && this.session !== null) {
			if (this.session.take(note) === 'adopted') {
				this.note = note;
				if (this.session.pending === null) this.editor?.write(note.body);
			} else {
				// The typing goes on; only what the head shows follows the file.
				this.note = {
					...this.note,
					color: note.color,
					path: note.path,
					createdAt: note.createdAt,
					readOnly: note.readOnly,
				};
			}
		} else {
			this.note = note;
			if (note.revision !== this.renderedRevision) this.render();
		}
		if (note.color !== previous.color) this.paintColor();
		if (note.createdAt !== previous.createdAt) this.paintCreated();
		if (note.readOnly !== previous.readOnly) this.paintModeButton();
		this.paintFloatButton();
	}

	setMode(mode: StickyNoteMode, focus = false): Promise<void> {
		return this.swapTo(mode, focus, undefined);
	}

	setLocked(locked: boolean): void {
		this.el.toggleClass('is-locked', locked);
		if (this.pinButton === null) return;
		const label = this.deps.t(locked ? 'stickyNotes.unpin' : 'stickyNotes.pin');
		this.pinButton.setAttribute('aria-label', label);
		this.pinButton.setAttribute('aria-pressed', String(locked));
		setTooltip(this.pinButton, label);
		this.pinButton.toggleClass('is-active', locked);
	}

	setAlpha(alpha: number): void {
		const stepped = stepStickyNoteAlpha(alpha);
		this.alpha = stepped;
		this.el.setCssProps({ '--snowflake-method-sticky-alpha': `${String(stepped)}%` });
		if (this.alphaInput !== null && Number(this.alphaInput.value) !== stepped) {
			this.alphaInput.value = String(stepped);
		}
	}

	remeasure(): void {
		this.editor?.remeasure();
	}

	followMove(): void {
		const open = this.panel;
		if (open === null) return;
		placePanel(open.el, open.anchor, open.anchor.win);
	}

	async flush(): Promise<void> {
		await this.session?.flush();
	}

	async dispose(): Promise<void> {
		await this.setMode('viewing');
		this.disposed = true;
		this.closePanel();
		if (this.renderChild !== null) {
			this.deps.component.removeChild(this.renderChild);
			this.renderChild = null;
		}
		this.el.remove();
	}

	private swapTo(
		mode: StickyNoteMode,
		focus: boolean,
		clicked: ClickedWords | undefined,
	): Promise<void> {
		const run = async (): Promise<void> => {
			try {
				if (this.disposed) return;
				if (mode === this.mode) {
					if (mode === 'editing' && focus) this.editor?.focus();
					return;
				}
				if (mode === 'editing') await this.enterEditing(focus, clicked);
				else await this.leaveEditing();
			} catch (error) {
				this.showError(error);
			}
		};
		this.swap = this.swap.then(run);
		return this.swap;
	}

	private async enterEditing(
		focus: boolean,
		clicked: ClickedWords | undefined,
	): Promise<void> {
		if (this.deps.readOnly || this.archived) return;
		const claims = this.deps.bridge.hub.claims;
		await claims.claim(this.note.id, this.owner);
		// The lease check: a claim queued behind this one may have taken the
		// note meanwhile, and only its holder may mount.
		if (this.disposed || claims.owner(this.note.id) !== this.owner.id) return;
		const fresh = await this.deps.bridge.readNote(this.note.path);
		// A note this build may only read -- written by a newer one -- takes
		// no editor: every save from it would be refused.
		if (fresh === null || fresh.readOnly || this.disposed) {
			claims.release(this.note.id, this.owner.id);
			if (fresh !== null) {
				this.note = fresh;
				this.paintModeButton();
			}
			return;
		}
		this.note = fresh;
		this.paintColor();
		this.editorEl.empty();
		const preferences = this.deps.bridge.editorPreferences();
		const handle = await this.deps.backend.mount(
			{
				path: fresh.path,
				body: fresh.body,
				readOnly: false,
				autoPairBrackets: preferences.autoPairBrackets,
				autoPairMarkdown: preferences.autoPairMarkdown,
			},
			this.editorEl,
			{
				onChange: (_path, body) => {
					this.session?.changed(body);
				},
				onBlur: () => {
					void this.session?.flush();
				},
				onToggleReading: () => {
					void this.setMode('viewing');
				},
			},
		);
		this.editor = handle;
		this.mountedPath = fresh.path;
		this.session = new StickyNoteEditSession(fresh, {
			write: (path, body, revision) =>
				this.deps.bridge.writeBody(path, body, revision),
			read: (path) => this.deps.bridge.readNote(path),
			timers: {
				set: (handler, delayMs) => this.el.win.setTimeout(handler, delayMs),
				clear: (timer) => {
					this.el.win.clearTimeout(timer as number);
				},
			},
			onSaved: (record) => {
				this.note = record;
			},
			onConflict: () => {
				new Notice(this.deps.t('stickyNotes.changedElsewhere'));
			},
			onGone: () => {
				// The file is not there to write. The text stays on show, the
				// session holding it: a rename lands the note again under its
				// new name a moment later, and a deletion takes the card down.
			},
			onError: (error) => {
				this.showError(error);
			},
		});
		this.mode = 'editing';
		this.el.addClass('is-editing');
		this.el.removeClass('is-viewing');
		this.paintModeButton();
		this.options.onModeChange?.('editing');
		if (!focus) return;
		handle.focus();
		if (clicked !== undefined) this.putBack(handle, clicked);
		else handle.enter('end');
	}

	/**
	 * The caret under the words clicked, and the words back where they stood.
	 * The two faces wear one dress (styles.css), so the words stand very nearly
	 * where they stood -- a heading's line height apart at most -- and the body
	 * is scrolled by whatever `seek` says remains, measured from the top of
	 * the row clicked so the row lands where the rendered row was. Asked again
	 * over the next two frames, as the stream asks, because the first answer
	 * comes from an editor that has not measured itself yet; it stops the
	 * moment the author types or leaves.
	 */
	private putBack(handle: SegmentEditorHandle, clicked: ClickedWords): void {
		const session = this.session;
		const win = this.el.win;
		let frames = 0;
		const again = (): void => {
			if (
				this.editor !== handle ||
				session === null ||
				this.session !== session ||
				session.pending !== null
			) {
				return;
			}
			const gone = handle.seek(
				clicked.passage,
				clicked.lead,
				{ rowTop: clicked.rowTop, pointerY: clicked.screenY },
				clicked.near,
			);
			if (gone !== null && gone !== 0) this.bodyEl.scrollTop += gone;
			frames += 1;
			if (frames < 3) win.requestAnimationFrame(again);
		};
		again();
	}

	private async leaveEditing(): Promise<void> {
		const session = this.session;
		this.session = null;
		this.editor = null;
		const mounted = this.mountedPath;
		this.mountedPath = null;
		if (session !== null) {
			if (session.gone) session.discard();
			else await session.dispose();
		}
		if (mounted !== null) await this.deps.backend.unmount(mounted);
		this.deps.bridge.hub.claims.release(this.note.id, this.owner.id);
		this.mode = 'viewing';
		this.el.addClass('is-viewing');
		this.el.removeClass('is-editing');
		this.paintModeButton();
		this.options.onModeChange?.('viewing');
		this.render();
	}

	/** The rendered face, under a component of its own so a re-render lets the old one go. */
	private render(): void {
		this.renderPass += 1;
		const pass = this.renderPass;
		const note = this.note;
		this.renderedRevision = note.revision;
		if (this.renderChild !== null) this.deps.component.removeChild(this.renderChild);
		const child = new Component();
		this.renderChild = child;
		this.deps.component.addChild(child);
		this.rendered.empty();
		const blank = note.body.trim().length === 0;
		this.emptyEl.toggleClass('is-hidden', !blank);
		this.rendered.toggleClass('is-hidden', blank);
		if (blank) return;
		void MarkdownRenderer.render(
			this.deps.app,
			note.body,
			this.rendered,
			note.path,
			child,
		).catch((error: unknown) => {
			if (pass === this.renderPass) this.showError(error);
		});
	}

	private onCardClick(event: MouseEvent): void {
		const target = event.target as HTMLElement | null;
		if (target === null || this.mode === 'editing') return;
		const editable = !this.deps.readOnly && !this.note.readOnly && !this.archived;
		// The head's buttons and grips do their own work, and a head that was
		// just dragged was held, not clicked.
		if (
			target.closest(
				'.snowflake-method-sticky-tools, .snowflake-method-sticky-color, .snowflake-method-sticky-resize',
			) !== null ||
			this.el.hasClass('is-dragging')
		) {
			return;
		}
		if (!this.rendered.contains(target)) {
			if (editable) void this.setMode('editing', true);
			return;
		}
		// A link inside the note is a link, not an invitation to edit; an
		// internal one is this card's to open, as the stream opens its own.
		const anchor = target.closest('a');
		if (anchor !== null) {
			if (anchor.classList.contains('internal-link')) {
				event.preventDefault();
				const linktext =
					anchor.getAttribute('data-href') ?? anchor.getAttribute('href') ?? '';
				if (linktext.length > 0) {
					void this.deps.app.workspace
						.openLinkText(linktext, this.note.path, Keymap.isModEvent(event))
						.catch((error: unknown) => {
							this.showError(error);
						});
				}
			}
			return;
		}
		if (target.closest('input, button, .task-list-item-checkbox, .internal-embed') !== null) {
			return;
		}
		if (!editable) return;
		void this.swapTo(
			'editing',
			true,
			clickedWords(event, '.snowflake-method-sticky-rendered'),
		);
	}

	private onKeyDown(event: KeyboardEvent): void {
		// The editor's own bindings answer first: its completion popup takes
		// Escape. (Mod+E is the app's own reading-view hotkey and never reaches
		// a card, so the mode button and Escape are the ways between faces.)
		if (event.defaultPrevented) return;
		if (event.key === 'Escape' && this.mode === 'editing') {
			event.preventDefault();
			void this.setMode('viewing');
			this.modeButton?.focus();
			return;
		}
		if (event.key === 'Enter' && event.target === this.rendered && !this.archived) {
			event.preventDefault();
			void this.setMode('editing', true);
		}
	}

	private openMenu(anchor: HTMLElement, event: MouseEvent): void {
		const t = this.deps.t;
		const menu = new Menu();
		menu.setParentElement(anchor);
		menu.addItem((item) => {
			item
				.setTitle(t('actions.openNote'))
				.setIcon('file-text')
				.onClick(() => {
					void this.deps.bridge.openNote(this.note.path).catch((error: unknown) => {
						this.showError(error);
					});
				});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('stickyNotes.archive'))
				.setIcon('archive')
				.setDisabled(this.deps.readOnly)
				.onClick(() => {
					this.act(this.deps.bridge.archive({ id: this.note.id, path: this.note.path }));
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('actions.delete'))
				.setIcon('trash-2')
				.setWarning(true)
				.setDisabled(this.deps.readOnly)
				.onClick(() => {
					this.act(this.deps.bridge.deleteNote({ id: this.note.id, path: this.note.path }));
				});
		});
		menu.showAtMouseEvent(event);
	}

	/** A write the bridge may refuse, answered with the refusal or the error. */
	private act(work: Promise<boolean>): void {
		void work
			.then((took) => {
				if (!took) new Notice(this.deps.t('stickyNotes.refused'));
			})
			.catch((error: unknown) => {
				this.showError(error);
			});
	}

	private toggleColorPanel(anchor: HTMLElement): void {
		if (this.panel?.anchor === anchor) {
			this.closePanel();
			return;
		}
		const t = this.deps.t;
		this.openPanel(anchor, 'snowflake-method-sticky-color-panel', t('stickyNotes.color'), (panel) => {
			renderStickySwatches(panel, {
				value: this.note.color,
				t,
				onPick: (value) => {
					this.closePanel();
					this.act(this.deps.bridge.setColor({ id: this.note.id, path: this.note.path }, value));
				},
			});
		});
	}

	private toggleAlphaPanel(floating: StickyNoteFloatingChrome): void {
		const anchor = this.alphaButton;
		if (anchor === null) return;
		if (this.panel?.anchor === anchor) {
			this.closePanel();
			return;
		}
		const t = this.deps.t;
		this.openPanel(anchor, 'snowflake-method-sticky-alpha-panel', t('stickyNotes.transparency'), (panel) => {
			const input = panel.createEl('input', {
				cls: 'snowflake-method-sticky-alpha-range',
				attr: {
					type: 'range',
					min: String(STICKY_NOTE_ALPHA_MIN),
					max: String(STICKY_NOTE_ALPHA_MAX),
					step: String(STICKY_NOTE_ALPHA_STEP),
					'aria-label': t('stickyNotes.transparency'),
				},
			});
			input.value = String(this.alpha);
			const value = panel.createSpan({
				cls: 'snowflake-method-sticky-alpha-value',
				text: `${String(this.alpha)}%`,
			});
			input.addEventListener('input', () => {
				const next = stepStickyNoteAlpha(Number(input.value));
				this.setAlpha(next);
				value.setText(`${String(next)}%`);
				floating.onAlpha(next);
			});
			this.alphaInput = input;
		});
	}

	/**
	 * Hangs a panel under a head button, in the window's body so nothing
	 * clips it, following the button when the layout or a drag moves it and
	 * closing at a click outside or Escape. One panel at a time per card.
	 */
	private openPanel(
		anchor: HTMLElement,
		cls: string,
		label: string,
		build: (panel: HTMLElement) => void,
	): void {
		this.closePanel();
		const hung = hangPanel(anchor, {
			cls,
			label,
			build,
			onClose: () => {
				this.closePanel();
			},
		});
		this.panel = { el: hung.el, anchor, release: hung.release };
	}

	private closePanel(): void {
		const open = this.panel;
		if (open === null) return;
		this.panel = null;
		this.alphaInput = null;
		open.release();
		open.el.remove();
	}

	private paintColor(): void {
		this.el.setAttribute('data-color', this.note.color);
	}

	private paintCreated(): void {
		const label = formatStickyCreated(this.note.createdAt, this.deps.locale);
		this.createdEl.setText(label.short);
		const full = this.deps.t('stickyNotes.created', { when: label.full });
		this.createdEl.setAttribute('aria-label', full);
		setTooltip(this.createdEl, full);
	}

	private paintModeButton(): void {
		if (this.modeButton === null) return;
		const editing = this.mode === 'editing';
		setIcon(this.modeButton, editing ? 'book-open' : 'pencil');
		const label = this.deps.t(editing ? 'stickyNotes.view' : 'stickyNotes.edit');
		this.modeButton.setAttribute('aria-label', label);
		setTooltip(this.modeButton, label);
		this.modeButton.disabled = (this.deps.readOnly || this.note.readOnly) && !editing;
	}

	private paintFloatButton(): void {
		if (this.floatButton === null) return;
		const floating = this.deps.bridge.isFloating(this.note.id, this.el.win);
		this.floatButton.toggleClass('is-active', floating);
		const label = this.deps.t(floating ? 'stickyNotes.floating' : 'stickyNotes.float');
		this.floatButton.setAttribute('aria-label', label);
		setTooltip(this.floatButton, label);
	}

	private showError(error: unknown): void {
		new Notice(
			error instanceof Error ? error.message : this.deps.t('errors.unknown'),
		);
	}
}

export function renderStickyNoteCard(
	host: HTMLElement,
	note: StickyNoteRecord,
	deps: StickyNoteCardDeps,
	options: StickyNoteCardOptions,
): StickyNoteCardHandle {
	return new StickyNoteCard(host, note, deps, options);
}
