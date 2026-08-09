import {
	ItemView,
	MarkdownRenderer,
	Menu,
	Notice,
	setIcon,
	setTooltip,
	type ViewStateResult,
	type WorkspaceLeaf,
} from 'obsidian';

import { activeSegmentAt, planWindow } from './manuscript-window';
import { confirmSegmentMerge } from './modals';
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

/** How long a freshly built editor is given to settle on its own height. */
const SETTLING_FRAMES = 6;

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
	/** Whose manuscript is on the page. Another project's is a different page. */
	private renderedProject: string | null = null;
	private projectPath: string | null = null;
	private anchorPath: string | null = null;
	private activePath: string | null = null;
	private editingPath: string | null = null;
	private stateDelivered = false;
	private streamEl: HTMLElement | null = null;
	/** The room settleTail last put below the last note, in pixels. */
	private tail = 0;
	/**
	 * Raised while this view is the one moving the page.
	 *
	 * Taking a window down shrinks the page under the scroll position, and the
	 * browser pulls the scroll back to fit — which arrives as a scroll event
	 * indistinguishable from the reader's own. Answered as though the reader had
	 * scrolled, it picks whatever note happens to be under the reading line
	 * halfway through the teardown and sets off a second pass, which then lands
	 * on top of the first: measured, a note asked for by name arrived, was placed
	 * exactly, and was moved three thousand pixels ninety milliseconds later.
	 */
	private settling = 0;
	/** The queue that keeps window changes from running over one another. */
	private windowing: Promise<void> = Promise.resolve();
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

			const project = this.model?.projectPath ?? null;
			if (
				this.streamEl !== null &&
				this.renderedProject === project &&
				(this.model?.segments.length ?? 0) > 0
			) {
				// A note arriving, leaving, being cut in two or joined to the next is
				// a change to what is on the page, not a reason to build a new one.
				// Rebuilding threw the reader to the top of a note every time they
				// added one — and rendered every note in the window to do it, when
				// planWindow already knows which have arrived and which have gone.
				// A setting they just flipped is no reason to move them either, so
				// the chrome is redrawn where it stands.
				const reshaped = this.shape !== previousShape;
				if (reshaped) this.redrawBoundaries();
				if (reshaped || this.headerShape !== previousHeaders) {
					this.redrawHeaders();
				}
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
	 * Replaces the line below each mounted note, because what it offers is not
	 * about that note but about the one after it.
	 *
	 * A rule drawn while its note was the last in the book offers only a new
	 * note; once there is a note after it, the same rule should offer to fold
	 * the two together — and it named the note it would fold in, so a rename
	 * moves on too. Neither reached the page: the rules were drawn once, when
	 * the note mounted, and a manuscript that had grown a second note kept
	 * telling the author there was nothing to merge until they closed the stream
	 * and opened it again. Same height, same place, so nothing moves.
	 */
	private redrawBoundaries(): void {
		for (const entry of this.mounted.values()) {
			const segment = this.model?.segments.find(
				(candidate) => candidate.path === entry.path,
			);
			if (segment === undefined) continue;
			entry.el
				.querySelector(':scope > .snowflake-method-segment-boundary')
				?.remove();
			this.renderBoundary(entry.el, { after: segment.path });
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
	 *
	 * A note the Vault has not touched is left unopened. This runs on every
	 * Vault event, and in the ordinary case — the author typing in one segment —
	 * every other note held here is exactly as it was.
	 */
	private async refreshMountedBodies(): Promise<void> {
		let release: (() => void) | null = null;
		for (const entry of this.mounted.values()) {
			if (entry.pending !== null) continue;
			if (this.host.manuscriptSegmentStamp(entry.path) === entry.text.stamp) {
				continue;
			}
			try {
				const text = await this.host.readManuscriptSegment(entry.path);
				const changed = text.revision !== entry.text.revision;
				// Taken even when nothing changed: a file can be rewritten with the
				// same text in it, and the new stamp is what stops this reading it
				// again on every refresh from here on.
				entry.text = text;
				if (!changed) continue;
				// Held from the first note that has actually changed, and not before,
				// so a refresh finding nothing to do measures nothing. A note whose
				// text changed is a note whose height changed, and everything below
				// it moves by the difference.
				release ??= this.holdPosition();
				if (entry.editor === null) await this.renderSegmentBody(entry);
				else entry.editor.write(text.body);
			} catch (error) {
				this.showError(error);
			}
		}
		release?.();
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
		this.streamEl = null;
		this.tail = 0;
		const model = this.model;
		this.renderedProject = model?.projectPath ?? null;
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
	/**
	 * One at a time, however many things ask at once.
	 *
	 * Bringing the window into line renders every note that arrived, which on a
	 * full window is the better part of half a second. Four things can ask for it
	 * — going to a note, a Vault event, scrolling, and making one — and without
	 * this they can all be inside it together, each mounting and unmounting
	 * against measurements the others have already invalidated.
	 */
	private applyWindow(): Promise<void> {
		this.windowing = this.windowing.then(
			() => this.bringWindowIntoLine(),
			() => this.bringWindowIntoLine(),
		);
		return this.windowing;
	}

	/** Runs `work`, with any scrolling it causes counted as the view's own. */
	private async quietly<T>(work: () => Promise<T> | T): Promise<T> {
		this.settling += 1;
		try {
			return await work();
		} finally {
			// Released only once the browser has delivered the scroll events the
			// work caused, which it does after the current task rather than during.
			this.contentEl.win.setTimeout(() => {
				this.settling = Math.max(0, this.settling - 1);
			}, 0);
		}
	}

	private async bringWindowIntoLine(): Promise<void> {
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
			this.settleTail();
			return;
		}

		await this.quietly(async () => {
			const releaseUnmount = this.holdPosition(new Set(plan.visible));
			for (const path of plan.unmount) await this.unmountSegment(path);
			releaseUnmount();

			// The note the author asked for goes up on its own first, and is put
			// where they asked for it before its neighbours are rendered at all.
			//
			// Every note here goes through the Markdown renderer, sixteen
			// milliseconds apiece: a window of twenty-one took four hundred, and
			// for all of it the page sat on the chapter being left behind and then
			// jumped. Shown first, it can be read while the rest arrive around it,
			// and the hold below keeps it still while they do — so the wait is one
			// note however many are loaded. Only when the note is newly mounted,
			// which is a jump; sliding the window along leaves this alone.
			const anchor = this.activePath;
			const arriving =
				anchor !== null && plan.mount.includes(anchor) ? anchor : null;
			if (arriving !== null) {
				await this.mountSegment(arriving);
				this.reorder(plan.visible.filter((path) => this.mounted.has(path)));
				// Room before the move, not after it: a page holding one short note
				// cannot scroll far enough to bring it to the top, and the browser
				// stopping at the bottom is how the note lands where it fell.
				this.settleTail();
				this.scrollToActive();
			}

			const release = this.holdPosition(new Set(plan.visible));
			for (const path of plan.mount) {
				if (path === arriving) continue;
				await this.mountSegment(path);
			}
			this.reorder(plan.visible);
			this.renderEnds(plan.atStart, plan.atEnd);
			this.settleTail();
			release();
		});
	}

	/**
	 * Room below the last note, so that the one being read can be brought up to
	 * the top of the page.
	 *
	 * A page can only scroll as far as it has content, and a note with less than
	 * a screenful of manuscript after it cannot reach the top of one. That is the
	 * closing chapter of any book — measured on a ten-note project, it landed
	 * 761px low — and, because the window holds only a few notes on either side,
	 * it is the opening chapter of a short one too: asked for, `Prologue` sat
	 * 171px down a page that could not scroll at all.
	 *
	 * Exactly what that note is short by and nothing more, so a long book never
	 * grows a gap and a short one grows only what it needs. The reader's own
	 * position is counted alongside the note's, because a tail that shrank under
	 * someone already standing in it would take the page down with them.
	 */
	private settleTail(): void {
		const stream = this.streamEl;
		if (stream === null) return;
		const active =
			this.activePath === null ? undefined : this.mounted.get(this.activePath);
		const scrollTop = stream.scrollTop;
		const activeTop =
			active === undefined
				? 0
				: active.el.getBoundingClientRect().top -
					stream.getBoundingClientRect().top +
					scrollTop;
		// What the manuscript itself puts on the page, without the room added
		// last time — measuring against that would compound it on every call.
		const content = stream.scrollHeight - this.tail;
		const room = Math.round(
			Math.max(
				0,
				stream.clientHeight - (content - Math.max(scrollTop, activeTop)),
			),
		);
		if (room === this.tail) return;
		this.tail = room;
		stream.style.setProperty(
			'--snowflake-method-manuscript-tail',
			`${String(room)}px`,
		);
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
		this.renderBoundary(el, { after: segment.path });
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
		const actions = header.createDiv({
			cls: 'snowflake-method-segment-actions',
		});
		// Not offered on a note that cannot be written in, because pressing it
		// would do nothing: activateSegment turns a read-only segment away.
		if (this.model?.readOnly !== true && !segment.readOnly) {
			const write = actions.createEl('button', {
				// `view-action` alongside `clickable-icon` for the size Obsidian gives
				// the same button in a note's own header: 28 by 24, on a 16px icon.
				cls: 'clickable-icon view-action snowflake-method-segment-write',
				attr: { type: 'button' },
			});
			this.dressWriteToggle(write, this.editingPath === segment.path);
			write.addEventListener('click', (event) => {
				event.stopPropagation();
				void this.toggleSegment(segment.path).catch((error: unknown) => {
					this.showError(error);
				});
			});
		}
		const open = actions.createEl('button', {
			cls: 'clickable-icon view-action snowflake-method-segment-open',
			attr: { type: 'button' },
		});
		setIcon(open, 'file-text');
		// Obsidian's own tooltip rather than the browser's: its header buttons
		// carry an aria-label and no title, and setting both shows two.
		setTooltip(open, this.t('manuscript.openNote'));
		open.addEventListener('click', (event) => {
			event.stopPropagation();
			void this.host.openManagedFile(segment.path).catch((error: unknown) => {
				this.showError(error);
			});
		});
		return header;
	}

	/**
	 * Starts or stops writing in one note.
	 *
	 * Clicking the prose has always been the way in. This is the way back out,
	 * which until now there was none of: an editor stayed mounted until the
	 * author clicked into some other note or the window let go of this one.
	 */
	private async toggleSegment(path: string): Promise<void> {
		if (this.editingPath === path) await this.deactivateSegment();
		else await this.activateSegment(path);
	}

	/**
	 * Says which way the toggle would go, in its icon and in its tooltip.
	 *
	 * Worded as Obsidian words the same toggle on a note of its own — where the
	 * view is now, then what pressing it would do — so an author reads one
	 * sentence in both places rather than two dialects of the same idea.
	 */
	private dressWriteToggle(el: HTMLElement, editing: boolean): void {
		// Two sentences on two lines, the way Obsidian's own tooltip reads.
		const where = this.t(
			editing ? 'manuscript.nowEditing' : 'manuscript.nowReading',
		);
		const then = this.t(
			editing ? 'manuscript.clickToRead' : 'manuscript.clickToEdit',
		);
		setTooltip(el, `${where}\n${then}`);
		// The pencil and the open book Obsidian uses on its own reading toggle.
		setIcon(el, editing ? 'book-open' : 'pencil');
	}

	/** Re-dresses every toggle after the note being written in has changed. */
	private refreshWriteToggles(): void {
		for (const entry of this.mounted.values()) {
			const toggle = entry.el.querySelector<HTMLElement>(
				'.snowflake-method-segment-write',
			);
			if (toggle !== null) {
				this.dressWriteToggle(toggle, this.editingPath === entry.path);
			}
		}
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
			void this.activateSegment(entry.path, clickedWords(event)).catch(
				(error: unknown) => {
					this.showError(error);
				},
			);
		});
	}

	/**
	 * Puts an editor where the rendered text was, having first put the segment
	 * that had one back to rendered. One editor at a time is what the stable
	 * backend offers; the swap is where that has to be honoured.
	 */
	private async activateSegment(
		path: string,
		clicked?: ClickedWords,
	): Promise<void> {
		if (this.editingPath === path) {
			this.backend.focus(path);
			return;
		}
		if (this.model?.readOnly === true) return;
		const entry = this.mounted.get(path);
		if (entry === undefined || entry.text.readOnly) return;

		await this.deactivateSegment();

		// An editor is not the height of the prose it replaces, so everything
		// below this note moves, and if the note itself is below the reader then
		// so does the note. Held across the swap and let go of before the caret is
		// placed, because placing it is the one move that was asked for.
		const restore = this.holdPosition();

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
		this.refreshWriteToggles();
		this.remember(path);
		restore();
		// The words the author clicked go back under the pointer, and the caret
		// goes into them. Holding the note still is not enough: the source of a
		// line is not the height of the line, so everything after the first
		// heading has moved even though the note itself has not.
		if (clicked !== undefined) this.putBack(entry, clicked);
		// Focused last, because focusing an editor scrolls its caret into view and
		// would otherwise be the final word on where the reader ends up.
		entry.editor.focus();
		if (clicked !== undefined) this.keepPuttingBack(entry, clicked);
	}

	/**
	 * Puts the words back on each of the next few frames, while the editor is
	 * still working out how tall it is.
	 *
	 * A CodeMirror only just built estimates the height of every line it has not
	 * laid out yet, and replaces those estimates over the frames that follow.
	 * Measured on a chapter of two thousand words: it agreed with the page for
	 * two frames and then grew by 72px on the third, taking the words 54px down
	 * with it. Asking again is a search of the text and one measurement, and it
	 * is over inside a tenth of a second — long before an author can have typed
	 * anything, and it stops the moment they do.
	 */
	private keepPuttingBack(entry: MountedSegment, clicked: ClickedWords): void {
		const win = this.contentEl.win;
		const untouched = entry.pending;
		let frames = 0;
		const again = (): void => {
			if (this.editingPath !== entry.path || entry.pending !== untouched) return;
			this.putBack(entry, clicked);
			frames += 1;
			if (frames < SETTLING_FRAMES) win.requestAnimationFrame(again);
		};
		win.requestAnimationFrame(again);
	}

	/** Scrolls the words a click landed on back to where the pointer left them. */
	private putBack(entry: MountedSegment, clicked: ClickedWords): void {
		const stream = this.streamEl;
		const gone = entry.editor?.seek(
			clicked.passage,
			clicked.lead,
			clicked.screenY,
			clicked.near,
		);
		if (stream === null || gone === null || gone === undefined || gone === 0) {
			return;
		}
		// Counted as the view's own, because it is: answering it as the reader's
		// would pick whichever note the reading line happened to land on and set
		// the whole window sliding.
		void this.quietly(() => {
			stream.scrollTop += gone;
		});
	}

	private async deactivateSegment(): Promise<void> {
		const path = this.editingPath;
		if (path === null) return;
		await this.flushPendingSave();
		this.editingPath = null;
		this.refreshWriteToggles();
		// The note going back to prose may be anywhere, including above the reader,
		// so its place is held across the swap — and held from before the editor
		// goes, not after. Taking an editor down empties the note to a header and
		// a rule, which drops a reader who was a page into it several chapters
		// further on; a hold taken at that moment pins whichever note they landed
		// on, and putting the prose back shoves that note down the page, so the
		// release chases it. Measured on a split, a swap that should have moved
		// nothing threw the reader four and a half thousand pixels into the book.
		const release = this.holdPosition();
		await this.quietly(async () => {
			await this.backend.unmount(path);
			const entry = this.mounted.get(path);
			if (entry === undefined) return;
			entry.editor = null;
			await this.renderSegmentBody(entry);
		});
		release();
	}

	/**
	 * The rule between two segments, and the one thing it offers: another
	 * segment, here. Splitting used to hang off this button too and does not
	 * belong: it acts on a caret inside a segment rather than on the gap between
	 * two, so it lives in the segment's own menu and in the command palette.
	 *
	 * Where the new note goes is the same placement `createSegment` takes, so the
	 * rule above the first note can offer what every other rule offers rather
	 * than being the one line in the manuscript that offers nothing.
	 */
	private renderBoundary(
		el: HTMLElement,
		placement: { after: string } | { atStart: true },
	): void {
		const leading = !('after' in placement);
		const boundary = el.createDiv({
			cls: leading
				? 'snowflake-method-segment-boundary is-leading'
				: 'snowflake-method-segment-boundary',
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
				'aria-label': this.t(
					leading ? 'manuscript.insertSegmentBefore' : 'manuscript.insertSegment',
				),
			},
		});
		setIcon(add, 'plus');
		add.addEventListener('click', () => {
			void this.createSegment(placement);
		});
		if ('after' in placement) this.renderMergeControl(actions, placement.after);
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
			attr: { type: 'button', 'aria-label': label },
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
		const at = model.segments.findIndex((segment) => segment.path === path);
		const kept = model.segments[at];
		const removed = model.segments[at + 1];
		if (kept === undefined || removed === undefined) return;
		// Asked before anything is put away, because the answer may be no. This is
		// the one action here that takes a note away, and taking the editor down
		// first would move the page while the author was still deciding.
		const agreed = await confirmSegmentMerge(
			this.app,
			this.t,
			kept.title,
			removed.title,
		);
		if (!agreed) return;
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
			// bottom. This is that line, and it offers what the others offer: a
			// note here, which at the top of the book means before the first one.
			if (placement === 'start') {
				this.renderBoundary(host, { atStart: true });
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
		// Only the reader moves the reading position. A page shrinking under the
		// scroll as notes are let go of moves it too, and answering that is how
		// the view ends up chasing itself.
		if (stream === null || this.settling > 0) return;
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

	/**
	 * Pins whatever is under the reader's eye, and gives back the way to put it
	 * back there once the page has changed underneath it.
	 *
	 * Anything mounting, unmounting, growing or shrinking above the viewport
	 * moves everything below it, which throws the page off mid-sentence. The
	 * note straddling the top of the viewport is the one the reader is on, so
	 * its distance from that edge is what is kept — not the active note's, which
	 * may be off screen, and not the scroll offset, which means nothing once the
	 * heights above it have changed.
	 *
	 * Measured against the viewport rather than through offsetTop, which counts
	 * from whichever ancestor happens to be positioned and here is the leaf
	 * rather than the stream. `surviving` names what will still be mounted
	 * afterwards, because a note about to be let go cannot hold anybody's place
	 * and a detached one reports nothing but zeroes.
	 */
	private holdPosition(surviving?: ReadonlySet<string>): () => void {
		const stream = this.streamEl;
		if (stream === null) return () => undefined;
		const edge = stream.getBoundingClientRect().top;
		const held = [...this.mounted.values()]
			.filter((entry) => surviving?.has(entry.path) !== false)
			.map((entry) => ({ el: entry.el, box: entry.el.getBoundingClientRect() }))
			.filter((seen) => seen.box.bottom > edge)
			.sort((left, right) => left.box.top - right.box.top)[0];
		if (held === undefined) return () => undefined;
		const wanted = held.box.top - edge;
		return () => {
			if (!held.el.isConnected) return;
			const now =
				held.el.getBoundingClientRect().top -
				stream.getBoundingClientRect().top;
			stream.scrollTop = Math.max(0, stream.scrollTop + (now - wanted));
		};
	}

	/**
	 * Brings a note to where it can be read, and only when it is not already
	 * somewhere it can be read.
	 *
	 * Asking to go to a note means going there. A note that has just appeared
	 * where the author was already looking is a different matter: they clicked a
	 * rule in front of them and it became a chapter in front of them, and
	 * hauling it to the top of the page to say so undoes that.
	 */
	private bringIntoView(path: string): void {
		const stream = this.streamEl;
		const entry = this.mounted.get(path);
		if (stream === null || entry === undefined) return;
		const margin = Math.min(120, stream.clientHeight / 5);
		const fromTop =
			entry.el.getBoundingClientRect().top - stream.getBoundingClientRect().top;
		if (fromTop >= margin && fromTop <= stream.clientHeight - margin) return;
		this.scrollToActive();
	}

	private scrollToActive(): void {
		const stream = this.streamEl;
		const entry =
			this.activePath === null ? undefined : this.mounted.get(this.activePath);
		if (stream === null || entry === undefined) return;
		// Moved by the gap between where the note is and where the top of the page
		// is, rather than set to offsetTop — which is counted from whichever
		// ancestor happens to be positioned, here the leaf rather than the stream,
		// and so lands every note the same distance out.
		void this.quietly(() => {
			stream.scrollTop +=
				entry.el.getBoundingClientRect().top -
				stream.getBoundingClientRect().top;
		});
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
				const saved = await this.host.saveManuscriptSegment(
					entry.path,
					pending,
					entry.text.revision,
				);
				entry.text = { ...entry.text, body: pending, ...saved };
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
		try {
			// The editor is put away only once there is a name to put it away for.
			// Doing it first moves the page while the author is still looking at the
			// form, deciding whether to go ahead at all.
			const created = await this.host.createManuscriptSegment(
				model.projectPath,
				placement,
				() => this.deactivateSegment(),
			);
			if (created === null) return;
			await this.refresh();
			// The one move that is asked for rather than suffered — and only when
			// the new note is not already where the author is looking.
			this.activePath = created;
			await this.applyWindow();
			this.bringIntoView(created);
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

		// Read before asking, because asking takes the caret away. Nothing else
		// happens until there is a name: the editor goes away as part of the
		// split, not as part of being asked about one.
		const offset = entry.editor.cursor();
		try {
			const created = await this.host.splitManuscriptSegment(
				model.projectPath,
				path,
				offset,
				() => this.deactivateSegment(),
			);
			if (created === null) return;
			// The words that were under the caret are the new note's first words
			// and are already on the screen: the rule appearing where the caret was
			// is the whole of what happened, so nothing needs to move.
			//
			// Which is why the note arrives before it becomes the one the window is
			// centred on. Pointed at first it is a note that is not mounted yet, and
			// putting up the note that was asked for is exactly what takes a
			// manuscript to the top of it — measured, a split at a caret four
			// hundred pixels down the page landed the reader at nought. Refreshed
			// first, it goes up with the page held still, and becoming the active
			// note afterwards costs nothing.
			await this.refresh();
			// Named rather than left to the window to work out. A note the model no
			// longer holds sends `windowAround` back to the first one in the book,
			// which is the right answer for a note that has been merged away and the
			// wrong one here: the note this split made is where the author is.
			this.activePath = created;
			await this.applyWindow();
			// And into it, the way adding a note goes into the note it added. The
			// caret was in these words a moment ago and the author was writing them;
			// the split gave them a chapter of their own, not somewhere else to be.
			await this.activateSegment(created);
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

interface ClickedWords {
	/** The prose the pointer was over, to be found again in the Markdown. */
	passage: string;
	/** How far into that passage the pointer itself was. */
	lead: number;
	/** Where on the screen it was, so it can be put back there. */
	screenY: number;
	/** How far through the note, for telling repeated wording apart. */
	near: number;
}

/**
 * The words under a click, and where they were.
 *
 * Taken from the rendered text rather than from coordinates, because
 * coordinates stop meaning anything the moment the editor changes the height of
 * what is on the page — whereas the words are the same words either side of the
 * swap, and finding them again is what puts them back under the pointer.
 *
 * The passage is cut from the whole note's text rather than from the one DOM
 * node the pointer was in, which ends at the nearest emphasis or link — a click
 * beside a short formatted run used to come away with too few words to search
 * for. And the click's place in the note is walked to, not searched for, so a
 * sentence the chapter repeats cannot answer for the wrong copy of itself.
 */
function clickedWords(event: MouseEvent): ClickedWords | undefined {
	const target = event.target as HTMLElement | null;
	const doc = target?.ownerDocument;
	if (doc === undefined || doc === null) return undefined;
	const container = target?.closest('.snowflake-method-segment-rendered');
	if (container === null || container === undefined) return undefined;
	const spot = caretAt(doc, event.clientX, event.clientY);
	if (spot === null) return undefined;
	const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	let before = 0;
	let met = false;
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		if (node === spot.node) {
			met = true;
			break;
		}
		before += node.textContent?.length ?? 0;
	}
	if (!met) return undefined;
	const at = before + spot.offset;
	const prose = container.textContent ?? '';
	// Reaching back from the click as well as forward, because clicking past the
	// end of a line puts the caret at the end of that paragraph's text and leaves
	// nothing in front of it to go looking for.
	const from = Math.max(0, at - 24);
	return {
		passage: prose.slice(from, at + 48),
		lead: at - from,
		screenY: event.clientY,
		near: at / Math.max(1, prose.length),
	};
}

/**
 * The character a click landed on, from whichever of the two APIs this build of
 * Obsidian has. `caretPositionFromPoint` is the standard one and the newer
 * arrival; the other is what Chromium answered with for years before it, asked
 * for by name because the Document type has since retired it. Only a text node
 * is an answer: an element hit numbers its children, not its characters.
 */
function caretAt(
	doc: Document,
	x: number,
	y: number,
): { node: Node; offset: number } | null {
	const spot =
		typeof doc.caretPositionFromPoint === 'function'
			? doc.caretPositionFromPoint(x, y)
			: null;
	if (spot !== null) {
		return spot.offsetNode.nodeType === Node.TEXT_NODE
			? { node: spot.offsetNode, offset: spot.offset }
			: null;
	}
	const legacy = (
		doc as unknown as {
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		}
	).caretRangeFromPoint;
	const range = typeof legacy === 'function' ? legacy.call(doc, x, y) : null;
	if (range === null) return null;
	return range.startContainer.nodeType === Node.TEXT_NODE
		? { node: range.startContainer, offset: range.startOffset }
		: null;
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
