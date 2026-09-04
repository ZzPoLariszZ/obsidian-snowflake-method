import { setIcon } from 'obsidian';

/**
 * The parts a margin card is built from, shared by every family of card the
 * rail draws -- a revision's and a foreshadowing's alike -- so the two read
 * as one kind of thing pinned beside the prose: the same titled blocks, the
 * same button row, the same compass in the corner. The rail hands in its
 * restack, because a text area growing under the author's hands has to push
 * the cards below it down, and only the stacking pass knows where they go.
 */
export interface RailParts {
	/** The card's top line: a typed field at the left, the compass at the right. */
	headBlock(card: HTMLElement): HTMLElement;
	/** The column the card's named fields stand in. */
	fieldsBlock(card: HTMLElement): HTMLElement;
	/**
	 * Where a card's buttons stand. Answers that are equally likely share the
	 * card's width between them; a form's pair sits at the right, where a
	 * dialog keeps what closes it.
	 */
	actionRow(card: HTMLElement, shape: 'balanced' | 'end'): HTMLElement;
	/**
	 * One button. `primary` is the answer the card leans toward, in the
	 * accent; `danger` the one that takes something away, in the ink the
	 * tables give their delete.
	 */
	actionButton(
		host: HTMLElement,
		label: string,
		onClick: () => void,
		tone?: 'primary' | 'danger',
	): void;
	/**
	 * One titled block: the field's name over its value, the shape the
	 * plugin's own forms use everywhere else. Every card is read as named
	 * parts this way rather than as anonymous paragraphs that only their
	 * styling tells apart.
	 */
	fieldBlock(host: HTMLElement, part: string, label: string): HTMLElement;
	/** A field's value, shown whole: a card trims nothing it was given. */
	valueBlock(
		host: HTMLElement,
		part: string,
		label: string,
		text: string,
	): HTMLElement;
	/**
	 * A text area tall enough for all of it: the words are shown whole, never
	 * as much of them as the rows happened to hold, and never behind a
	 * scrollbar. `keepTaller` is for the growing that happens under the
	 * author's hands: a box may rise to hold what is being typed, but never
	 * fall back, or a box the author dragged taller would collapse at the
	 * next keystroke.
	 */
	growToFit(input: HTMLTextAreaElement, keepTaller?: boolean): void;
	inputBlock(
		host: HTMLElement,
		part: string,
		label: string,
		options: { value: string; placeholder: string },
	): HTMLTextAreaElement;
	/**
	 * The pair in the card's upper corner: one step back through the cards
	 * of its kind, one step on. Arrows rather than words: the pair is a
	 * compass, not two more things to read. An end is shown rather than
	 * clicked into: the arrow stays, greyed.
	 */
	navGroup(
		host: HTMLElement,
		labels: { previous: string; next: string },
		has: (step: -1 | 1) => boolean,
		jump: (step: -1 | 1) => void,
	): void;
}

export function railParts(restack: () => void): RailParts {
	const fieldBlock = (
		host: HTMLElement,
		part: string,
		label: string,
	): HTMLElement => {
		const field = host.createDiv({
			cls: `snowflake-method-rail-field is-${part}`,
		});
		field.createDiv({ cls: 'snowflake-method-rail-label', text: label });
		return field;
	};

	const growToFit = (input: HTMLTextAreaElement, keepTaller = false): void => {
		if (input.value.length === 0) return;
		// Its height is still the rows', so scrollHeight is either those rows
		// or everything in it, whichever is taller; the borders the box sizes
		// inside are added back. A card built in a pane nobody is looking at
		// measures nothing and is left at its rows until it is drawn somewhere
		// real.
		if (input.offsetHeight === 0) return;
		const frame = input.offsetHeight - input.clientHeight;
		const wanted = input.scrollHeight + frame;
		if (keepTaller && wanted <= input.offsetHeight) return;
		input.setCssStyles({ height: `${String(wanted)}px` });
	};

	return {
		headBlock: (card) => card.createDiv({ cls: 'snowflake-method-rail-head' }),
		fieldsBlock: (card) =>
			card.createDiv({ cls: 'snowflake-method-rail-fields' }),
		actionRow: (card, shape) =>
			card.createDiv({ cls: `snowflake-method-rail-actions is-${shape}` }),
		actionButton: (host, label, onClick, tone) => {
			const button = host.createEl('button', {
				cls:
					tone === 'primary'
						? 'mod-cta snowflake-method-rail-action'
						: tone === 'danger'
							? 'snowflake-method-rail-action is-danger'
							: 'snowflake-method-rail-action',
				text: label,
				attr: { type: 'button', 'aria-label': label, title: label },
			});
			button.addEventListener('click', (event) => {
				event.stopPropagation();
				onClick();
			});
		},
		fieldBlock,
		valueBlock: (host, part, label, text) =>
			fieldBlock(host, part, label).createDiv({
				cls: 'snowflake-method-rail-value',
				text,
			}),
		growToFit,
		inputBlock: (host, part, label, options) => {
			const field = fieldBlock(host, part, label);
			const input = field.createEl('textarea', {
				cls: 'snowflake-method-rail-input',
				attr: {
					rows: '3',
					'aria-label': label,
					placeholder: options.placeholder,
				},
			});
			input.value = options.value;
			growToFit(input);
			// Typing past the bottom of the box raises it instead of pushing
			// the words out of sight, and the rail is told, since a card that
			// grew while nothing restacked would grow over the one below it.
			input.addEventListener('input', () => {
				const before = input.offsetHeight;
				growToFit(input, true);
				if (input.offsetHeight !== before) restack();
			});
			return input;
		},
		navGroup: (host, labels, has, jump) => {
			const nav = host.createDiv({ cls: 'snowflake-method-rail-nav' });
			const arrow = (step: -1 | 1, icon: string, label: string): void => {
				const button = nav.createEl('button', {
					cls: 'clickable-icon snowflake-method-rail-nav-step',
					attr: {
						type: 'button',
						'aria-label': label,
						title: label,
						// The first and the last card say so plainly.
						...(has(step) ? {} : { disabled: 'disabled' }),
					},
				});
				setIcon(button, icon);
				button.addEventListener('click', (event) => {
					event.stopPropagation();
					jump(step);
				});
			};
			arrow(-1, 'chevron-up', labels.previous);
			arrow(1, 'chevron-down', labels.next);
		},
	};
}
