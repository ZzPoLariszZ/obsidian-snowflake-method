import { FuzzySuggestModal, Modal, SuggestModal } from 'obsidian';

import { answerEscapeKey } from './escape-key';

/**
 * Obsidian's Modal as the plugin raises it: an Escape struck while an input
 * method is composing is left to the composition, and the dialog stays. Every
 * dialog of the plugin's extends one of the three classes here rather than
 * Obsidian's own, so the rule holds for all of them at once.
 */
export class SnowflakeModal extends Modal {
	onEscapeKey(event: KeyboardEvent): false | undefined {
		return answerEscapeKey(this, event);
	}
}

/** A list dialog of the plugin's, with the same Escape. */
export abstract class SnowflakeSuggestModal<T> extends SuggestModal<T> {
	onEscapeKey(event: KeyboardEvent): false | undefined {
		return answerEscapeKey(this, event);
	}
}

/** A fuzzy list dialog of the plugin's, with the same Escape. */
export abstract class SnowflakeFuzzySuggestModal<T> extends FuzzySuggestModal<T> {
	onEscapeKey(event: KeyboardEvent): false | undefined {
		return answerEscapeKey(this, event);
	}
}
