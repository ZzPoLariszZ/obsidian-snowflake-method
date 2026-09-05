import type { App } from 'obsidian';

import type { EntityRef, EntityRosterEntry } from '../domain';
import {
	entityGroupLabel,
	renderRecordLine,
	renderRecordPickFrame,
} from './entity-form';
import {
	promptForEntityReference,
	type EntityReferenceSource,
	type Translate,
} from './modals';

/** The words the field says, in the form's own copy. */
export interface RelatedEntitiesCopy {
	/** Over the chooser while the roster has something to offer. */
	placeholder: string;
	/** Over the chooser when it has nothing. */
	empty: string;
	missingTitle: (name: string) => string;
	removeLabel: (name: string) => string;
}

/**
 * The entities a record is about, held by id: one line each with a way off,
 * and under them the chooser a relationship's target wears -- the kind
 * asked first, then the note -- standing after every pick, since a record
 * touches as many as it touches. Ids are unique across kinds, and a stored
 * ref whose note has gone keeps its line marked missing: dropping it would
 * erase what the author wrote by failing to show it. The thread form and
 * the task form wear this one field.
 */
export class RelatedEntitiesField {
	/** The picked entities, by id. */
	private related: string[];
	/** Everything an id may stand for: the roster, and the stored refs it lacks. */
	private readonly refs = new Map<string, EntityRef>();
	/** The group each roster entry lists under; an id absent here is missing. */
	private readonly groupOf = new Map<string, string>();

	constructor(
		private readonly app: App,
		private readonly t: Translate,
		private readonly roster: readonly EntityRosterEntry[],
		initial: readonly EntityRef[],
		private readonly copy: RelatedEntitiesCopy,
	) {
		this.related = initial.map((ref) => ref.id);
		for (const entry of roster) {
			this.refs.set(entry.id, { kind: entry.kind, id: entry.id, name: entry.name });
			this.groupOf.set(entry.id, entry.group);
		}
		for (const ref of initial) {
			if (this.refs.has(ref.id)) continue;
			this.refs.set(ref.id, { kind: ref.kind, id: ref.id, name: ref.name });
		}
	}

	/** Draws the lines and the chooser into `host`, under the form's own class. */
	render(host: HTMLElement, cls: string): void {
		const t = this.t;
		const block = host.createDiv({ cls });
		const lines = block.createDiv({ cls: 'snowflake-method-record-lines' });
		const draw = (): void => {
			lines.empty();
			for (const id of this.related) {
				const ref = this.refs.get(id);
				if (ref === undefined) continue;
				const group = this.groupOf.get(id);
				renderRecordLine(
					lines,
					{
						label: entityGroupLabel(t, group ?? ref.kind),
						text: ref.name,
						missing: group === undefined,
						missingTitle: this.copy.missingTitle(ref.name),
						removeLabel: this.copy.removeLabel(ref.name),
					},
					() => {
						this.related = this.related.filter((candidate) => candidate !== id);
						draw();
					},
				);
			}
		};
		draw();
		const offered = this.roster.length > 0;
		renderRecordPickFrame(
			block,
			offered ? this.copy.placeholder : this.copy.empty,
			() => {
				if (!offered) return;
				void promptForEntityReference(this.app, t, this.referenceSource()).then(
					(picked) => {
						if (picked === null || this.related.includes(picked.option.value)) {
							return;
						}
						this.related.push(picked.option.value);
						draw();
					},
				);
			},
		);
	}

	/** The refs as picked. Missing ones included: dropping them would erase what the author wrote. */
	value(): EntityRef[] {
		return this.related.flatMap((id) => {
			const ref = this.refs.get(id);
			return ref === undefined ? [] : [{ ...ref }];
		});
	}

	/**
	 * The roster as the reference dialog reads it: the kinds in the order
	 * the roster lists them, and under each the notes not yet picked. No
	 * creating from here: a record points at what the project has.
	 */
	private referenceSource(): EntityReferenceSource {
		const t = this.t;
		const groups: string[] = [];
		for (const entry of this.roster) {
			if (!groups.includes(entry.group)) groups.push(entry.group);
		}
		return {
			groups: () => groups.map((id) => ({ id, label: entityGroupLabel(t, id) })),
			entitiesIn: (group) =>
				this.roster
					.filter(
						(entry) => entry.group === group && !this.related.includes(entry.id),
					)
					.map((entry) => ({ value: entry.id, label: entry.name })),
		};
	}
}
