import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Menu, Notice, type MarkdownPostProcessorContext } from 'obsidian';

import {
	analyzeMentions,
	combineMentionMarks,
	dialogueRanges,
	planDialogueMarks,
	planHighlightMarks,
	planMentionMarks,
	planSensitiveMarks,
	sensitiveOccurrencesOf,
	splitMentionIgnores,
	type CompiledHighlightRules,
	type DialoguePresentation,
	type DialogueStyle,
	type DocumentType,
	type EntityMatcher,
	type EntityOccurrence,
	type MentionCandidate,
	type MentionHighlightMode,
	type MentionIgnore,
	type MentionMark,
	type SensitiveMatcher,
} from '../domain';
import { mentionMarkAt, refreshMentionHighlights } from '../editor';
import { frontmatterLength } from '../repository';
import { pluginWrittenRanges } from '../templates';
import {
	applyDialogueMarks,
	applyMentionMarks,
	projectMentionMarks,
} from './mention-marks';
import { addMentionMenuItems, openMentionMenu } from './mention-menu';
import { pressYieldsToSelection } from './selection-press';

/**
 * The stream's mention marks on the notes of a project opened in tabs of
 * Obsidian's own.
 *
 * A note the typography dresses, in a project, wears what a chapter in the
 * stream wears: its entity mentions marked under the stream's mode, the
 * sensitive words, the custom rules and the dialogue's look. The marks are
 * planned by the stream's own planners from the same feed -- the project's
 * roster and ignores, the settings' dress -- so the two pages never
 * disagree about what a passage mentions, and they answer with the stream's
 * own menu. The note's editor carries them as decorations, which the host's
 * editor extension asks for here; its reading view carries them as the
 * stream's rendered half does, wrapped into each section as the app draws
 * it. A right-click on a mention offers what can be done about it, and in
 * reading a click on one not yet linked asks the same, as it does in the
 * stream.
 *
 * Only the note's own text is read: what stands above its body, the
 * frontmatter, is no prose, and the sections the plugin writes into a note
 * are the plugin's, not the author's -- the mention index reads a note the
 * same way. A note outside every project has no roster to read, and wears
 * no marks at all.
 *
 * Kept free of the app's view classes, like the dress and the bar, so the
 * rule can be run over plain objects in a test: the host says which views
 * are notes and how each one is drawn again.
 */

/** One project's feed: what the stream's feed holds that a note wears. */
export interface NoteMentionFeed {
	matcher: EntityMatcher;
	ignores: readonly MentionIgnore[];
	sensitive: SensitiveMatcher;
	highlights: CompiledHighlightRules;
	dialogue: {
		styles: readonly DialogueStyle[];
		presentation: DialoguePresentation;
	};
	/** A project that cannot be written offers to open a mention, never to convert it. */
	readOnly: boolean;
}

/** What one note's text wears, planned once for each text and feed. */
export interface NoteMentionDress {
	/** The entity, sensitive and custom marks in one layer: the menu's index space. */
	marks: MentionMark[];
	/** The quoted stretches, a layer of their own under the marks. */
	dialogue: MentionMark[];
	/** The note's entity occurrences in document order, for an ignore's ordinal. */
	occurrences: EntityOccurrence[];
}

/**
 * One note's marks over its whole text, offsets the text's own. The body is
 * read as the mention index reads it -- below the frontmatter, the sections
 * the plugin writes left out -- so an ignore written against the third
 * "Alice" means the same third one whichever page wrote it.
 */
export function planNoteMentions(
	path: string,
	text: string,
	feed: NoteMentionFeed,
	mode: MentionHighlightMode,
	documentType: DocumentType | null,
): NoteMentionDress {
	const start = frontmatterLength(text);
	const body = text.slice(start);
	const written = pluginWrittenRanges(body, documentType);
	let occurrences: EntityOccurrence[] = [];
	let entityMarks: MentionMark[] = [];
	if (mode !== 'off' && feed.matcher.patternCount > 0) {
		const split = splitMentionIgnores(feed.ignores);
		occurrences = analyzeMentions(path, body, written, feed.matcher, split.candidate);
		entityMarks = planMentionMarks(occurrences, split.occurrence, mode);
	}
	const dressOnly: MentionMark[][] = [];
	if (feed.sensitive.termCount > 0) {
		dressOnly.push(
			planSensitiveMarks(sensitiveOccurrencesOf(path, feed.sensitive.collect(body, written))),
		);
	}
	if (feed.highlights.matchableCount > 0) {
		dressOnly.push(
			planHighlightMarks(
				path,
				body,
				feed.highlights.collect(body, written),
				feed.highlights.rules,
			),
		);
	}
	const marks = combineMentionMarks(entityMarks, ...dressOnly);
	const dialogue =
		feed.dialogue.presentation === 'off' || feed.dialogue.styles.length === 0
			? []
			: planDialogueMarks(path, body, dialogueRanges(body, feed.dialogue.styles, written));
	if (start === 0) return { marks, dialogue, occurrences };
	// Back into the text's own offsets, which are the editor's and the file's.
	const shift = <T extends { from: number; to: number }>(entry: T): T => ({
		...entry,
		from: entry.from + start,
		to: entry.to + start,
	});
	const shiftMark = (mark: MentionMark): MentionMark => ({
		...shift(mark),
		occurrence: shift(mark.occurrence),
	});
	return {
		marks: marks.map(shiftMark),
		dialogue: dialogue.map(shiftMark),
		occurrences: occurrences.map(shift),
	};
}

/**
 * What the dress was planned under, as one string: a feed that answers the
 * same as the last one, under the same mode, leaves every page as it stands.
 */
function feedKey(feed: NoteMentionFeed, mode: MentionHighlightMode): string {
	return JSON.stringify([
		feed.matcher.fingerprint,
		feed.ignores,
		feed.sensitive.fingerprint,
		feed.highlights.fingerprint,
		feed.dialogue,
		feed.readOnly,
		mode,
	]);
}

/** The look a note's page takes for its dialogue: a class on the leaf, as on the stream. */
const DIALOGUE_CLASSES: Record<'highlight' | 'focus', string> = {
	highlight: 'snowflake-method-dialogue-highlight',
	focus: 'snowflake-method-dialogue-focus',
};

/** What a note's view offers: where it is drawn, and its editor. */
export interface MentionNote {
	/** The note's path, or null while the view shows nothing. */
	path: string | null;
	/** The leaf's content root, which wears the dialogue's look. */
	containerEl: HTMLElement;
	/** The note's text as its view holds it, which is what its reading view draws. */
	text(): string;
	/** The note's editor, whose marks are asked for again; null while there is none. */
	editor(): EditorView | null;
	/** The reading view drawn again, so each section is dressed afresh. */
	rerender(): void;
}

export interface NoteMentionsDeps {
	/**
	 * The project whose marks a note at a path wears: null for a note the
	 * typography does not dress, and for one no project holds.
	 */
	projectOf(path: string): string | null;
	/** One project's feed, or null when the project gives none. */
	feed(projectPath: string): Promise<NoteMentionFeed | null>;
	/** Which entity mentions are marked: the stream's own mode. */
	mode(): MentionHighlightMode;
	/** The type a note declares, which says which sections in it the plugin writes. */
	documentType(path: string): DocumentType | null;
	/** Every note view open anywhere, popouts included. */
	notes(): Iterable<MentionNote>;
	/** The words for a note's menus, in the tongue of its project. */
	t(path: string): (key: string, vars?: Record<string, string | number>) => string;
	openMember(memberPath: string): Promise<void>;
	addIgnore(projectPath: string, rule: MentionIgnore): Promise<void>;
	/**
	 * One stretch of a note's file replaced, failing closed: false, and
	 * nothing written, when the stretch no longer reads `expected`.
	 */
	replaceInFile(path: string, from: number, to: number, expected: string, insert: string): Promise<boolean>;
	showError(error: unknown): void;
}

interface FeedSlot {
	/** The last answer, kept while a newer one is asked for so no page flickers bare. */
	state: NoteMentionFeed | null;
	/** What the last answer was planned under; '' for none. */
	key: string;
	/** The change the latest ask was made after. */
	asked: number;
}

/** A mention wrapped into a reading section, and what its menu needs. */
interface ReadMention {
	path: string;
	project: string;
	mark: MentionMark;
	occurrences: readonly EntityOccurrence[];
}

/** A right-click on an editor, kept for the menu the app builds after it. */
interface Pointed {
	view: EditorView;
	x: number;
	y: number;
	at: number;
}

/** Long enough for the app's menu to follow the right-click, short enough to never outlive it. */
const POINTED_FOR_MS = 1000;

/** Whether something an undocumented field holds is an element. */
const isElement = (value: unknown): value is HTMLElement =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as HTMLElement).closest === 'function';

export class NoteMentions {
	private readonly feeds = new Map<string, FeedSlot>();
	/** Bumped by every change that may move a project's feed. */
	private generation = 0;
	/** The last dress planned for each note, by its text and what it was planned under. */
	private readonly planned = new Map<string, { text: string; key: string; dress: NoteMentionDress }>();
	/** Where each line of the last text read in sections begins. */
	private lines: { text: string; starts: number[] } | null = null;
	/** The project each view's note was last dressed for, and the note: what changes under it. */
	private readonly worn = new WeakMap<HTMLElement, { path: string | null; project: string | null }>();
	/** The mentions wrapped into reading sections, each answering its own menu. */
	private readonly read = new WeakMap<HTMLElement, ReadMention>();
	/** Each note view by its content root, as a reading section finds it. */
	private readonly views = new WeakMap<Element, MentionNote>();
	private pointed: Pointed | null = null;
	private destroyed = false;

	constructor(private readonly deps: NoteMentionsDeps) {}

	/** The marks an editor showing a note wears now: empty while its feed is on its way. */
	editorMarks(path: string, text: string): readonly MentionMark[] {
		const dress = this.dressFor(path, text);
		return dress === null ? [] : [...dress.marks, ...dress.dialogue];
	}

	/**
	 * Every feed asked for again, after a change that may have moved one:
	 * the roster, the ignores, the mode or the dress. A feed that answers as
	 * it did leaves every page alone; one that changed redraws its notes.
	 */
	refresh(): void {
		this.generation += 1;
		for (const project of this.openProjects()) this.ask(project);
		this.apply();
	}

	/**
	 * Every open note given its dialogue look, and any note that is now
	 * another note, or now in another project or none, dressed afresh: asked
	 * at the moments a note can newly be on screen, and after a change.
	 */
	apply(): void {
		const open = new Set<string>();
		for (const note of this.deps.notes()) {
			if (note.path !== null) open.add(note.path);
			const project = note.path === null ? null : this.deps.projectOf(note.path);
			const state = project === null ? null : this.feedFor(project);
			this.lookOf(note.containerEl, state);
			const was = this.worn.get(note.containerEl);
			if (was !== undefined && was.path === note.path && was.project === project) continue;
			this.worn.set(note.containerEl, { path: note.path, project });
			// A note new to its editor is marked now rather than a pause after
			// its text arrived; one that stopped being worn is undressed.
			if (was !== undefined || project !== null) this.redrawNote(note, was !== undefined && was.project !== project);
		}
		// A note no tab shows any more keeps no plan, nor the text it was made for.
		for (const path of [...this.planned.keys()]) {
			if (!open.has(path)) this.planned.delete(path);
		}
	}

	/** Every mark taken back off, for the plugin going away. */
	destroy(): void {
		this.destroyed = true;
		for (const note of this.deps.notes()) {
			note.containerEl.removeClasses(Object.values(DIALOGUE_CLASSES));
			if (note.path !== null && this.deps.projectOf(note.path) !== null) note.rerender();
		}
		this.feeds.clear();
		this.planned.clear();
	}

	/**
	 * One section of a reading view dressed as the app draws it. Only a tab's
	 * own note: a note embedded in another, or one shown in a popover, is
	 * drawn as the app draws it. The context's container says where the
	 * section is going -- the section itself is not in the page yet.
	 */
	dressSection(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		if (this.destroyed) return;
		const container: unknown = (ctx as { containerEl?: unknown }).containerEl;
		if (!isElement(container)) return;
		if (container.closest('.markdown-reading-view') === null) return;
		if (container.closest('.markdown-embed, .internal-embed, .hover-popover') !== null) return;
		// Asked first, being cheap: most notes drawn belong to no project, and
		// their sections need no walk through the open tabs.
		const project = this.deps.projectOf(ctx.sourcePath);
		if (project === null) return;
		const root = container.closest('.workspace-leaf-content');
		if (root === null) return;
		const shown = this.noteAt(root, ctx.sourcePath);
		if (shown === null) return;
		const info = ctx.getSectionInfo(el);
		if (info === null) return;
		// A view drawn again whole hands its sections their lines and no text:
		// the text is the view's own, which is what the sections are drawn from.
		const text = info.text.length > 0 ? info.text : shown.text();
		const dress = this.dressFor(ctx.sourcePath, text);
		if (dress === null) return;
		const starts = this.lineStarts(text);
		const from = starts[info.lineStart] ?? text.length;
		const after = starts[info.lineEnd + 1];
		const to = after === undefined ? text.length : after - 1;
		if (to <= from) return;
		const slice = text.slice(from, to);
		// The marks this section holds, in its own offsets; each keeps the
		// whole note's mark for the menu, whose offsets are the file's.
		const within = (marks: readonly MentionMark[]): { shown: MentionMark[]; kept: MentionMark[] } => {
			const shownMarks: MentionMark[] = [];
			const kept: MentionMark[] = [];
			for (const mark of marks) {
				if (mark.to <= from || mark.from >= to) continue;
				kept.push(mark);
				shownMarks.push({ ...mark, from: Math.max(mark.from, from) - from, to: Math.min(mark.to, to) - from });
			}
			return { shown: shownMarks, kept };
		};
		const dialogue = within(dress.dialogue);
		const marks = within(dress.marks);
		if (dialogue.shown.length === 0 && marks.shown.length === 0) return;
		// Dialogue first, so the marks nest inside the quoted stretch they stand in.
		applyDialogueMarks(el, projectMentionMarks(slice, dialogue.shown));
		applyMentionMarks(el, projectMentionMarks(slice, marks.shown));
		let answers = false;
		for (const span of Array.from(el.querySelectorAll<HTMLElement>('[data-snowflake-method-mention]'))) {
			const mark = marks.kept[Number(span.getAttribute('data-snowflake-method-mention'))];
			if (mark === undefined || mark.occurrence.type !== 'entity') continue;
			this.read.set(span, { path: ctx.sourcePath, project, mark, occurrences: dress.occurrences });
			answers = true;
		}
		if (!answers) return;
		el.addEventListener('click', this.onReadingPress);
		el.addEventListener('contextmenu', this.onReadingPress);
	}

	/** Where a right-click on an editor landed, for the menu the app builds after it. */
	pointAt(view: EditorView, event: MouseEvent): void {
		this.pointed = { view, x: event.clientX, y: event.clientY, at: Date.now() };
	}

	/**
	 * The mention under a right-click on a note's editor, added to the app's
	 * menu at the head of the plugin's section, as the stream's segment menu
	 * leads with it. `lead` puts the section's heading up first. False when
	 * no mention was under the pointer.
	 */
	addEditorMenuItems(menu: Menu, view: EditorView, path: string, section: string, lead: () => void): boolean {
		const pointed = this.pointed;
		this.pointed = null;
		if (pointed === null || pointed.view !== view || Date.now() - pointed.at > POINTED_FOR_MS) return false;
		const project = this.deps.projectOf(path);
		if (project === null) return false;
		const feed = this.feeds.get(project)?.state ?? null;
		if (feed === null) return false;
		const mark = mentionMarkAt(view, pointed.x, pointed.y);
		// Sensitive and custom marks are dress alone, and answer no menu.
		if (mark === null || mark.occurrence.type !== 'entity') return false;
		const t = this.deps.t(path);
		// The editor's answer is mapped to the text as it stands mid-pause,
		// where the last plan's offsets may not be: an ignore's ordinal is
		// counted over the live text, in the click's own space.
		const occurrences = this.dressFor(path, view.state.doc.toString())?.occurrences ?? [];
		lead();
		return addMentionMenuItems(menu, {
			occurrence: mark.occurrence,
			noteOccurrences: occurrences,
			t,
			section,
			...(feed.readOnly
				? {}
				: {
						onConvert: (candidate: MentionCandidate) => {
							const expected = mark.occurrence.matchedText;
							if (view.state.sliceDoc(mark.from, mark.to) !== expected) {
								new Notice(t('manuscript.mention.stale'));
								return;
							}
							view.dispatch({
								changes: { from: mark.from, to: mark.to, insert: candidate.insert },
								selection: EditorSelection.cursor(mark.from + candidate.insert.length),
								userEvent: 'input.complete',
								scrollIntoView: true,
							});
						},
					}),
			onOpen: (candidate) => {
				this.guard(this.deps.openMember(candidate.memberPath));
			},
			onIgnore: (rule) => {
				this.guard(this.deps.addIgnore(project, rule));
			},
		});
	}

	/**
	 * A click on a mention not yet linked, in reading, asks what to do about
	 * it, as it does in the stream, and a right-click asks the same. A finger
	 * held on the word on a phone is the system's own selection and asks
	 * nothing. A linked one is a link: a click follows it, and the app's own
	 * menu for it answers a right-click.
	 */
	private readonly onReadingPress = (event: MouseEvent): void => {
		if (this.destroyed || !isElement(event.target)) return;
		const span = event.target.closest<HTMLElement>('span.snowflake-method-mention.is-unlinked');
		if (span === null) return;
		const found = this.read.get(span);
		if (found === undefined) return;
		if (event.type === 'contextmenu' && pressYieldsToSelection(event, span.ownerDocument)) return;
		event.preventDefault();
		this.openReadMenu(found, event);
	};

	private openReadMenu(found: ReadMention, event: MouseEvent): void {
		const { path, project, mark } = found;
		if (mark.occurrence.type !== 'entity') return;
		const t = this.deps.t(path);
		const readOnly = this.feeds.get(project)?.state?.readOnly ?? true;
		openMentionMenu({
			occurrence: mark.occurrence,
			noteOccurrences: found.occurrences,
			t,
			...(readOnly
				? {}
				: {
						onConvert: (candidate: MentionCandidate) => {
							this.guard(
								this.deps
									.replaceInFile(path, mark.from, mark.to, mark.occurrence.matchedText, candidate.insert)
									.then((done) => {
										if (!done) new Notice(t('manuscript.mention.stale'));
									}),
							);
						},
					}),
			onOpen: (candidate) => {
				this.guard(this.deps.openMember(candidate.memberPath));
			},
			onIgnore: (rule) => {
				this.guard(this.deps.addIgnore(project, rule));
			},
			event,
		});
	}

	/**
	 * The note view whose content root this is, when it shows the note at
	 * the path: found once for the root and kept, since every section of one
	 * view asks, and looked for again only when the one kept shows another.
	 */
	private noteAt(root: Element, path: string): MentionNote | null {
		const kept = this.views.get(root);
		if (kept !== undefined && kept.path === path) return kept;
		for (const note of this.deps.notes()) {
			if (note.containerEl !== root) continue;
			this.views.set(root, note);
			return note.path === path ? note : null;
		}
		return null;
	}

	private guard(work: Promise<void>): void {
		void work.catch((error: unknown) => {
			this.deps.showError(error);
		});
	}

	/** One note's dress for one text, planned once: null while its feed is on its way. */
	private dressFor(path: string, text: string): NoteMentionDress | null {
		const project = this.deps.projectOf(path);
		if (project === null) return null;
		const feed = this.feedFor(project);
		if (feed === null) return null;
		const key = this.feeds.get(project)?.key ?? '';
		const kept = this.planned.get(path);
		if (kept !== undefined && kept.key === key && kept.text === text) return kept.dress;
		const dress = planNoteMentions(path, text, feed, this.deps.mode(), this.deps.documentType(path));
		this.planned.set(path, { text, key, dress });
		return dress;
	}

	/** A project's feed as it last answered, asked for again when a change came after. */
	private feedFor(project: string): NoteMentionFeed | null {
		const slot = this.feeds.get(project);
		if (slot === undefined || slot.asked < this.generation) this.ask(project);
		return this.feeds.get(project)?.state ?? null;
	}

	private ask(project: string): void {
		const generation = this.generation;
		const slot = this.feeds.get(project) ?? { state: null, key: '', asked: -1 };
		if (slot.asked === generation) return;
		slot.asked = generation;
		this.feeds.set(project, slot);
		void this.deps
			.feed(project)
			.then((state) => {
				// An ask made after a later change answers for that change.
				if (this.destroyed || slot.asked !== generation) return;
				const key = state === null ? '' : feedKey(state, this.deps.mode());
				if (key === slot.key) return;
				slot.state = state;
				slot.key = key;
				this.redress(project);
			})
			.catch((error: unknown) => {
				// Said once, and asked again only after the next change: a feed
				// that fails now fails again at every pause in the typing.
				if (this.destroyed || slot.asked !== generation) return;
				this.deps.showError(error);
			});
	}

	/** Every open note of one project dressed afresh, in its editor and its reading view. */
	private redress(project: string): void {
		for (const note of this.deps.notes()) {
			if (note.path === null || this.deps.projectOf(note.path) !== project) continue;
			this.lookOf(note.containerEl, this.feeds.get(project)?.state ?? null);
			this.redrawNote(note, true);
		}
	}

	private redrawNote(note: MentionNote, reading: boolean): void {
		const editor = note.editor();
		if (editor !== null) refreshMentionHighlights(editor);
		if (reading) note.rerender();
	}

	/** The dialogue's look on one view, from its project's feed: none without one. */
	private lookOf(el: HTMLElement, state: NoteMentionFeed | null): void {
		const look =
			state !== null && state.dialogue.styles.length > 0 ? state.dialogue.presentation : 'off';
		for (const [face, cls] of Object.entries(DIALOGUE_CLASSES)) el.toggleClass(cls, look === face);
	}

	/** The projects the open notes wear marks for. */
	private openProjects(): Set<string> {
		const projects = new Set<string>();
		for (const note of this.deps.notes()) {
			if (note.path === null) continue;
			const project = this.deps.projectOf(note.path);
			if (project !== null) projects.add(project);
		}
		return projects;
	}

	/** Where each line of a text begins, kept for the next section of the same text. */
	private lineStarts(text: string): number[] {
		if (this.lines !== null && this.lines.text === text) return this.lines.starts;
		const starts = [0];
		for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
		this.lines = { text, starts };
		return starts;
	}
}
