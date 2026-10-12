/**
 * The stream's find bar: Obsidian's own bar above a note, in its own markup
 * and so in whatever dress the theme gives that one, with what a code
 * editor's find bar adds to it. A chevron opens the replace row, and the
 * query's three options stand inside its box: match case, whole words, and a
 * regular expression.
 *
 * The keys are the app's bar's: Enter and Shift+Enter, F3 and Mod+G walk the
 * matches, Enter in the replace box replaces, Mod+Alt+Enter replaces them all,
 * Tab crosses between the two boxes and Escape closes the bar. They ride a
 * scope the view wears while the bar is open, so they are heard ahead of
 * the app and answered only where they are the bar's.
 *
 * What the bar is asked for is said through the hooks; finding and
 * replacing are the stream's.
 */

import { Platform, Scope, setIcon, setTooltip, type Modifier } from 'obsidian';

import type { TextSearchOptions } from '../domain';
import type { StreamSearchCount } from './stream-search';

export interface StreamSearchBarHooks {
	t: (key: string, vars?: Record<string, string | number>) => string;
	/** The query or one of its options changed. */
	onQuery(): void;
	onStep(direction: 1 | -1): void;
	onReplace(): void;
	onReplaceAll(): void;
	/** The bar asked to be closed: Escape, or its close button. */
	onClose(): void;
	/**
	 * Whether an Escape pressed outside the bar, elsewhere in the view, closes
	 * it: in the note being written, unless a popup there is the Escape's.
	 */
	escapeOutside(): boolean;
}

/** How long typing in the find box may pause before the manuscript is searched. */
const QUERY_DELAY_MS = 120;

type OptionName = keyof TextSearchOptions;

const OPTIONS: readonly { name: OptionName; icon: string; label: string; key: string }[] = [
	{ name: 'caseSensitive', icon: 'uppercase-lowercase-a', label: 'manuscript.search.matchCase', key: 'C' },
	{ name: 'wholeWord', icon: 'whole-word', label: 'manuscript.search.wholeWord', key: 'W' },
	{ name: 'regex', icon: 'regex', label: 'manuscript.search.regex', key: 'R' },
];

/** The chord as the app's tooltips write one: symbols on a Mac, names joined elsewhere. */
export function chordLabel(modifiers: readonly Modifier[], key: string, mac: boolean): string {
	const names: Record<Modifier, [string, string]> = {
		Mod: ['⌘', 'Ctrl'],
		Ctrl: ['⌃', 'Ctrl'],
		Meta: ['⌘', 'Win'],
		Alt: ['⌥', 'Alt'],
		Shift: ['⇧', 'Shift'],
	};
	const parts = modifiers.map((modifier) => names[modifier][mac ? 0 : 1]);
	return mac ? [...parts, key].join(' ') : [...parts, key].join(' + ');
}

export class StreamSearchBar {
	readonly containerEl: HTMLElement;
	/** The keys, worn by the view in place of its own scope while the bar is open. */
	readonly scope: Scope;
	private readonly findInput: HTMLInputElement;
	private readonly replaceInput: HTMLInputElement;
	private readonly inputBox: HTMLElement;
	private readonly countEl: HTMLElement;
	private readonly optionsEl: HTMLElement;
	private readonly toggleEl: HTMLElement;
	private readonly optionButtons = new Map<OptionName, HTMLElement>();
	private readonly options: TextSearchOptions = {
		caseSensitive: false,
		wholeWord: false,
		regex: false,
	};
	private replaceMode = false;
	private replaceAllowed = true;
	private queryTimer: number | null = null;

	constructor(
		parent: HTMLElement,
		parentScope: Scope,
		private readonly hooks: StreamSearchBarHooks,
	) {
		const { t } = hooks;
		const mac = Platform.isMacOS;
		this.containerEl = parent.createDiv({
			cls: 'document-search-container snowflake-method-stream-search',
		});
		const row = this.containerEl.createDiv({ cls: 'document-search' });
		const button = (
			holder: HTMLElement,
			icon: string,
			label: string,
			act: () => void,
		): HTMLElement => {
			const el = holder.createEl('button', {
				cls: 'clickable-icon document-search-button',
				attr: { type: 'button' },
			});
			setIcon(el, icon);
			setTooltip(el, label, { placement: 'top' });
			// The caret stays in the box it was in, as it does on the app's bar.
			el.addEventListener('mousedown', (event) => {
				event.preventDefault();
			});
			el.addEventListener('click', (event) => {
				event.preventDefault();
				act();
			});
			return el;
		};

		this.toggleEl = button(row, 'chevron-right', t('manuscript.search.showReplace'), () => {
			if (!this.replaceAllowed) return;
			this.setReplaceMode(!this.replaceMode);
			if (this.replaceMode) this.replaceInput.focus();
			else this.findInput.focus();
		});
		this.toggleEl.addClass('snowflake-method-search-replace-toggle');
		this.toggleEl.setAttribute('aria-expanded', 'false');

		this.inputBox = row.createDiv({ cls: 'search-input-container document-search-input' });
		this.findInput = this.inputBox.createEl('input', {
			attr: { type: 'text', placeholder: t('manuscript.search.find'), spellcheck: 'false' },
		});
		this.countEl = this.inputBox.createDiv({ cls: 'document-search-count' });
		this.countEl.hide();
		this.optionsEl = this.inputBox.createDiv({ cls: 'snowflake-method-search-options' });
		for (const option of OPTIONS) {
			const el = this.optionsEl.createEl('button', {
				cls: 'clickable-icon snowflake-method-search-option',
				attr: { type: 'button', 'aria-pressed': 'false' },
			});
			setIcon(el, option.icon);
			setTooltip(
				el,
				`${t(option.label)}\n${chordLabel(mac ? ['Mod', 'Alt'] : ['Alt'], option.key, mac)}`,
				{ placement: 'top' },
			);
			el.addEventListener('mousedown', (event) => {
				event.preventDefault();
			});
			el.addEventListener('click', (event) => {
				event.preventDefault();
				this.flip(option.name);
			});
			this.optionButtons.set(option.name, el);
		}
		this.findInput.addEventListener('input', (event) => {
			// The query is read once the input method has settled on its
			// characters, not at every keystroke of the spelling.
			if (event.isComposing) return;
			this.queueQuery();
		});
		this.findInput.addEventListener('compositionend', () => {
			this.queueQuery();
		});

		// The close stands in the same group as the arrows, so the three sit
		// side by side as the buttons in a chapter's header do, in its columns.
		const walk = row.createDiv({ cls: 'document-search-buttons' });
		button(walk, 'arrow-up', `${t('manuscript.search.previous')}\n${chordLabel(['Shift'], 'F3', mac)}`, () => {
			this.step(-1);
		});
		button(walk, 'arrow-down', `${t('manuscript.search.next')}\n${chordLabel([], 'F3', mac)}`, () => {
			this.step(1);
		});
		const close = walk.createDiv({ cls: 'clickable-icon document-search-close-button' });
		setIcon(close, 'x');
		setTooltip(close, t('manuscript.search.close'), { placement: 'top' });
		close.addEventListener('click', (event) => {
			event.preventDefault();
			hooks.onClose();
		});

		const replaceRow = this.containerEl.createDiv({ cls: 'document-replace' });
		// Stands where the chevron stands above, so the two boxes line up.
		const spacer = replaceRow.createDiv({
			cls: 'clickable-icon snowflake-method-search-spacer',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(spacer, 'chevron-right');
		// A box of the app's search kind, so the replace box wears a symbol of
		// its own where the find box wears the magnifier, drawn the same way.
		const replaceBox = replaceRow.createDiv({
			cls: 'search-input-container snowflake-method-replace-box',
		});
		this.replaceInput = replaceBox.createEl('input', {
			cls: 'document-replace-input',
			attr: { type: 'text', placeholder: t('manuscript.search.replacePlaceholder'), spellcheck: 'false' },
		});
		const replacing = replaceRow.createDiv({ cls: 'document-replace-buttons' });
		button(replacing, 'replace', `${t('manuscript.search.replace')}\n${chordLabel([], 'Enter', mac)}`, () => {
			this.flushQuery();
			hooks.onReplace();
		});
		button(
			replacing,
			'replace-all',
			`${t('manuscript.search.replaceAll')}\n${chordLabel(['Mod', 'Alt'], 'Enter', mac)}`,
			() => {
				this.flushQuery();
				hooks.onReplaceAll();
			},
		);

		this.scope = new Scope(parentScope);
		this.registerKeys(mac);
	}

	/** The query's options as they stand. */
	searchOptions(): TextSearchOptions {
		return { ...this.options };
	}

	query(): string {
		return this.findInput.value;
	}

	replacement(): string {
		return this.replaceInput.value;
	}

	isReplaceMode(): boolean {
		return this.replaceMode && this.replaceAllowed;
	}

	/** Whether the caret is in the bar, in either box or on one of its buttons. */
	hasFocus(): boolean {
		const active = this.containerEl.doc.activeElement;
		return active !== null && this.containerEl.contains(active);
	}

	/**
	 * Opens on a query: the words handed in, or the last query kept. The find
	 * box takes the caret with all of its text selected, so typing replaces
	 * it, as it does on the app's bar. The replace row is shown or not as
	 * asked, or, with null, left as it stands: a press that only brings the
	 * caret back to an open bar does not fold the row the author opened.
	 */
	open(replace: boolean | null, seed: string | null): void {
		if (replace !== null) this.setReplaceMode(replace);
		if (seed !== null && seed !== this.findInput.value) {
			this.findInput.value = this.options.regex ? seed.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') : seed;
		}
		this.focusFind();
		this.layoutInput();
	}

	focusFind(): void {
		this.findInput.focus();
		this.findInput.select();
	}

	/** A read-only manuscript keeps the bar's finding and loses its replacing. */
	setReplaceAllowed(allowed: boolean): void {
		this.replaceAllowed = allowed;
		this.toggleEl.setAttribute('aria-disabled', String(!allowed));
		this.paintReplaceMode();
	}

	setReplaceMode(on: boolean): void {
		this.replaceMode = on;
		this.paintReplaceMode();
	}

	showCount(count: StreamSearchCount): void {
		const { t } = this.hooks;
		this.inputBox.toggleClass(
			'mod-no-match',
			count.kind === 'error' || (count.kind === 'count' && count.total === 0),
		);
		setTooltip(this.countEl, count.kind === 'error' ? count.message : '');
		if (count.kind === 'none') {
			this.countEl.hide();
			this.countEl.setText('');
		} else {
			this.countEl.show();
			this.countEl.setText(
				count.kind === 'busy'
					? '…'
					: count.kind === 'error'
						? t('manuscript.search.invalid')
						: `${String(count.index)} / ${String(count.total)}${count.limited ? '+' : ''}`,
			);
		}
		this.layoutInput();
	}

	destroy(): void {
		this.cancelQuery();
		this.containerEl.remove();
	}

	/**
	 * Room at the end of the find box for what stands over it there: the
	 * options and the count, measured, because the count's width changes
	 * with its digits and the options' with the theme's icons.
	 */
	private layoutInput(): void {
		if (!this.containerEl.isConnected) return;
		const options = this.optionsEl.getBoundingClientRect().width;
		const count = this.countEl.isShown() ? this.countEl.getBoundingClientRect().width : 0;
		this.inputBox.style.setProperty('--snowflake-method-search-options-width', `${String(Math.ceil(options))}px`);
		this.inputBox.style.setProperty('--snowflake-method-search-count-width', `${String(Math.ceil(count))}px`);
	}

	private paintReplaceMode(): void {
		const on = this.isReplaceMode();
		this.containerEl.toggleClass('mod-replace-mode', on);
		setIcon(this.toggleEl, on ? 'chevron-down' : 'chevron-right');
		setTooltip(
			this.toggleEl,
			this.hooks.t(on ? 'manuscript.search.hideReplace' : 'manuscript.search.showReplace'),
			{ placement: 'top' },
		);
		this.toggleEl.setAttribute('aria-expanded', String(on));
	}

	private flip(name: OptionName): void {
		this.options[name] = !this.options[name];
		const el = this.optionButtons.get(name);
		el?.toggleClass('is-active', this.options[name]);
		el?.setAttribute('aria-pressed', String(this.options[name]));
		this.cancelQuery();
		this.hooks.onQuery();
	}

	private queueQuery(): void {
		this.cancelQuery();
		this.queryTimer = this.containerEl.win.setTimeout(() => {
			this.queryTimer = null;
			this.hooks.onQuery();
		}, QUERY_DELAY_MS);
	}

	/** A query still waiting on its pause is asked now, so a key that follows acts on it. */
	private flushQuery(): void {
		if (this.queryTimer === null) return;
		this.cancelQuery();
		this.hooks.onQuery();
	}

	private cancelQuery(): void {
		if (this.queryTimer === null) return;
		this.containerEl.win.clearTimeout(this.queryTimer);
		this.queryTimer = null;
	}

	private step(direction: 1 | -1): void {
		this.flushQuery();
		this.hooks.onStep(direction);
	}

	private inBox(): 'find' | 'replace' | null {
		const active = this.containerEl.doc.activeElement;
		if (active === this.findInput) return 'find';
		if (active === this.replaceInput) return 'replace';
		return null;
	}

	/**
	 * Each key answers only where it is the bar's, and is handed on to the
	 * page otherwise, Enter to the editor above all. Handed on means the key
	 * reaches the page as it was pressed; a key the bar answers goes no
	 * further. A key an input method is spelling with is always its.
	 */
	private registerKeys(mac: boolean): void {
		const { scope } = this;
		const handOn = true;
		const answered = false;
		const whenInBox =
			(act: (box: 'find' | 'replace') => void) =>
			(event: KeyboardEvent): boolean => {
				if (event.isComposing) return handOn;
				const box = this.inBox();
				if (box === null) return handOn;
				act(box);
				return answered;
			};
		scope.register(
			[],
			'Enter',
			whenInBox((box) => {
				if (box === 'replace' && this.isReplaceMode() && this.replaceInput.value !== '') {
					this.flushQuery();
					this.hooks.onReplace();
					return;
				}
				this.step(1);
			}),
		);
		scope.register(['Shift'], 'Enter', whenInBox(() => {
			this.step(-1);
		}));
		scope.register(['Mod', 'Alt'], 'Enter', whenInBox(() => {
			if (!this.isReplaceMode()) return;
			this.flushQuery();
			this.hooks.onReplaceAll();
		}));
		const walk = (direction: 1 | -1) => (): boolean => {
			this.step(direction);
			return answered;
		};
		scope.register([], 'F3', walk(1));
		scope.register(['Shift'], 'F3', walk(-1));
		scope.register(['Mod'], 'g', walk(1));
		scope.register(['Mod', 'Shift'], 'g', walk(-1));
		// Between the two boxes while both stand; with the replace row shut,
		// Tab walks on to the buttons as it would anywhere.
		const cross = (event: KeyboardEvent): boolean => {
			if (!this.isReplaceMode()) return handOn;
			return whenInBox((box) => {
				(box === 'find' ? this.replaceInput : this.findInput).focus();
			})(event);
		};
		scope.register([], 'Tab', cross);
		scope.register(['Shift'], 'Tab', cross);
		// The letters as the app registers its own, by the key's name: on a Mac
		// Option turns the letter typed into another character, and only the
		// key's name still answers to the chord.
		for (const option of OPTIONS) {
			scope.register(mac ? ['Mod', 'Alt'] : ['Alt'], option.key, (event) => {
				if (!this.hasFocus() || event.isComposing) return handOn;
				this.flip(option.name);
				return answered;
			});
		}
		scope.register([], 'Escape', (event) => {
			if (event.isComposing) return handOn;
			if (!this.hasFocus() && !this.hooks.escapeOutside()) return handOn;
			this.hooks.onClose();
			return answered;
		});
	}
}
