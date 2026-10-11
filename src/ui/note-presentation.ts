import {
	PRESENTATION_PROPERTIES,
	noteWearsPresentation,
	presentationShape,
	presentationStyle,
	type ManuscriptPresentation,
	type NoteStanding,
	type PresentationScope,
} from '../domain';

/**
 * The manuscript's dress on notes opened in tabs of Obsidian's own.
 *
 * The stream dresses itself; a note in an ordinary tab is dressed from here,
 * by the same contract: the typography as custom properties on the leaf,
 * which styles.css reads under one marker class with the theme's own values
 * as fallbacks. The guide lines stay the stream's: a note of the app's own
 * sets its headings and markers at sizes of their own, and rules through
 * them read as a mess, so the guide classes are never put on a note. Which
 * notes wear the dress is the scope's to say, from where each note stands,
 * and the host answers that from the projects it knows. Kept free of
 * Obsidian's classes so the rule can be run over plain objects: the host
 * says which views are notes.
 */
export const NOTE_DRESS_CLASS = 'snowflake-method-note-dressed';

/**
 * Worn by the tab over a dressed note. The tab stands outside the leaf, so
 * the leaf's class does not reach it, and its face, which joins the page
 * below it while the note is in front, takes the page's ground from this.
 */
export const NOTE_TAB_DRESS_CLASS = 'snowflake-method-note-dressed-tab';

/** What a note's view offers: the file it shows and the two elements dressed. */
export interface DressableNote {
	/** The note's path, or null while the view shows nothing. */
	path: string | null;
	/** The leaf's content root, where the variables and the marker class go. */
	containerEl: HTMLElement;
	/** The tab over the leaf, where the app gives the leaf one. */
	tabHeaderEl?: HTMLElement | null;
}

export interface NotePresentationDeps {
	look(): ManuscriptPresentation;
	scope(): PresentationScope;
	/** Where a note stands, and the language of its project if it has one. */
	standing(path: string): NoteStanding & { locale: string | null };
	/** Every note view open anywhere, popouts included. */
	notes(): Iterable<DressableNote>;
}

/** Whether a path is a note's at all: the dress is Markdown's, and a canvas card's editor shows a canvas. */
function isNotePath(path: string): boolean {
	return path.toLowerCase().endsWith('.md');
}

export class NotePresentation {
	/** The dress each view wears, so a repeat changes nothing. */
	private readonly worn = new WeakMap<HTMLElement, string>();
	/**
	 * Every view dressed, with its tab: what a view no longer listed, or the
	 * plugin going away, has to take off again. The tab outlives the view in
	 * it, so a tab turned to a PDF or a canvas would otherwise keep the tint.
	 */
	private readonly dressed = new Map<HTMLElement, HTMLElement | null>();

	constructor(private readonly deps: NotePresentationDeps) {}

	/** Whether a note at a path is one the typography reaches. */
	wears(path: string): boolean {
		return this.standingOf(path) !== null;
	}

	/**
	 * Where a note stands, when the dress reaches it: null for a file that is
	 * no note, and for a note the scope stops short of.
	 */
	private standingOf(
		path: string,
	): (NoteStanding & { locale: string | null }) | null {
		if (!isNotePath(path)) return null;
		const standing = this.deps.standing(path);
		return noteWearsPresentation(this.deps.scope(), standing) ? standing : null;
	}

	/** Every open note dressed or undressed afresh. */
	apply(): void {
		const notes = [...this.deps.notes()];
		const listed = new Set(notes.map((note) => note.containerEl));
		const tabs = new Set(notes.map((note) => note.tabHeaderEl ?? null));
		// A view dressed before and gone since, its tab now showing something
		// else, takes the dress off; a tab a listed note now holds is left to it.
		for (const [root, tab] of [...this.dressed]) {
			if (!listed.has(root)) this.undress(root, tabs.has(tab) ? null : tab);
		}
		for (const note of notes) this.applyTo(note);
	}

	/** The dress taken off every view that wears it, for the plugin going away. */
	undressAll(): void {
		for (const [root, tab] of [...this.dressed]) this.undress(root, tab);
	}

	private undress(root: HTMLElement, tab: HTMLElement | null | undefined): void {
		this.dressed.delete(root);
		this.worn.delete(root);
		for (const name of Object.values(PRESENTATION_PROPERTIES)) {
			root.style.removeProperty(name);
		}
		root.removeClass(NOTE_DRESS_CLASS, ...Object.keys(presentationStyle(this.deps.look()).classes));
		tab?.removeClass(NOTE_TAB_DRESS_CLASS);
		if (root.dataset.snowflakeMethodLang !== undefined) {
			root.removeAttribute('lang');
			delete root.dataset.snowflakeMethodLang;
		}
	}

	applyTo(note: DressableNote): void {
		const root = note.containerEl;
		const standing = note.path === null ? null : this.standingOf(note.path);
		const look = this.deps.look();
		// The language rides the shape: a note that moved between projects
		// of two languages has the same dress and a different tongue.
		const shape =
			standing !== null
				? `${presentationShape(look)}|lang:${standing.locale ?? ''}`
				: '';
		if (this.worn.get(root) === shape) return;
		if (standing === null) {
			this.undress(root, note.tabHeaderEl);
			this.worn.set(root, shape);
			return;
		}
		this.worn.set(root, shape);
		this.dressed.set(root, note.tabHeaderEl ?? null);
		const style = presentationStyle(look);
		for (const [name, value] of Object.entries(style.properties)) {
			if (value === null) root.style.removeProperty(name);
			else root.style.setProperty(name, value);
		}
		root.addClass(NOTE_DRESS_CLASS);
		note.tabHeaderEl?.addClass(NOTE_TAB_DRESS_CLASS);
		// The classes are the guide lines, which a note never wears.
		root.removeClass(...Object.keys(style.classes));
		// The page speaks the project's language, as the stream does, so
		// hyphenation dictionaries and CJK fallback follow it. Only a tongue
		// this plugin wrote is ever taken off again.
		if (standing.locale !== null) {
			root.setAttribute('lang', standing.locale);
			root.dataset.snowflakeMethodLang = standing.locale;
		} else if (root.dataset.snowflakeMethodLang !== undefined) {
			root.removeAttribute('lang');
			delete root.dataset.snowflakeMethodLang;
		}
	}
}
