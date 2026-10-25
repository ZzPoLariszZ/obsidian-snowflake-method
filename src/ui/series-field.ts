import { App, setIcon } from 'obsidian';

import { wireCaretKeepingPress } from './caret-press';

import { FieldSuggest } from './field-suggest';

/**
 * The field that names a project's series, in the create form and the
 * series dialog alike: a text box the author may type any name into, with
 * the names the other projects already stand under offered as they type and
 * all at once from the chevron, so a book joins its series by the spelling
 * the series already has.
 */
export interface SeriesField {
	readonly inputEl: HTMLInputElement;
	/** Puts a value on show, for a form that is redrawn around the field. */
	showValue(name: string): void;
	/** Closes a list left open when the field goes away. */
	destroy(): void;
}

export interface SeriesFieldConfig {
	/** Names the field for screen readers and labels the chevron. */
	label: string;
	placeholder: string;
	/** The series the other projects stand in, once each. */
	names: readonly string[];
	value: string;
	/** Every change, typed or picked. */
	onChange: (name: string) => void;
}

class SeriesSuggest extends FieldSuggest<string> {
	private showAll = false;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		fieldEl: HTMLElement,
		private readonly names: readonly string[],
		private readonly onChoose: (name: string) => void,
	) {
		super(app, inputEl, fieldEl);
	}

	/** Opens the full list from the chevron, the way a dropdown would. */
	showAllSuggestions(): void {
		this.inputEl.focus({ preventScroll: true });
		this.showAll = true;
		const EventConstructor =
			this.inputEl.ownerDocument.defaultView?.Event ?? Event;
		this.inputEl.dispatchEvent(
			new EventConstructor('input', { bubbles: true }),
		);
	}

	protected getSuggestions(query: string): string[] {
		const showAll = this.showAll;
		this.showAll = false;
		const needle = showAll ? '' : query.trim().toLowerCase();
		return this.names.filter((name) => name.toLowerCase().includes(needle));
	}

	renderSuggestion(name: string, el: HTMLElement): void {
		el.setText(name);
	}

	selectSuggestion(name: string): void {
		this.setValue(name);
		this.close();
		this.onChoose(name);
	}
}

export function buildSeriesField(
	app: App,
	container: HTMLElement,
	config: SeriesFieldConfig,
): SeriesField {
	// Dressed as the root field is: the same box, the same chevron, so the
	// two fields that offer a list of names read as one kind of control.
	const control = container.createDiv({
		cls: 'snowflake-method-root-field snowflake-method-series-field',
	});
	const input = control.createEl('input', {
		type: 'text',
		value: config.value,
		placeholder: config.placeholder,
		attr: { 'aria-label': config.label, spellcheck: 'false' },
	});
	const selector = control.createEl('button', {
		cls: 'clickable-icon snowflake-method-root-field-selector',
		attr: { type: 'button', 'aria-label': config.label },
	});
	setIcon(selector, 'chevrons-up-down');
	// A chevron over no names would open an empty list and say nothing.
	selector.disabled = config.names.length === 0;

	const suggest = new SeriesSuggest(app, input, control, config.names, (name) => {
		config.onChange(name);
	});
	input.addEventListener('input', () => {
		config.onChange(input.value);
	});
	// The chevron opens the list rather than taking focus off the text box.
	wireCaretKeepingPress(selector, () => {
		suggest.showAllSuggestions();
	});

	return {
		inputEl: input,
		showValue: (name) => {
			input.value = name;
		},
		destroy: () => suggest.destroy(),
	};
}
