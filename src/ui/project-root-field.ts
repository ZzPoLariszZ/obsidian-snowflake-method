import { App, TFolder, setIcon } from 'obsidian';

import { displayProjectRoot, normalizeProjectRoot } from '../project-root';
import { FieldSuggest } from './field-suggest';

/**
 * The folder field that names the project root, wherever it is asked for. Built
 * in one place so the settings page and the project manager offer the same
 * control rather than two that merely do the same job — the same frame, the same
 * list, and a list that behaves like every other one in the plugin.
 */
export interface ProjectRootField {
	readonly inputEl: HTMLInputElement;
	/** The chevron, for callers that need to know focus is heading into it. */
	readonly selectorEl: HTMLButtonElement;
	/** Puts the stored value back on show, discarding an abandoned edit. */
	showValue(root: string): void;
	/** Closes a list left open when the field goes away. */
	destroy(): void;
}

export interface ProjectRootFieldConfig {
	/** Names the field for screen readers and labels the chevron. */
	label: string;
	placeholder: string;
	/** The root as stored, which is the empty string for the vault root. */
	currentRoot: string;
	/** A folder picked from the list. */
	onChooseRoot: (root: string) => void;
}

class ProjectRootSuggest extends FieldSuggest<TFolder> {
	private showAll = false;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		fieldEl: HTMLElement,
		private readonly currentRoot: () => string,
		private readonly onChooseRoot: (root: string) => void,
	) {
		super(app, inputEl, fieldEl);
	}

	/** Opens the full list from the chevron, the way a dropdown would. */
	showAllSuggestions(): void {
		this.inputEl.focus({ preventScroll: true });
		this.showAll = true;
		const EventConstructor =
			this.inputEl.ownerDocument.defaultView?.Event ?? Event;
		this.inputEl.dispatchEvent(new EventConstructor('input', { bubbles: true }));
	}

	protected getSuggestions(query: string): TFolder[] {
		const trimmedQuery = query.trim();
		const showAll = this.showAll;
		this.showAll = false;
		// Landing in the field is not a question, so the value already there
		// offers nothing; the chevron is how the whole list is asked for.
		if (!showAll && trimmedQuery === displayProjectRoot(this.currentRoot())) {
			return [];
		}
		const normalizedQuery = showAll ? '' : trimmedQuery.toLocaleLowerCase();
		// Runs on every keystroke; getAllLoadedFiles() would walk every note and
		// attachment in the Vault to arrive at the same list.
		const folders = this.app.vault.getAllFolders(true);
		const unique = new Map<string, TFolder>();
		for (const folder of folders) {
			unique.set(normalizeProjectRoot(folder.path), folder);
		}
		return [...unique.entries()]
			.filter(([path]) =>
				displayProjectRoot(path).toLocaleLowerCase().includes(normalizedQuery),
			)
			.sort(([left], [right]) => {
				if (left.length === 0) return -1;
				if (right.length === 0) return 1;
				return left.localeCompare(right);
			})
			.map(([, folder]) => folder);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(displayProjectRoot(folder.path));
	}

	selectSuggestion(folder: TFolder): void {
		const root = normalizeProjectRoot(folder.path);
		this.setValue(displayProjectRoot(root));
		this.close();
		this.onChooseRoot(root);
	}
}

export function buildProjectRootField(
	app: App,
	container: HTMLElement,
	config: ProjectRootFieldConfig,
): ProjectRootField {
	let currentRoot = config.currentRoot;
	const control = container.createDiv({ cls: 'snowflake-method-root-field' });
	const input = control.createEl('input', {
		type: 'text',
		value: displayProjectRoot(currentRoot),
		placeholder: config.placeholder,
		attr: { 'aria-label': config.label, spellcheck: 'false' },
	});
	const selector = control.createEl('button', {
		cls: 'clickable-icon snowflake-method-root-field-selector',
		attr: { type: 'button', 'aria-label': config.label, title: config.label },
	});
	setIcon(selector, 'chevrons-up-down');

	const suggest = new ProjectRootSuggest(
		app,
		input,
		control,
		() => currentRoot,
		config.onChooseRoot,
	);
	// The chevron opens the list rather than taking focus off the text box.
	selector.addEventListener('mousedown', (event) => {
		event.preventDefault();
	});
	selector.addEventListener('click', () => {
		suggest.showAllSuggestions();
	});

	return {
		inputEl: input,
		selectorEl: selector,
		showValue: (root) => {
			currentRoot = root;
			input.value = displayProjectRoot(root);
		},
		destroy: () => suggest.destroy(),
	};
}
