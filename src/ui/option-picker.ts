import { App, setIcon } from 'obsidian';

import { isNameTaken } from '../domain';
import { FieldSuggest } from './field-suggest';

/** Styles the rows only the option picker has. */
const PICKER_SUGGESTIONS_CLASS = 'snowflake-method-option-picker-suggestions';

export interface PickerOption {
	value: string;
	label: string;
}

/** The row offering to create the option the author typed but does not have. */
interface CreateSuggestion {
	/** Exactly what was typed, kept for the label and for the creation itself. */
	create: string;
}

type Suggestion = PickerOption | CreateSuggestion;

function isCreateSuggestion(suggestion: Suggestion): suggestion is CreateSuggestion {
	return 'create' in suggestion;
}

/** The options not yet picked, in the order the picker offers them. */
export function unpickedOptions<T extends { value: string }>(
	options: readonly T[],
	picked: readonly string[],
): T[] {
	const chosen = new Set(picked);
	return options.filter((option) => !chosen.has(option.value));
}

/** The options whose label contains `query`, matched without regard to case. */
export function optionsMatching<T extends { label: string }>(
	options: readonly T[],
	query: string,
): T[] {
	const needle = query.trim().toLocaleLowerCase();
	if (needle.length === 0) return [...options];
	return options.filter((option) =>
		option.label.toLocaleLowerCase().includes(needle),
	);
}

/**
 * Whether the author has typed a name worth offering to create: something other
 * than whitespace, and not the name of an option they could simply pick. The
 * comparison spans every option, not just the matches, so a name already taken
 * by a picked one is never offered a second time.
 *
 * Sameness is the same question the create form goes on to ask, so both are
 * settled by `isNameTaken`: a row offering to create a name the form would then
 * refuse is a dead end the author only finds out about after filling it in.
 */
export function offersCreating(
	options: readonly { label: string }[],
	query: string,
): boolean {
	if (query.trim().length === 0) return false;
	return !isNameTaken(
		options.map((option) => option.label),
		query,
	);
}

/**
 * Type-to-filter picker over a set of options. Options already picked are left
 * out of the suggestions, so the list shortens as the field fills up and the
 * same option cannot be picked twice.
 */
class OptionSuggest extends FieldSuggest<Suggestion> {
	private showAll = false;
	// The framework exposes no way to ask whether the list is showing, and a
	// refresh must not pop open a list the author had dismissed.
	private listOpen = false;
	// True from a pick until the list has been rebuilt, which is the window in
	// which a close would only make the list blink.
	private refreshing = false;
	// True between asking for the list and the framework showing it, so a second
	// ask in the same gesture does not set the whole query running twice.
	private openRequested = false;
	// The popover outlives each opening, so it is watched for the author reaching
	// into it only once.
	private selectionWatched = false;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		fieldEl: HTMLElement,
		private readonly listCandidates: () => readonly PickerOption[],
		private readonly onChooseOption: (option: PickerOption) => void,
		/** Null when the field cannot create what it does not already offer. */
		private readonly creating: {
			label: (query: string) => string;
			run: (query: string) => void;
			/** Every option, picked or not, so a taken name is not offered again. */
			allOptions: () => readonly PickerOption[];
		} | null,
		/**
		 * False for a one-value field, where the pick settles the question and
		 * popping the list straight back open would only be noise.
		 */
		private readonly reopenAfterPick: boolean,
	) {
		super(app, inputEl, fieldEl);
	}

	/** Opens the full list from the chevron, the way a dropdown would. */
	showAllSuggestions(): void {
		const view = this.inputEl.ownerDocument.defaultView;
		this.openRequested = true;
		// Cleared on the way in or out of the list; this only covers a query that
		// yields nothing, where the framework may do neither.
		view?.setTimeout(() => {
			this.openRequested = false;
		}, 0);
		this.inputEl.focus({ preventScroll: true });
		this.showAll = true;
		const EventConstructor = view?.Event ?? Event;
		this.inputEl.dispatchEvent(new EventConstructor('input', { bubbles: true }));
	}

	/** Opens the full list unless it is already showing, or on its way. */
	showAllSuggestionsUnlessOpen(): void {
		if (this.listOpen || this.openRequested) return;
		this.showAllSuggestions();
	}

	protected getSuggestions(query: string): Suggestion[] {
		const showAll = this.showAll;
		this.showAll = false;
		const typed = showAll ? '' : query;
		const matches: Suggestion[] = optionsMatching(this.listCandidates(), typed);
		if (
			this.creating !== null &&
			offersCreating(this.creating.allOptions(), typed)
		) {
			matches.push({ create: typed.trim() });
		}
		return matches;
	}

	renderSuggestion(suggestion: Suggestion, el: HTMLElement): void {
		if (isCreateSuggestion(suggestion)) {
			el.addClass('snowflake-method-option-picker-create');
			el.setText(this.creating?.label(suggestion.create) ?? suggestion.create);
			return;
		}
		el.setText(suggestion.label);
	}

	open(): void {
		super.open();
		this.listOpen = true;
		this.openRequested = false;
		// The picker's own popover class, so the rows that only this list has --
		// the create row, and the highlight it holds back -- can be styled without
		// reaching every other list the plugin puts under a field.
		this.popoverEl()?.addClass(PICKER_SUGGESTIONS_CLASS);
		this.idleSelection();
	}

	/** Closes for good, whatever the list was in the middle of. */
	destroy(): void {
		this.refreshing = false;
		super.destroy();
	}

	/**
	 * The framework highlights its first row the moment a list appears. With the
	 * list rebuilt after every pick, that highlight keeps snapping back to the
	 * top — a flash of its own, on a row nobody chose. It is held back until the
	 * author reaches for the list themselves, by arrow key or by pointer, and
	 * held back again each time the list is rebuilt.
	 */
	private idleSelection(): void {
		const suggestEl = this.popoverEl();
		if (suggestEl === null) return;
		suggestEl.addClass('is-selection-idle');
		if (this.selectionWatched) return;
		this.selectionWatched = true;
		const wake = (): void => suggestEl.removeClass('is-selection-idle');
		suggestEl.addEventListener('pointermove', wake);
		this.inputEl.addEventListener('keydown', (event) => {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') wake();
		});
	}

	close(): void {
		// A pick is followed by a close from us and another from the framework,
		// with the rebuilt list a beat behind both. Letting the list go dark in
		// between is the whole of the flashing, so a refresh that is already on
		// its way holds the list open and swaps the rows underneath instead.
		if (this.refreshing) return;
		super.close();
		this.popoverEl()?.removeClass(PICKER_SUGGESTIONS_CLASS);
		this.listOpen = false;
		this.openRequested = false;
	}

	selectSuggestion(suggestion: Suggestion): void {
		// Read before anything can tear the list down, so the refresh can put the
		// author back where they were reading.
		const scrollTop = this.popoverScrollTop();
		// A pick that leaves the list up must claim it before the closes start.
		if (this.reopenAfterPick && !isCreateSuggestion(suggestion)) {
			this.refreshing = true;
		}
		// The input is a search box, never a committed value, so it empties out
		// ready for the next query rather than keeping the label just chosen.
		this.setValue('');
		this.close();
		if (isCreateSuggestion(suggestion)) {
			this.creating?.run(suggestion.create);
			return;
		}
		this.onChooseOption(suggestion);
		if (this.reopenAfterPick) this.refreshSuggestions(scrollTop);
	}

	/**
	 * Brings an open list back in step with a selection that changed underneath
	 * it. A list that was already dismissed stays dismissed.
	 */
	refreshOpenSuggestions(): void {
		if (!this.listOpen) return;
		this.refreshing = true;
		this.refreshSuggestions(this.popoverScrollTop());
	}

	/**
	 * The element that actually scrolls. The framework keeps its rows in a
	 * container of its own inside the popover, so the popover itself never moves
	 * and reading `scrollTop` off it only ever gives zero — and it may build that
	 * container afresh from one render to the next, so it is found again each
	 * time rather than held on to.
	 */
	private popoverScroller(): HTMLElement | null {
		const suggestEl = this.popoverEl();
		const view = this.inputEl.ownerDocument.defaultView;
		if (suggestEl === null || view === null) return null;
		// Overflowing is not the same as scrolling: the popover clips its rows and
		// so overflows too, while only the container inside it actually moves.
		const scrolls = (el: HTMLElement): boolean => {
			if (el.scrollHeight <= el.clientHeight) return false;
			const { overflowY } = view.getComputedStyle(el);
			return overflowY === 'auto' || overflowY === 'scroll';
		};
		if (scrolls(suggestEl)) return suggestEl;
		for (const candidate of Array.from(
			suggestEl.querySelectorAll<HTMLElement>('*'),
		)) {
			if (scrolls(candidate)) return candidate;
		}
		return null;
	}

	private popoverScrollTop(): number {
		return this.popoverScroller()?.scrollTop ?? 0;
	}

	/**
	 * Suggestions are only recomputed from an `input` event, so a list left alone
	 * after the selection changes keeps offering a stale set. Re-running the query
	 * settles it while `close` holds the list up, so the rows are replaced under
	 * the author rather than the list disappearing and coming back.
	 *
	 * Deferred by a microtask: the closes that follow a pick have to have run
	 * before the list may reopen, or the reopen is the thing that gets closed.
	 */
	private refreshSuggestions(scrollTop: number): void {
		const view = this.inputEl.ownerDocument.defaultView;
		if (view === null) {
			this.refreshing = false;
			return;
		}
		void Promise.resolve().then(() => {
			this.refreshing = false;
			if (!this.inputEl.isConnected || this.inputEl.disabled) {
				this.close();
				return;
			}
			if (this.listCandidates().length === 0) {
				this.close();
				return;
			}
			this.holdScroll(scrollTop);
			this.showAllSuggestions();
		});
	}

	/**
	 * Puts the list back where the author had it, and keeps putting it back until
	 * the rows have settled: the framework may take several turns to replace them,
	 * each batch starting the list back at the top, and it scrolls its own
	 * highlighted row into view afterwards without any mutation announcing it.
	 * Watching for both is what makes this independent of how it renders.
	 */
	private holdScroll(scrollTop: number): void {
		const suggestEl = this.popoverEl();
		const view = this.inputEl.ownerDocument.defaultView;
		if (suggestEl === null || view === null || scrollTop === 0) return;
		let holding = true;
		const apply = (): void => {
			if (!holding) return;
			const scroller = this.popoverScroller();
			if (scroller === null || scroller.scrollTop === scrollTop) return;
			scroller.scrollTop = scrollTop;
		};
		const release = (): void => {
			if (!holding) return;
			holding = false;
			observer.disconnect();
			suggestEl.removeEventListener('scroll', apply, true);
			suggestEl.removeEventListener('wheel', release, true);
			suggestEl.removeEventListener('keydown', release, true);
		};
		apply();
		const observer = new view.MutationObserver(apply);
		observer.observe(suggestEl, { childList: true, subtree: true });
		// The rows arriving is only half of it: the framework then scrolls its
		// highlighted row into view, which no mutation announces — but it does
		// move the scroller, so watching for that is what catches it. Capture,
		// because scroll events do not bubble and the container that scrolls is
		// rebuilt with every render.
		suggestEl.addEventListener('scroll', apply, true);
		// The author reaching for the list themselves ends the hold at once, so
		// their own scrolling is never fought.
		suggestEl.addEventListener('wheel', release, true);
		suggestEl.addEventListener('keydown', release, true);
		view.setTimeout(release, 250);
	}
}

interface OptionPickerBaseConfig {
	/** Every option the picker can offer, in the order it offers them. */
	options: () => readonly PickerOption[];
	/** Names the field for screen readers and labels the chevron. */
	label: string;
	placeholder: string;
	/** Shown instead of `placeholder` when the picker has nothing to offer. */
	emptyPlaceholder: string;
	required?: boolean;
	/** Omitted when the field cannot create an option it does not have. */
	create?: {
		/** Names the create row, given exactly what was typed. */
		label: (typed: string) => string;
		/**
		 * Creates the option and reports it back, or reports null when the author
		 * backed out. Awaited, so the field can pick what it just created.
		 */
		run: (typed: string) => Promise<PickerOption | null>;
	};
}

export interface OptionPickerConfig extends OptionPickerBaseConfig {
	/** The values picked so far. Read again after every change. */
	picked: () => readonly string[];
	pick: (value: string) => void;
	unpick: (value: string) => void;
	removeLabel: (label: string) => string;
}

export interface OptionFieldConfig extends OptionPickerBaseConfig {
	/** The value held now, or the empty string when the field is unset. */
	value: () => string;
	choose: (value: string) => void;
}

export interface OptionPicker {
	/** Closes a suggestion list left open when the field goes away. */
	destroy(): void;
}

interface PickerFrame {
	picker: HTMLElement;
	field: HTMLElement;
	values: HTMLElement;
	input: HTMLInputElement;
	selector: HTMLButtonElement;
	/** True when the field has nothing to offer and no way to make anything. */
	deadEnd: boolean;
}

function buildPickerFrame(
	container: HTMLElement,
	config: OptionPickerBaseConfig,
	single: boolean,
): PickerFrame {
	const picker = container.createDiv({ cls: 'snowflake-method-option-picker' });
	if (single) picker.addClass('is-single');
	const field = picker.createDiv({
		cls: 'snowflake-method-option-picker-field',
	});
	const values = field.createDiv({
		cls: 'snowflake-method-option-picker-values',
	});
	const input = values.createEl('input', {
		cls: 'snowflake-method-option-picker-input',
		type: 'text',
		attr: {
			'aria-label': config.label,
			spellcheck: 'false',
		},
	});
	if (config.required === true) input.setAttribute('aria-required', 'true');
	// A field that can create its own options is never a dead end, so it stays
	// usable even before the project has anything to offer.
	const deadEnd = config.options().length === 0 && config.create === undefined;
	input.disabled = deadEnd;
	const selector = field.createEl('button', {
		cls: 'clickable-icon snowflake-method-option-picker-selector',
		attr: {
			type: 'button',
			'aria-label': config.label,
			title: config.label,
		},
	});
	setIcon(selector, 'chevrons-up-down');
	selector.disabled = deadEnd;
	return { picker, field, values, input, selector, deadEnd };
}

/** Wires the frame's chevron and its click-anywhere-to-type behaviour. */
function wireFrame(frame: PickerFrame, suggest: OptionSuggest): void {
	// The chevron opens the list rather than taking focus off the search box.
	frame.selector.addEventListener('mousedown', (event) => {
		event.preventDefault();
	});
	frame.selector.addEventListener('click', () => {
		suggest.showAllSuggestions();
	});
	// Clicking the padding around the contents should land in the search box, the
	// way clicking anywhere in a text field does.
	frame.field.addEventListener('pointerdown', (event) => {
		if (event.target !== frame.field && event.target !== frame.values) return;
		event.preventDefault();
		frame.input.focus({ preventScroll: true });
	});
}

/**
 * A field holding several values, each shown as a tag that can be removed on
 * its own.
 */
export function buildOptionPicker(
	app: App,
	container: HTMLElement,
	config: OptionPickerConfig,
): OptionPicker {
	const frame = buildPickerFrame(container, config, false);
	const { values, input } = frame;

	const candidates = (): readonly PickerOption[] =>
		unpickedOptions(config.options(), config.picked());

	const renderTags = (): void => {
		for (const tag of Array.from(
			values.querySelectorAll('.snowflake-method-option-picker-tag'),
		)) {
			tag.remove();
		}
		const picked = new Set(config.picked());
		for (const option of config.options()) {
			if (!picked.has(option.value)) continue;
			const tag = values.createSpan({
				cls: 'snowflake-method-option-picker-tag',
			});
			// A narrow field ellipsizes a long label, so the tooltip is the only way
			// left to read it in full.
			tag.createSpan({ text: option.label, attr: { title: option.label } });
			const remove = tag.createEl('button', {
				cls: 'snowflake-method-option-picker-remove clickable-icon',
				attr: {
					type: 'button',
					'aria-label': config.removeLabel(option.label),
				},
			});
			setIcon(remove, 'x');
			// Taking focus would blur the search box, and the framework closes the
			// list on blur — so the × would dismiss the list and the refresh would
			// bring it back from the top, which backspacing never does.
			remove.addEventListener('mousedown', (event) => {
				event.preventDefault();
			});
			remove.addEventListener('click', () => {
				unpick(option.value);
				input.focus({ preventScroll: true });
			});
			// The input stays last so typing always continues after the tags.
			values.insertBefore(tag, input);
		}
		// A field that can create says what to type even with nothing on offer;
		// only one that can do neither admits it is empty.
		input.placeholder = frame.deadEnd
			? config.emptyPlaceholder
			: picked.size === 0
				? config.placeholder
				: '';
	};

	const unpick = (value: string): void => {
		config.unpick(value);
		renderTags();
		// The option is a candidate again, and the field may have just unwrapped a
		// row, so a list still showing is now wrong twice over.
		suggest.refreshOpenSuggestions();
	};

	const pick = (option: PickerOption): void => {
		config.pick(option.value);
		renderTags();
	};

	const creating = creatingFor(config, (created) => {
		pick(created);
		input.focus({ preventScroll: true });
		// A list the closing form left open is a name short; picking the new one
		// also takes it back out of the running.
		suggest.refreshOpenSuggestions();
	});
	const suggest = new OptionSuggest(
		app,
		input,
		frame.field,
		candidates,
		pick,
		creating.suggest,
		true,
	);
	wireFrame(frame, suggest);
	// Backspace on an empty query removes the last tag, as tag inputs do.
	input.addEventListener('keydown', (event) => {
		if (event.key !== 'Backspace' || input.value.length > 0) return;
		// Indexed rather than `at(-1)`, which this project's ES2021 target does
		// not declare — where nothing else happens to pull the later library in,
		// its type does not resolve and everything read from it goes untyped.
		const picked = config.picked();
		const last = picked[picked.length - 1];
		if (last === undefined) return;
		event.preventDefault();
		unpick(last);
	});
	renderTags();

	return { destroy: () => suggest.destroy() };
}

/**
 * A field holding one value, shown as plain text the way any other single-value
 * control shows it. Only a pick from the list changes the value, so the text can
 * never drift into something the field would then save.
 */
export function buildOptionField(
	app: App,
	container: HTMLElement,
	config: OptionFieldConfig,
): OptionPicker {
	const frame = buildPickerFrame(container, config, true);
	const { input } = frame;

	const labelFor = (value: string): string =>
		config.options().find((option) => option.value === value)?.label ?? '';

	/** Puts the committed value back on show, discarding an abandoned query. */
	const showValue = (): void => {
		input.value = labelFor(config.value());
		input.placeholder = frame.deadEnd
			? config.emptyPlaceholder
			: config.placeholder;
	};

	// Every option stays on offer, including the one held now: picking another is
	// how the value is changed, with no need to clear the field first.
	const candidates = (): readonly PickerOption[] => config.options();

	const choose = (option: PickerOption): void => {
		config.choose(option.value);
		showValue();
	};

	const creating = creatingFor(config, (created) => {
		choose(created);
		input.focus({ preventScroll: true });
		// The choice is made, so no list is wanted — least of all the one the
		// closing form left open, which predates the character just created.
		suggest.close();
	});
	const suggest = new OptionSuggest(
		app,
		input,
		frame.field,
		candidates,
		choose,
		creating.suggest,
		false,
	);
	wireFrame(frame, suggest);
	// The text is the value, so typing starts a fresh search rather than editing
	// the name of what is already there — and the list opens on the way in, the
	// way a dropdown shows its options the moment it is clicked.
	input.addEventListener('focus', () => {
		input.select();
		// Focus also lands here when the character form closes, at which point the
		// value is a moment away from changing and the options are a name short.
		if (creating.inFlight()) return;
		suggest.showAllSuggestions();
	});
	// Picking closes the list but leaves the field focused, and clicking a field
	// that already has focus fires no focus event — so without this the list
	// would only come back by leaving the field and returning to it.
	frame.field.addEventListener('click', () => {
		if (creating.inFlight()) return;
		suggest.showAllSuggestionsUnlessOpen();
	});
	// Whatever was typed was only ever a query. Leaving without picking restores
	// the value, so the field never shows a name it is not holding.
	input.addEventListener('blur', () => {
		showValue();
	});
	showValue();

	return { destroy: () => suggest.destroy() };
}

interface Creating {
	/** Null when the field cannot create an option it does not have. */
	suggest: ConstructorParameters<typeof OptionSuggest>[5];
	/**
	 * True from the moment creating starts until the field has taken the result.
	 * Creating runs behind a form of its own, and closing that form hands focus
	 * back to this field before the new option is in hand — so anything that
	 * reacts to focus has to sit the window out rather than act on a list that is
	 * about to be a name short.
	 */
	inFlight: () => boolean;
}

/**
 * Adapts the create half of a config for the suggester, handing back the option
 * that was created so the field can select it. Nothing is selected when the
 * author backs out of creating.
 */
function creatingFor(
	config: OptionPickerBaseConfig,
	onCreated: (created: PickerOption) => void,
): Creating {
	const create = config.create;
	if (create === undefined) return { suggest: null, inFlight: () => false };
	let running = 0;
	return {
		suggest: {
			label: create.label,
			allOptions: config.options,
			run: (typed) => {
				running += 1;
				void create
					.run(typed)
					.then((created) => {
						if (created !== null) onCreated(created);
					})
					.finally(() => {
						running -= 1;
					});
			},
		},
		inFlight: () => running > 0,
	};
}
