/**
 * The tracking pane: where each entity stands in the manuscript, and what
 * the reader has asked not to be told again. Built from stock parts -- an
 * item view, plain rows, a search field -- because it is a reading of the
 * index, not a dashboard; the drawn surfaces come later and elsewhere.
 *
 * Everything shown is a resolved fact. Entities carry only their definite
 * mentions; the ambiguous ones stand apart under their own heading, each a
 * jump to the spot where the stream's own menu can settle it. The ignore
 * rules are listed as written, one removal each, and removing one brings
 * the highlight back everywhere at once.
 */

import { ItemView, setIcon, setTooltip, type WorkspaceLeaf } from 'obsidian';

import {
	occurrenceContext,
	type EntityOccurrence,
	type MentionIgnore,
} from '../domain';
import type { EntityMentionAggregate, MentionAggregate } from '../services';
import { mentionEntityRows, mentionNoteTitle as noteTitle } from './mention-rows';
import type { MentionViewHost } from './view-model';

export const MENTION_VIEW_TYPE = 'snowflake-method-mentions';

/**
 * Rows past this many are counted but not drawn: the pane is a reading,
 * and a reading of thousands of rows is what the search field is for.
 */
const MAX_ENTITY_ROWS = 200;

export class SnowflakeMentionView extends ItemView {
	private filter = '';
	private expanded: string | null = null;
	private aggregate: MentionAggregate | null = null;
	private ignores: readonly MentionIgnore[] = [];
	private projectPath: string | null = null;
	private loading = false;
	private refreshAgain = false;
	/** Chapter bodies read for context lines, once per refresh. */
	private readonly bodies = new Map<string, string>();

	constructor(
		leaf: WorkspaceLeaf,
		private readonly host: MentionViewHost,
	) {
		super(leaf);
		this.navigation = false;
	}

	getViewType(): string {
		return MENTION_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.host.t('mentionView.title');
	}

	getIcon(): string {
		return 'scan-text';
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('snowflake-method-mention-view');
		await this.refresh();
	}

	async refresh(): Promise<void> {
		if (this.loading) {
			this.refreshAgain = true;
			return;
		}
		this.loading = true;
		this.renderComputing();
		try {
			this.projectPath = this.host.mentionProjectPath();
			this.bodies.clear();
			const [aggregate, ignores] = await Promise.all([
				this.host.manuscriptMentionAggregate(this.projectPath),
				this.host.mentionIgnores(this.projectPath),
			]);
			this.aggregate = aggregate;
			this.ignores = ignores;
		} finally {
			this.loading = false;
		}
		if (this.refreshAgain) {
			this.refreshAgain = false;
			await this.refresh();
			return;
		}
		await this.prepareContexts();
		this.render();
	}

	/** The expanded entity's chapters, read once each for their context lines. */
	private async prepareContexts(): Promise<void> {
		const entity = this.aggregate?.entities.find(
			(candidate) => candidate.memberPath === this.expanded,
		);
		if (entity === undefined) return;
		for (const occurrence of entity.occurrences) {
			if (this.bodies.has(occurrence.path)) continue;
			try {
				const segment = await this.host.readManuscriptSegment(
					occurrence.path,
				);
				this.bodies.set(occurrence.path, segment.body);
			} catch {
				this.bodies.set(occurrence.path, '');
			}
		}
	}

	private renderComputing(): void {
		if (this.aggregate !== null) return;
		const root = this.contentEl;
		root.empty();
		root.createDiv({
			cls: 'snowflake-method-mention-view-empty',
			text: this.host.t('mentionView.computing'),
		});
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		const t = this.host.t;

		const controls = root.createDiv({
			cls: 'snowflake-method-mention-view-controls',
		});
		const search = controls.createEl('input', {
			cls: 'snowflake-method-mention-view-search',
			attr: {
				type: 'search',
				placeholder: t('mentionView.searchPlaceholder'),
			},
		});
		search.value = this.filter;
		search.addEventListener('input', () => {
			this.filter = search.value;
			this.renderEntityList();
		});
		const refresh = controls.createEl('button', {
			cls: 'clickable-icon snowflake-method-mention-view-refresh',
			attr: { type: 'button' },
		});
		setIcon(refresh, 'refresh-cw');
		setTooltip(refresh, t('mentionView.refresh'));
		refresh.addEventListener('click', () => {
			void this.refresh();
		});

		if (this.aggregate === null) {
			root.createDiv({
				cls: 'snowflake-method-mention-view-empty',
				text: t('mentionView.noProject'),
			});
			return;
		}

		this.entityListEl = root.createDiv();
		this.renderEntityList();

		const unresolved = this.aggregate.unresolved;
		if (unresolved.length > 0) {
			root.createEl('h3', {
				cls: 'snowflake-method-mention-view-heading',
				text: t('mentionView.unresolvedHeading'),
			});
			for (const occurrence of unresolved) {
				this.renderUnresolvedRow(root, occurrence);
			}
		}

		root.createEl('h3', {
			cls: 'snowflake-method-mention-view-heading',
			text: t('mentionView.ignoreHeading'),
		});
		if (this.ignores.length === 0) {
			root.createDiv({
				cls: 'snowflake-method-mention-view-empty',
				text: t('mentionView.ignoreEmpty'),
			});
		}
		for (const rule of this.ignores) this.renderIgnoreRow(root, rule);
	}

	private entityListEl: HTMLElement | null = null;

	private renderEntityList(): void {
		const host = this.entityListEl;
		if (host === null) return;
		host.empty();
		const t = this.host.t;
		const rows = mentionEntityRows(this.aggregate, this.filter);
		if (rows.length === 0) {
			host.createDiv({
				cls: 'snowflake-method-mention-view-empty',
				text: t('mentionView.empty'),
			});
			return;
		}
		for (const entity of rows.slice(0, MAX_ENTITY_ROWS)) {
			this.renderEntityRow(host, entity);
		}
		if (rows.length > MAX_ENTITY_ROWS) {
			host.createDiv({
				cls: 'snowflake-method-mention-view-empty',
				text: t('mentionView.more', {
					shown: MAX_ENTITY_ROWS,
					total: rows.length,
				}),
			});
		}
	}

	private renderEntityRow(
		host: HTMLElement,
		entity: EntityMentionAggregate,
	): void {
		const t = this.host.t;
		const row = host.createDiv({ cls: 'snowflake-method-mention-view-row' });
		const head = row.createDiv({
			cls: 'snowflake-method-mention-view-row-head',
		});
		head.createSpan({
			cls: 'snowflake-method-mention-view-name',
			text: entity.memberName,
		});
		head.createSpan({
			cls: 'snowflake-method-mention-view-counts',
			text: t('mentionView.counts', {
				total: entity.total,
				linked: entity.linked,
				unlinked: entity.unlinked,
			}),
		});
		if (entity.first !== null && entity.last !== null) {
			head.createSpan({
				cls: 'snowflake-method-mention-view-span',
				text: `${t('mentionView.first', {
					name: noteTitle(entity.first.path),
				})} · ${t('mentionView.last', { name: noteTitle(entity.last.path) })}`,
			});
		}
		head.addEventListener('click', () => {
			this.expanded =
				this.expanded === entity.memberPath ? null : entity.memberPath;
			void this.prepareContexts().then(() => {
				this.render();
			});
		});
		if (this.expanded !== entity.memberPath) return;
		const list = row.createDiv({
			cls: 'snowflake-method-mention-view-occurrences',
		});
		for (const occurrence of entity.occurrences) {
			this.renderOccurrenceRow(list, occurrence);
		}
	}

	private renderOccurrenceRow(
		host: HTMLElement,
		occurrence: EntityOccurrence,
	): void {
		const row = host.createDiv({
			cls: 'snowflake-method-mention-view-occurrence',
		});
		row.createSpan({
			cls: 'snowflake-method-mention-view-chapter',
			text: noteTitle(occurrence.path),
		});
		const body = this.bodies.get(occurrence.path);
		if (body !== undefined && body.length > 0) {
			const context = occurrenceContext(
				body,
				occurrence.from,
				occurrence.to,
			);
			const line = row.createSpan({
				cls: 'snowflake-method-mention-view-context',
			});
			line.appendText(context.before);
			line.createEl('strong', { text: context.match });
			line.appendText(context.after);
		}
		row.addEventListener('click', () => {
			void this.host
				.openManuscriptMention(this.projectPath, occurrence)
				.catch(() => undefined);
		});
	}

	private renderUnresolvedRow(
		host: HTMLElement,
		occurrence: EntityOccurrence,
	): void {
		const t = this.host.t;
		const row = host.createDiv({
			cls: 'snowflake-method-mention-view-occurrence',
		});
		row.createSpan({
			cls: 'snowflake-method-mention-view-chapter',
			text: noteTitle(occurrence.path),
		});
		const line = row.createSpan({
			cls: 'snowflake-method-mention-view-context',
		});
		line.createEl('strong', { text: occurrence.matchedText });
		line.appendText(
			` ${t('mentionView.unresolvedHint', {
				names: occurrence.candidates
					.map((candidate) => candidate.memberName)
					.join(' / '),
			})}`,
		);
		row.addEventListener('click', () => {
			void this.host
				.openManuscriptMention(this.projectPath, occurrence)
				.catch(() => undefined);
		});
	}

	private renderIgnoreRow(host: HTMLElement, rule: MentionIgnore): void {
		const t = this.host.t;
		const row = host.createDiv({
			cls: 'snowflake-method-mention-view-ignore',
		});
		const badge =
			rule.scope === 'occurrence'
				? t('mentionView.ignoreOccurrenceBadge')
				: rule.scope === 'note'
					? t('mentionView.ignoreNoteBadge', {
							note: noteTitle(rule.notePath),
						})
					: t('mentionView.ignoreManuscriptBadge');
		row.createSpan({
			cls: 'snowflake-method-mention-view-ignore-badge',
			text: badge,
		});
		const named =
			'memberPath' in rule
				? `${noteTitle(rule.memberPath)}: ${rule.matchedText}`
				: rule.matchedText;
		row.createSpan({
			cls: 'snowflake-method-mention-view-ignore-text',
			text: named,
		});
		const remove = row.createEl('button', {
			cls: 'clickable-icon snowflake-method-mention-view-remove',
			attr: { type: 'button' },
		});
		setIcon(remove, 'x');
		setTooltip(remove, t('mentionView.remove'));
		remove.addEventListener('click', () => {
			void this.host
				.removeMentionIgnore(this.projectPath, rule)
				.then(() => this.refresh())
				.catch(() => undefined);
		});
	}
}
