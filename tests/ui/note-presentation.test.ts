// @vitest-environment happy-dom

import { beforeAll, describe, expect, it } from 'vitest';

import {
	DEFAULT_MANUSCRIPT_PRESENTATION,
	PRESENTATION_PROPERTIES,
	type ManuscriptPresentation,
	type PresentationScope,
} from '../../src/domain';
import {
	NOTE_DRESS_CLASS,
	NOTE_TAB_DRESS_CLASS,
	NotePresentation,
	type DressableNote,
} from '../../src/ui/note-presentation';
import { installObsidianDom } from '../helpers/obsidian-dom';

/**
 * The dress on notes of Obsidian's own, over plain elements: which views are
 * dressed under each scope, what the leaf carries while dressed, and that
 * every trace leaves when the dress does.
 */
describe('NotePresentation', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	const look: ManuscriptPresentation = {
		...DEFAULT_MANUSCRIPT_PRESENTATION,
		fontFamily: 'Georgia',
		fontSize: 18,
		firstLineIndent: 2,
		guide: 'dashed',
	};

	const standings: Record<string, { inProject: boolean; inManuscript: boolean; locale: string | null }> = {
		'Novel/50_Manuscript/Chapter 1.md': { inProject: true, inManuscript: true, locale: 'en' },
		'Novel/20_Character/Ann.md': { inProject: true, inManuscript: false, locale: 'en' },
		'Loose/Idea.md': { inProject: false, inManuscript: false, locale: null },
	};

	function harness(scope: PresentationScope) {
		const notes: DressableNote[] = Object.keys(standings).map((path) => ({
			path,
			containerEl: document.body.createDiv(),
			tabHeaderEl: document.body.createDiv(),
		}));
		let current = scope;
		let dress = look;
		const presentation = new NotePresentation({
			look: () => dress,
			scope: () => current,
			standing: (path) => standings[path] ?? { inProject: false, inManuscript: false, locale: null },
			notes: () => notes,
		});
		return {
			presentation,
			notes,
			setScope: (next: PresentationScope) => { current = next; },
			setLook: (next: ManuscriptPresentation) => { dress = next; },
			dressed: () => notes.filter((note) => note.containerEl.classList.contains(NOTE_DRESS_CLASS)).map((note) => note.path),
		};
	}

	it('dresses the notes each scope reaches, and no others', () => {
		// The stream dresses itself: its scope leaves every tab of the app's own alone.
		const stream = harness('stream');
		stream.presentation.apply();
		expect(stream.dressed()).toEqual([]);

		const project = harness('project');
		project.presentation.apply();
		expect(project.dressed()).toEqual([
			'Novel/50_Manuscript/Chapter 1.md',
			'Novel/20_Character/Ann.md',
		]);

		const vault = harness('vault');
		vault.presentation.apply();
		expect(vault.dressed()).toEqual(Object.keys(standings));
		expect(vault.presentation.wears('Loose/Idea.md')).toBe(true);
		expect(project.presentation.wears('Loose/Idea.md')).toBe(false);
		expect(stream.presentation.wears('Novel/50_Manuscript/Chapter 1.md')).toBe(false);
	});

	it('writes the stream’s own contract on the leaf: the variables and the tongue, never the guides', () => {
		const { presentation, notes } = harness('project');
		presentation.apply();
		const root = notes[0]?.containerEl as HTMLElement;
		expect(root.style.getPropertyValue(PRESENTATION_PROPERTIES.font)).toBe('"Georgia", var(--font-text)');
		expect(root.style.getPropertyValue(PRESENTATION_PROPERTIES.fontSize)).toBe('18px');
		expect(root.style.getPropertyValue(PRESENTATION_PROPERTIES.indent)).toBe('2em');
		expect(root.style.getPropertyValue(PRESENTATION_PROPERTIES.align)).toBe('justify');
		// Left at the theme's: no property at all, so the fallback reads.
		expect(root.style.getPropertyValue(PRESENTATION_PROPERTIES.lineHeight)).toBe('');
		// The grid lines are the stream's alone.
		expect(root.classList.contains('is-guide-dashed')).toBe(false);
		expect(root.classList.contains('is-guide-solid')).toBe(false);
		expect(root.getAttribute('lang')).toBe('en');
	});

	it('takes every trace off a note the scope no longer reaches', () => {
		const { presentation, notes, setScope } = harness('vault');
		presentation.apply();
		const loose = notes[2]?.containerEl as HTMLElement;
		expect(loose.classList.contains(NOTE_DRESS_CLASS)).toBe(true);
		expect(loose.getAttribute('lang')).toBeNull();
		setScope('stream');
		presentation.apply();
		expect(loose.classList.contains(NOTE_DRESS_CLASS)).toBe(false);
		expect(loose.getAttribute('style') ?? '').toBe('');
		const character = notes[1]?.containerEl as HTMLElement;
		expect(character.classList.contains(NOTE_DRESS_CLASS)).toBe(false);
		expect(character.classList.contains('is-guide-dashed')).toBe(false);
		expect(character.getAttribute('lang')).toBeNull();
		const chapter = notes[0]?.containerEl as HTMLElement;
		expect(chapter.classList.contains(NOTE_DRESS_CLASS)).toBe(false);
		expect(chapter.getAttribute('lang')).toBeNull();
	});

	it('follows a change of dress, and a view that shows nothing wears nothing', () => {
		const { presentation, notes, setLook } = harness('project');
		presentation.apply();
		const root = notes[0]?.containerEl as HTMLElement;
		setLook({ ...look, guide: 'none', fontSize: 0 });
		presentation.apply();
		expect(root.style.getPropertyValue(PRESENTATION_PROPERTIES.fontSize)).toBe('');
		expect(root.classList.contains(NOTE_DRESS_CLASS)).toBe(true);

		const blank: DressableNote = { path: null, containerEl: document.body.createDiv() };
		presentation.applyTo(blank);
		expect(blank.containerEl.classList.contains(NOTE_DRESS_CLASS)).toBe(false);
	});

	it('marks the tab over a dressed note, and takes the mark off with the dress', () => {
		const { presentation, notes, setScope } = harness('project');
		presentation.apply();
		const tabOf = (index: number): HTMLElement => notes[index]?.tabHeaderEl as HTMLElement;
		expect(tabOf(0).classList.contains(NOTE_TAB_DRESS_CLASS)).toBe(true);
		expect(tabOf(1).classList.contains(NOTE_TAB_DRESS_CLASS)).toBe(true);
		expect(tabOf(2).classList.contains(NOTE_TAB_DRESS_CLASS)).toBe(false);
		setScope('stream');
		presentation.apply();
		expect(notes.some((_note, index) => tabOf(index).classList.contains(NOTE_TAB_DRESS_CLASS))).toBe(false);
		// A view the app gives no tab is dressed all the same.
		const untabbed: DressableNote = { path: 'Loose/Idea.md', containerEl: document.body.createDiv() };
		setScope('vault');
		presentation.applyTo(untabbed);
		expect(untabbed.containerEl.classList.contains(NOTE_DRESS_CLASS)).toBe(true);
	});

	it('takes the tab’s mark off when the tab turns to another view, and redresses a note that comes back', () => {
		const { presentation, notes } = harness('project');
		presentation.apply();
		const first = notes[0] as DressableNote;
		const tab = first.tabHeaderEl as HTMLElement;
		expect(tab.classList.contains(NOTE_TAB_DRESS_CLASS)).toBe(true);
		// The same tab now shows a PDF: the app lists the leaf no more.
		notes.splice(0, 1);
		presentation.apply();
		expect(tab.classList.contains(NOTE_TAB_DRESS_CLASS)).toBe(false);
		// A note brought back into that tab is a new view under the same tab.
		const back: DressableNote = {
			path: 'Novel/50_Manuscript/Chapter 1.md',
			containerEl: document.body.createDiv(),
			tabHeaderEl: tab,
		};
		notes.unshift(back);
		presentation.apply();
		expect(tab.classList.contains(NOTE_TAB_DRESS_CLASS)).toBe(true);
		expect(back.containerEl.classList.contains(NOTE_DRESS_CLASS)).toBe(true);
	});

	it('takes every trace off every note when it is let go', () => {
		const { presentation, notes } = harness('project');
		presentation.apply();
		expect(notes[0]?.containerEl.style.getPropertyValue(PRESENTATION_PROPERTIES.font)).not.toBe('');
		presentation.undressAll();
		for (const note of notes) {
			const root = note.containerEl;
			expect(root.classList.contains(NOTE_DRESS_CLASS)).toBe(false);
			expect(root.getAttribute('lang')).toBeNull();
			expect(root.dataset.snowflakeMethodLang).toBeUndefined();
			for (const name of Object.values(PRESENTATION_PROPERTIES)) {
				expect(root.style.getPropertyValue(name)).toBe('');
			}
			expect(note.tabHeaderEl?.classList.contains(NOTE_TAB_DRESS_CLASS)).toBe(false);
		}
	});

	it('reaches notes alone: a canvas in the project is no note', () => {
		const { presentation } = harness('vault');
		expect(presentation.wears('Novel/Board.canvas')).toBe(false);
		expect(presentation.wears('Loose/Idea.MD')).toBe(true);
		const canvas: DressableNote = { path: 'Novel/Board.canvas', containerEl: document.body.createDiv() };
		presentation.applyTo(canvas);
		expect(canvas.containerEl.classList.contains(NOTE_DRESS_CLASS)).toBe(false);
	});
});
