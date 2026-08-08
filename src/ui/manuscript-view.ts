import {
	ItemView,
	MarkdownRenderer,
	Menu,
	Notice,
	setIcon,
	type ViewStateResult,
	type WorkspaceLeaf,
} from 'obsidian';

import { activeSegmentAt, planWindow } from './manuscript-window';
import {
	PublicCodeMirrorBackend,
	type SegmentEditorBackend,
	type SegmentEditorHandle,
} from './segment-editor-backend';
import type {
	ManuscriptHost,
	ManuscriptModel,
	ManuscriptSegmentText,
	ManuscriptSegmentViewModel,
	ManuscriptWindowSettings,
} from './view-model';

export const MANUSCRIPT_VIEW_TYPE = 'snowflake-method-manuscript';

/** Long enough that a sentence is not written to disk a letter at a time. */
const SAVE_DELAY_MS = 800;

interface ManuscriptViewStateSnapshot {
	projectPath: string | null;
	/** The segment the stream was opened from, and the one Back returns to. */
	anchorPath: string | null;
}

interface MountedSegment {
	path: string;
	el: HTMLElement;
	bodyEl: HTMLElement;
	text: ManuscriptSegmentText;
	/** Set while this segment is the one being written in. */
	editor: SegmentEditorHandle | null;
	/** Text typed but not yet on disk. */
	pending: string | null;
}

/**
 * The manuscript as one page.
 *
 * Segments render through `MarkdownRenderer`, which is public API and gives the
 * continuous reading half of this outright. The segment the author clicks into
 * swaps its rendered block for an editor from `SegmentEditorBackend`, so the
 * text becomes editable where they clicked rather than in a tab somewhere else.
 * Only one segment is editable at a time on the stable backend; the interface
 * does not require that, and a backend that can hold several says so by holding
 * several.
 */
export class SnowflakeManuscriptView extends ItemView {
	private readonly host: ManuscriptHost;
	private readonly backend: SegmentEditorBackend = new PublicCodeMirrorBackend();
	private readonly mounted = new Map<string, MountedSegment>();
	private model: ManuscriptModel | null = null;
	/** The manuscript as last painted, so a refresh can tell a reload from not. */
	private shape = '';
	/** What is shown about each note, so a setting can redraw only the headers. */
	private headerShape = '';
	private projectPath: string | null = null;
	private anchorPath: string | null = null;
	private activePath: string | null = null;
	private editingPath: string | null = null;
	private stateDelivered = false;
	private streamEl: HTMLElement | null = null;
	private saveTimer: number | null = null;
	private saveWindow: Window | null = null;
	private refreshing = false;
	private readonly t = (
		key: string,
		vars?: Record<string, string | number>,
	): string =>
		this.host.translateForProject(this.model?.locale ?? null, key, vars);

	constructor(leaf: WorkspaceLeaf, host: ManuscriptHost) {
		super(leaf);
		this.host = host;
	}

	getViewType(): string {
		return MANUSCRIPT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.model === null
			? this.t('manuscript.title')
			: this.t('manuscript.titleFor', { project: this.model.projectTitle });
	}

	getIcon(): string {
		return 'scroll-text';
	}

	getState(): Record<string, unknown> {
		return { projectPath: this.projectPath, anchorPath: this.anchorPath };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const candidate =
			typeof state === 'object' && state !== null
				? (state as Record<string, unknown>)
				: {};
		const next: ManuscriptViewStateSnapshot = {
			projectPath:
				typeof candidate.projectPath === 'string' ? candidate.projectPath : null,
			anchorPath:
				typeof candidate.anchorPath === 'string' ? candidate.anchorPath : null,
		};
		const changed =
			next.projectPath !== this.projectPath ||
			next.anchorPath !== this.anchorPath;
		this.projectPath = next.projectPath;
		this.anchorPath = next.anchorPath;
		this.stateDelivered = true;
		await super.setState(state, result);
		if (changed || this.model === null) {
			this.activePath = next.anchorPath;
			await this.refresh();
		}
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('snowflake-method-manuscript-view');
		// A leaf Obsidian restores gets its state after onOpen. Rendering before
		// it lands would paint whichever project happens to be current.
		if (this.stateDelivered) await this.refresh();
	}

	async onClose(): Promise<void> {
		await this.flushPendingSave();
		this.clearSaveTimer();
		for (const path of [...this.mounted.keys()]) await this.unmountSegment(path);
		this.contentEl.empty();
	}

	/**
	 * Re-reads the manuscript and shows whatever changed.
	 *
	 * Called from every Vault event that touches the project, including the ones
	 * this view's own saves raise, so it must not be a rebuild. When the shape of
	 * the manuscript is the same it only re-renders the segments whose files have
	 * actually moved on, and it never touches the one being written in: taking an
	 * editor down under an author because they typed is the failure mode this
	 * whole method exists to avoid.
	 */
	async refresh(): Promise<void> {
		if (this.refreshing) return;
		this.refreshing = true;
		try {
			const settings = this.host.manuscriptWindowSettings();
			const previousShape = this.shape;
			const previousHeaders = this.headerShape;
			this.model = await this.host.loadManuscript(this.projectPath);
			this.shape = shapeOf(this.model);
			this.headerShape = headerShapeOf(settings);

			if (this.streamEl !== null && this.shape === previousShape) {
				// Nothing about the manuscript changed, so nothing is rebuilt and
				// nothing scrolls. A setting the author just flipped is not a reason
				// to move the page out from under them: the headers are redrawn where
				// they stand, and a narrower window is applied by applyWindow, which
				// holds the reader's place while it mounts and lets go.
				if (this.headerShape !== previousHeaders) this.redrawHeaders();
				await this.applyWindow();
				await this.refreshMountedBodies();
				return;
			}

			const editing = this.editingPath;
			await this.render();
			if (
				editing !== null &&
				this.model?.segments.some((segment) => segment.path === editing) === true
			) {
				await this.activateSegment(editing);
			}
		} finally {
			this.refreshing = false;
		}
	}

	/**
	 * Replaces each mounted segment's header in place.
	 *
	 * A header is a fixed height whether it holds a path, a number, both or
	 * neither, so swapping one changes nothing above it and the page does not
	 * move. Rebuilding the stream to show the same words differently would.
	 */
	private redrawHeaders(): void {
		for (const entry of this.mounted.values()) {
			const segment = this.model?.segments.find(
				(candidate) => candidate.path === entry.path,
			);
			if (segment === undefined) continue;
			entry.el.querySelector('.snowflake-method-segment-header')?.remove();
			entry.el.prepend(this.renderSegmentHeader(entry.el, segment));
		}
	}

	/**
	 * Reloads segments whose files changed elsewhere, leaving typing alone.
	 *
	 * The segment open for writing is reloaded too, into the editor rather than
	 * over it: a note edited in an ordinary tab is the same note, and the stream
	 * showing an older copy of it is the stream being wrong. Only unsaved text
	 * holds an update off, because there is no way to take one without deciding
	 * which of the two versions loses — and the save that follows refuses to
	 * clobber, which is where that decision belongs.
	 */
	private async refreshMountedBodies(): Promise<void> {
		for (const entry of this.mounted.values()) {
			if (entry.pending !== null) continue;
			try {
				const text = await this.host.readManuscriptSegment(entry.path);
				if (text.revision === entry.text.revision) continue;
				entry.text = text;
				if (entry.editor === null) await this.renderSegmentBody(entry);
				else entry.editor.write(text.body);
			} catch (error) {
				this.showError(error);
			}
		}
	}

	/** The segment being written in, so the plugin can leave its file alone. */
	editingSegment(): string | null {
		return this.editingPath;
	}

	/** True once there is a manuscript to move around in. */
	hasSegments(): boolean {
		return (this.model?.segments.length ?? 0) > 0;
	}

	/** Moves the reader one segment along, loading it if it is not held yet. */
	async goToSegment(step: -1 | 1): Promise<void> {
		const segments = this.model?.segments ?? [];
		const index = segments.findIndex(
			(segment) => segment.path === this.activePath,
		);
		const next = segments[(index === -1 ? 0 : index) + step];
		if (next === undefined) return;
		await this.goTo(next.path);
	}

	/**
	 * Moves the reader to one note of the manuscript, and makes it the note the
	 * stream counts as having been opened at.
	 *
	 * This is what a stream already on screen does with a request to open at a
	 * note. Opening one delivers the note in the view state; a stream that is
	 * already there is never handed a new state, so without this it would take
	 * the focus and show whatever page it was left on.
	 */
	async revealSegment(path: string): Promise<void> {
		if (this.model?.segments.some((segment) => segment.path === path) !== true) {
			return;
		}
		this.anchorPath = path;
		await this.goTo(path);
	}

	/** Back to the note the stream was opened from. */
	async goToAnchor(): Promise<void> {
		const anchor = this.anchorPath;
		if (anchor === null) return;
		if (this.model?.segments.some((segment) => segment.path === anchor) !== true) {
			return;
		}
		await this.goTo(anchor);
	}

	/** Adds a note on one side of the one being read. */
	async insertBesideActive(side: 'before' | 'after'): Promise<void> {
		const segments = this.model?.segments ?? [];
		const index = segments.findIndex(
			(segment) => segment.path === this.activePath,
		);
		if (index === -1) return;
		if (side === 'after') {
			await this.createSegment({ after: segments[index]?.path ?? '' });
			return;
		}
		const previous = segments[index - 1];
		await this.createSegment(
			previous === undefined ? { atStart: true } : { after: previous.path },
		);
	}

	private async goTo(path: string): Promise<void> {
		await this.deactivateSegment();
		this.activePath = path;
		await this.applyWindow();
		this.scrollToActive();
	}

	/**
	 * Notes where the author was writing, for the dashboard to offer them later.
	 *
	 * Only ever called from opening a note for editing, which is the one act
	 * that means it. Reading through a manuscript passes over dozens of notes
	 * and arriving at one says nothing about where the work is; the dashboard
	 * says "you were last writing in", and it has to be true.
	 */
	private remember(path: string): void {
		const projectId = this.model?.projectId;
		if (projectId === undefined) return;
		this.host.rememberManuscriptNote(projectId, path);
	}

	private async render(): Promise<void> {
		for (const path of [...this.mounted.keys()]) await this.unmountSegment(path);
		this.contentEl.empty();
		const model = this.model;
		if (model === null || model.segments.length === 0) {
			this.renderEmpty();
			return;
		}
		this.streamEl = this.contentEl.createDiv({
			cls: 'snowflake-method-manuscript-stream',
		});
		this.streamEl.addEventListener('scroll', this.onScroll);
		if (this.activePath === null) {
			this.activePath = this.anchorPath ?? model.segments[0]?.path ?? null;
		}
		await this.applyWindow();
		this.scrollToActive();
	}

	/**
	 * A manuscript with nothing in it yet, in the shape Obsidian gives an empty
	 * tab: a line saying so and the actions that answer it, rather than a dialog
	 * button dropped into the middle of a blank pane.
	 */
	private renderEmpty(): void {
		const empty = this.contentEl.createDiv({ cls: 'empty-state' });
		const container = empty.createDiv({ cls: 'empty-state-container' });
		container.createDiv({
			cls: 'empty-state-title',
			text: this.t(
				this.model === null ? 'manuscript.noProject' : 'manuscript.empty',
			),
		});
		if (this.model === null || this.model.readOnly) return;
		const actions = container.createDiv({ cls: 'empty-state-action-list' });
		renderEmptyStateAction(actions, this.t('manuscript.createFirst'), () => {
			void this.createSegment({ atEnd: true });
		});
	}

	/**
	 * Brings the loaded set into line with the window, and holds the reader
	 * where they were while doing it.
	 *
	 * Mounting above the viewport pushes everything down and unmounting above it
	 * pulls everything up, either of which throws the page off mid-sentence. The
	 * active segment is measured before and after and the scroll offset moved by
	 * the difference, which keeps the same words under the reader's eye whatever
	 * happened off-screen.
	 */
	private async applyWindow(): Promise<void> {
		const model = this.model;
		const stream = this.streamEl;
		if (model === null || stream === null) return;

		const settings = this.host.manuscriptWindowSettings();
		const plan = planWindow({
			segments: model.segments,
			activePath: this.activePath,
			before: settings.before,
			after: settings.after,
			loaded: [...this.mounted.keys()],
			editing: this.editingPath,
		});
		if (plan.mount.length === 0 && plan.unmount.length === 0) {
			this.renderEnds(plan.atStart, plan.atEnd);
			return;
		}

		const anchor = this.activePath;
		const beforeTop = this.offsetOf(anchor);
		const beforeScroll = stream.scrollTop;

		for (const path of plan.unmount) await this.unmountSegment(path);
		for (const path of plan.mount) await this.mountSegment(path);
		this.reorder(plan.visible);
		this.renderEnds(plan.atStart, plan.atEnd);

		const afterTop = this.offsetOf(anchor);
		if (beforeTop !== null && afterTop !== null) {
			stream.scrollTop = beforeScroll + (afterTop - beforeTop);
		}
	}

	private offsetOf(path: string | null): number | null {
		if (path === null) return null;
		return this.mounted.get(path)?.el.offsetTop ?? null;
	}

	private async mountSegment(path: string): Promise<void> {
		const stream = this.streamEl;
		const segment = this.model?.segments.find(
			(candidate) => candidate.path === path,
		);
		if (stream === null || segment === undefined) return;

		let text: ManuscriptSegmentText;
		try {
			text = await this.host.readManuscriptSegment(path);
		} catch (error) {
			this.showError(error);
			return;
		}

		const el = stream.createDiv({ cls: 'snowflake-method-segment' });
		el.dataset.path = path;
		this.renderSegmentHeader(el, segment);
		const bodyEl = el.createDiv({ cls: 'snowflake-method-segment-body' });
		const entry: MountedSegment = {
			path,
			el,
			bodyEl,
			text,
			editor: null,
			pending: null,
		};
		this.mounted.set(path, entry);
		await this.renderSegmentBody(entry);
		this.renderSegmentMenu(el, segment);
		this.renderBoundary(el, segment);
	}

	private renderSegmentHeader(
		el: HTMLElement,
		segment: ManuscriptSegmentViewModel,
	): HTMLElement {
		const settings = this.host.manuscriptWindowSettings();
		const header = el.createDiv({ cls: 'snowflake-method-segment-header' });
		// The path rather than the name: the name is almost always the heading
		// the author has already written a line below it, and saying it twice
		// tells them nothing. Where the note actually is, they cannot see.
		if (settings.showPath) {
			header.createSpan({
				cls: 'snowflake-method-segment-path',
				text: segment.path,
				attr: { title: segment.path },
			});
		}
		if (settings.showSequence) {
			header.createSpan({
				cls: 'snowflake-method-segment-sequence',
				text: String(segment.sequence),
			});
		}
		const open = header.createEl('button', {
			cls: 'clickable-icon snowflake-method-segment-open',
			attr: {
				type: 'button',
				'aria-label': this.t('manuscript.openNote'),
				title: this.t('manuscript.openNote'),
			},
		});
		setIcon(open, 'file-text');
		open.addEventListener('click', (event) => {
			event.stopPropagation();
			void this.host.openManagedFile(segment.path).catch((error: unknown) => {
				this.showError(error);
			});
		});
		return header;
	}

	private async renderSegmentBody(entry: MountedSegment): Promise<void> {
		entry.bodyEl.empty();
		entry.bodyEl.removeClass('is-editing');
		const rendered = entry.bodyEl.createDiv({
			cls: 'snowflake-method-segment-rendered markdown-rendered',
		});
		await MarkdownRenderer.render(
			this.app,
			entry.pending ?? entry.text.body,
			rendered,
			entry.path,
			this,
		);
		rendered.addEventListener('click', (event) => {
			// A link inside the prose is a link, not an invitation to edit.
			if ((event.target as HTMLElement | null)?.closest('a') !== null) return;
			void this.activateSegment(entry.path).catch((error: unknown) => {
				this.showError(error);
			});
		});
	}

	/**
	 * Puts an editor where the rendered text was, having first put the segment
	 * that had one back to rendered. One editor at a time is what the stable
	 * backend offers; the swap is where that has to be honoured.
	 */
	private async activateSegment(path: string): Promise<void> {
		if (this.editingPath === path) {
			this.backend.focus(path);
			return;
		}
		if (this.model?.readOnly === true) return;
		const entry = this.mounted.get(path);
		if (entry === undefined || entry.text.readOnly) return;

		await this.deactivateSegment();

		const stream = this.streamEl;
		const beforeTop = entry.el.offsetTop;
		const beforeScroll = stream?.scrollTop ?? 0;

		entry.bodyEl.empty();
		entry.bodyEl.addClass('is-editing');
		entry.editor = await this.backend.mount(
			{ path, body: entry.pending ?? entry.text.body, readOnly: false },
			entry.bodyEl,
			{
				onChange: (changed, body) => {
					const target = this.mounted.get(changed);
					if (target === undefined) return;
					target.pending = body;
					this.scheduleSave();
				},
				onBlur: () => {
					void this.flushPendingSave().catch((error: unknown) => {
						this.showError(error);
					});
				},
			},
		);
		this.editingPath = path;
		this.remember(path);
		entry.editor.focus();

		if (stream !== null) {
			stream.scrollTop = beforeScroll + (entry.el.offsetTop - beforeTop);
		}
	}

	private async deactivateSegment(): Promise<void> {
		const path = this.editingPath;
		if (path === null) return;
		await this.flushPendingSave();
		this.editingPath = null;
		await this.backend.unmount(path);
		const entry = this.mounted.get(path);
		if (entry === undefined) return;
		entry.editor = null;
		await this.renderSegmentBody(entry);
	}

	/**
	 * The rule between two segments, and the one thing it offers: another
	 * segment, here. Splitting used to hang off this button too and does not
	 * belong: it acts on a caret inside a segment rather than on the gap between
	 * two, so it lives in the segment's own menu and in the command palette.
	 */
	private renderBoundary(
		el: HTMLElement,
		segment: ManuscriptSegmentViewModel,
	): void {
		const boundary = el.createDiv({
			cls: 'snowflake-method-segment-boundary',
		});
		if (this.model?.readOnly === true) return;
		// Both controls in one block, so hovering covers a single stretch of the
		// line rather than leaving it showing through the gap between them.
		const actions = boundary.createDiv({
			cls: 'snowflake-method-segment-boundary-actions',
		});
		const add = actions.createEl('button', {
			cls: 'clickable-icon snowflake-method-segment-boundary-action',
			attr: {
				type: 'button',
				'aria-label': this.t('manuscript.insertSegment'),
				title: this.t('manuscript.insertSegment'),
			},
		});
		setIcon(add, 'plus');
		add.addEventListener('click', () => {
			void this.createSegment({ after: segment.path });
		});
		this.renderMergeControl(actions, segment.path);
	}

	/**
	 * Closes the gap: the note after this line is folded into the one before it.
	 *
	 * Offered only where there is a note on both sides, which is why it is not
	 * drawn on the line after the last one. The earlier note survives, so the
	 * merged text keeps the place in the manuscript the reader was going to meet
	 * it at, and the later note goes to the trash rather than anywhere final.
	 */
	private renderMergeControl(actions: HTMLElement, path: string): void {
		const segments = this.model?.segments ?? [];
		const index = segments.findIndex((segment) => segment.path === path);
		const next = segments[index + 1];
		if (next === undefined) return;
		const label = this.t('manuscript.mergeWithNext', { note: next.title });
		const merge = actions.createEl('button', {
			cls: 'clickable-icon snowflake-method-segment-boundary-action',
			attr: { type: 'button', 'aria-label': label, title: label },
		});
		// A minus against the plus beside it. The line between two notes is the
		// thing being added to or taken away: one more note here, or one fewer.
		setIcon(merge, 'minus');
		merge.addEventListener('click', () => {
			void this.mergeAt(path);
		});
	}

	private async mergeAt(path: string): Promise<void> {
		const model = this.model;
		if (model === null || model.readOnly) return;
		await this.deactivateSegment();
		try {
			await this.host.mergeManuscriptSegments(model.projectPath, path);
			this.activePath = path;
			await this.refresh();
		} catch (error) {
			this.showError(error);
		}
	}

	/**
	 * Everything that can be done to one segment, on its own right-click.
	 *
	 * A menu drawn here replaces the one the author would otherwise have had, so
	 * it has to carry more than this plugin's own two items. Copying whatever is
	 * selected comes first because that is what a right-click on prose is most
	 * often for, and the rest of the note's menu is asked for rather than
	 * rebuilt: firing `file-menu` is how Obsidian's own file actions and every
	 * other plugin's contributions arrive, the same as in the file explorer.
	 */
	private renderSegmentMenu(
		el: HTMLElement,
		segment: ManuscriptSegmentViewModel,
	): void {
		el.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			const menu = new Menu();

			const section = 'snowflake-method';

			const selection = this.contentEl.win.getSelection()?.toString() ?? '';
			if (selection.length > 0) {
				menu.addItem((item) =>
					item
						.setTitle(this.t('manuscript.copySelection'))
						.setIcon('copy')
						.onClick(() => {
							void navigator.clipboard.writeText(selection);
						}),
				);
			}

			// The manuscript's own two, in the plugin's section rather than loose
			// among Obsidian's, so the whole group reads in one language.
			this.host.addProjectMenuSection(menu, segment.path, MANUSCRIPT_VIEW_TYPE);
			menu.addItem((item) =>
				item
					.setSection(section)
					.setTitle(this.t('manuscript.splitHere'))
					.setIcon('scissors')
					.setDisabled(
						this.editingPath !== segment.path || this.model?.readOnly === true,
					)
					.onClick(() => {
						void this.splitAtCursor();
					}),
			);
			if (this.model?.readOnly !== true) {
				menu.addItem((item) =>
					item
						.setSection(section)
						.setTitle(this.t('manuscript.insertSegment'))
						.setIcon('file-plus')
						.onClick(() => {
							void this.createSegment({ after: segment.path });
						}),
				);
			}

			const file = this.app.vault.getFileByPath(segment.path);
			if (file !== null) {
				this.app.workspace.trigger(
					'file-menu',
					menu,
					file,
					MANUSCRIPT_VIEW_TYPE,
					this.leaf,
				);
			}
			menu.showAtMouseEvent(event);
		});
	}

	/**
	 * The controls for growing the manuscript at either end.
	 *
	 * Drawn only where the resolver says the manuscript actually stops. A window
	 * that ends five chapters early is a cache boundary, and offering to write
	 * the next chapter there would be offering it in the middle of this one.
	 */
	private renderEnds(atStart: boolean, atEnd: boolean): void {
		const stream = this.streamEl;
		if (stream === null) return;
		for (const existing of Array.from(
			stream.querySelectorAll('.snowflake-method-manuscript-end'),
		)) {
			existing.remove();
		}
		if (this.model?.readOnly === true) return;
		const action = (label: string, placement: 'start' | 'end'): void => {
			const host = stream.createDiv({
				cls: `snowflake-method-manuscript-end is-${placement}`,
			});
			renderEmptyStateAction(host, label, () => {
				void this.createSegment(
					placement === 'start' ? { atStart: true } : { atEnd: true },
				);
			});
			// Every note carries the line below it, so the first one has nothing
			// above it and the top of the manuscript reads differently from the
			// bottom. This is that line.
			if (placement === 'start') {
				host.createDiv({
					cls: 'snowflake-method-segment-boundary is-leading',
					attr: { 'aria-hidden': 'true' },
				});
				stream.prepend(host);
			}
		};
		if (atStart) action(this.t('manuscript.createPrevious'), 'start');
		if (atEnd) action(this.t('manuscript.createNext'), 'end');
	}

	/** Puts the mounted blocks into reading order without rebuilding them. */
	private reorder(visible: readonly string[]): void {
		const stream = this.streamEl;
		if (stream === null) return;
		for (const path of visible) {
			const entry = this.mounted.get(path);
			if (entry !== undefined) stream.append(entry.el);
		}
	}

	private async unmountSegment(path: string): Promise<void> {
		const entry = this.mounted.get(path);
		if (entry === undefined) return;
		if (this.editingPath === path) {
			await this.flushPendingSave();
			this.editingPath = null;
		}
		await this.backend.unmount(path);
		this.mounted.delete(path);
		entry.el.remove();
	}

	private readonly onScroll = (): void => {
		const stream = this.streamEl;
		if (stream === null) return;
		const offsets = [...this.mounted.values()].map((entry) => ({
			path: entry.path,
			top: entry.el.offsetTop,
			bottom: entry.el.offsetTop + entry.el.offsetHeight,
		}));
		offsets.sort((left, right) => left.top - right.top);
		const active = activeSegmentAt(
			offsets,
			stream.scrollTop,
			stream.clientHeight,
		);
		if (active === null || active === this.activePath) return;
		this.activePath = active;
		void this.applyWindow().catch((error: unknown) => {
			this.showError(error);
		});
	};

	private scrollToActive(): void {
		const stream = this.streamEl;
		const entry =
			this.activePath === null ? undefined : this.mounted.get(this.activePath);
		if (stream === null || entry === undefined) return;
		stream.scrollTop = entry.el.offsetTop;
	}

	private scheduleSave(): void {
		this.clearSaveTimer();
		const viewWindow = this.contentEl.win;
		this.saveWindow = viewWindow;
		this.saveTimer = viewWindow.setTimeout(() => {
			this.saveTimer = null;
			this.saveWindow = null;
			void this.flushPendingSave().catch((error: unknown) => {
				this.showError(error);
			});
		}, SAVE_DELAY_MS);
	}

	private clearSaveTimer(): void {
		if (this.saveTimer !== null && this.saveWindow !== null) {
			this.saveWindow.clearTimeout(this.saveTimer);
		}
		this.saveTimer = null;
		this.saveWindow = null;
	}

	/** Writes every segment holding unsaved text, and only those. */
	private async flushPendingSave(): Promise<void> {
		this.clearSaveTimer();
		for (const entry of this.mounted.values()) {
			const pending = entry.pending;
			if (pending === null || pending === entry.text.body) continue;
			try {
				const revision = await this.host.saveManuscriptSegment(
					entry.path,
					pending,
					entry.text.revision,
				);
				entry.text = { ...entry.text, body: pending, revision };
				entry.pending = null;
			} catch (error) {
				// The file moved on underneath. Keeping the typed text and saying so
				// is the only answer that cannot lose it.
				this.showError(error);
			}
		}
	}

	private async createSegment(
		placement: { after: string } | { atStart: true } | { atEnd: true },
	): Promise<void> {
		const model = this.model;
		if (model === null) return;
		await this.deactivateSegment();
		try {
			const created = await this.host.createManuscriptSegment(
				model.projectPath,
				placement,
			);
			if (created === null) return;
			this.activePath = created;
			await this.refresh();
			await this.activateSegment(created);
		} catch (error) {
			this.showError(error);
		}
	}

	/** Splits wherever the caret is. The command and the menu both land here. */
	async splitActiveSegment(): Promise<void> {
		await this.splitAtCursor();
	}

	private async splitAtCursor(): Promise<void> {
		const model = this.model;
		const path = this.editingPath;
		const entry = path === null ? undefined : this.mounted.get(path);
		if (model === null || path === null || entry?.editor == null) return;

		const offset = entry.editor.cursor();
		await this.flushPendingSave();
		await this.deactivateSegment();
		try {
			const created = await this.host.splitManuscriptSegment(
				model.projectPath,
				path,
				offset,
			);
			if (created === null) return;
			this.activePath = created;
			await this.refresh();
		} catch (error) {
			this.showError(error);
		}
	}

	private showError(error: unknown): void {
		new Notice(
			error instanceof Error ? error.message : this.t('errors.unknown'),
		);
	}
}

/**
 * An action in the manner of the ones on Obsidian's own empty tab.
 *
 * Its classes are Obsidian's, so it takes the app's spacing and hover and the
 * theme's colours rather than a look invented here. A button rather than the
 * div Obsidian uses, because one of these can be the only way forward in the
 * pane and reaching it with a keyboard should not depend on a mouse.
 */
function renderEmptyStateAction(
	host: HTMLElement,
	label: string,
	onClick: () => void,
): HTMLElement {
	const action = host.createEl('button', {
		cls: 'empty-state-action tappable snowflake-method-manuscript-action',
		text: label,
		attr: { type: 'button' },
	});
	action.addEventListener('click', onClick);
	return action;
}

/**
 * The manuscript as the page sees it: which notes there are, in what order,
 * called what. A change to this needs a rebuild; a change to the text inside a
 * note, or to what is shown about it, does not.
 */
function shapeOf(model: ManuscriptModel | null): string {
	if (model === null) return '';
	return model.segments
		.map(
			(segment) =>
				`${segment.path} ${segment.title} ${String(segment.sequence)}`,
		)
		.join('');
}

/**
 * What each note's header carries. Kept apart from the manuscript's own shape
 * because the answer to a change here is to redraw the headers where they are,
 * not to rebuild the page and send the reader back to where they started.
 */
function headerShapeOf(settings: ManuscriptWindowSettings): string {
	return `${String(settings.showPath)} ${String(settings.showSequence)}`;
}
