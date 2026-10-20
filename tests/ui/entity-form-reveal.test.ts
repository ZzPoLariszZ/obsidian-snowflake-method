import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProjectDashboardModel, WorldbuildingEntityViewModel } from '../../src/ui/view-model';

// Keep Obsidian's window and modal drawing outside this test, while running
// the dashboard's form routing and the worldbuilding modal's real initialization.
vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		modalEl = { addClass: (): void => undefined };
		setTitle(): void {}
	}
	return {
		...runtime,
		Modal,
		ItemView: class {},
		FuzzySuggestModal: class extends Modal {},
		SuggestModal: class extends Modal {},
	};
});

import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import { RecordCardsEditor } from '../../src/ui/entity-form';
import { EntityFormModal } from '../../src/ui/modals';

const entity = (fields: Partial<WorldbuildingEntityViewModel> = {}): WorldbuildingEntityViewModel => ({
	id: 'entity-1',
	path: 'Novel/60_Worldbuilding/61_Time/Dawn.md',
	name: 'Dawn',
	kind: 'time',
	rank: 1,
	progressStatus: 'not-started',
	aliases: [],
	categoryPaths: [],
	description: 'First light',
	timeKind: 'point',
	timeStart: '',
	timeEnd: '',
	timeStartMissing: false,
	timeEndMissing: false,
	color: null,
	worldStatus: [],
	relationships: [],
	customFields: '',
	revision: 'before-edit',
	readOnly: false,
	healthIssues: [], gallery: [], galleryMain: null,
	...fields,
});

/** A member as the opener by group reads it: found by id, and written unless it says otherwise. */
interface MemberStub {
	id: string;
	readOnly?: boolean;
	healthIssues?: { blocking: boolean }[];
}

function dashboard(
	entities: WorldbuildingEntityViewModel[],
	members: { characters?: MemberStub[]; scenes?: MemberStub[]; readOnly?: boolean } = {},
) {
	const view = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
	const refresh = vi.fn(async () => undefined);
	const updateEntity = vi.fn(async () => undefined);
	const createEntity = vi.fn(async () => ({ id: 'entity-9', path: 'Novel/60_Worldbuilding/61_Time/Dusk.md' }));
	const stub = (member: MemberStub): MemberStub => ({ readOnly: false, healthIssues: [], ...member });
	const loadDashboardModel = vi.fn(async () => ({
		path: 'Novel/Novel.md',
		scenes: (members.scenes ?? []).map(stub),
		characters: (members.characters ?? []).map(stub),
		worldbuilding: { time: entities },
		worldbuildingKinds: [{ id: 'time', folderName: '61_Time', custom: false }],
		readOnly: members.readOnly ?? false,
	} as unknown as ProjectDashboardModel));
	Object.assign(view, {
		app: {},
		host: { loadDashboardModel, updateEntity, createEntity },
		projectPath: 'Novel/Novel.md',
		projectLocale: 'en',
		selectedStep: 8,
		t: (key: string) => key,
		refresh,
		memberFormContext: vi.fn(() => Promise.resolve(undefined)),
	});
	const opened: EntityFormModal[] = [];
	vi.spyOn(EntityFormModal.prototype, 'open').mockImplementation(function (this: EntityFormModal) {
		opened.push(this);
	});
	vi.spyOn(EntityFormModal.prototype, 'onClose').mockImplementation(() => undefined);
	const revealed = vi.spyOn(EntityFormModal.prototype, 'revealDescription').mockImplementation(() => undefined);
	const revealedRelationships = vi
		.spyOn(EntityFormModal.prototype, 'revealRelationships')
		.mockImplementation(() => undefined);
	return { view, refresh, opened, revealed, revealedRelationships, updateEntity, createEntity, loadDashboardModel };
}

/** A character's or a scene's form as the opener sees it: revealed, then closed by the test. */
function memberForm() {
	return { revealRelationships: vi.fn(), onClose: vi.fn() };
}

const submit = (form: EntityFormModal, request: unknown): Promise<void> =>
	(form as unknown as { submitHandler(request: unknown): Promise<void> }).submitHandler(request);

afterEach(() => vi.restoreAllMocks());

describe('worldbuilding forms opened from another surface', () => {
	it('opens the editor on its description and reports the save without reloading the hidden dashboard', async () => {
		const { view, opened, revealed, updateEntity, refresh, loadDashboardModel } = dashboard([entity()]);
		const onSaved = vi.fn();
		const closing = view.openEntityForm({ mode: 'edit', id: 'entity-1', section: 'description' }, onSaved);
		await vi.waitFor(() => expect(opened).toHaveLength(1));
		const form = opened[0]!;
		expect(revealed).toHaveBeenCalledOnce();
		await submit(form, { kind: 'time', name: 'Dawn', description: 'Changed' });
		expect(updateEntity).toHaveBeenCalledExactlyOnceWith('entity-1', { kind: 'time', name: 'Dawn', description: 'Changed' }, 'Novel/Novel.md');
		expect(onSaved).toHaveBeenCalledOnce();
		expect(loadDashboardModel).toHaveBeenCalledOnce();
		expect(refresh).not.toHaveBeenCalled();
		expect(view).toMatchObject({ refreshQueuedWhileHidden: true });
		form.onClose();
		expect(await closing).toBeNull();
	});

	it('leaves the description where it is unless asked to open on it', async () => {
		const { view, opened, revealed } = dashboard([entity()]);
		const closing = view.openEntityForm({ mode: 'edit', id: 'entity-1' });
		await vi.waitFor(() => expect(opened).toHaveLength(1));
		expect(revealed).not.toHaveBeenCalled();
		opened[0]!.onClose();
		await closing;
	});

	it('makes a note of the kind from the preset, and reports its id', async () => {
		const { view, opened, createEntity } = dashboard([]);
		const onSaved = vi.fn();
		const closing = view.openEntityForm(
			{ mode: 'create', kind: 'time', preset: { name: 'Dusk', timeKind: 'point', lockTimeKind: true } },
			onSaved,
		);
		await vi.waitFor(() => expect(opened).toHaveLength(1));
		const form = opened[0]!;
		await submit(form, { kind: 'time', name: 'Dusk', description: '' });
		expect(createEntity).toHaveBeenCalledExactlyOnceWith({ kind: 'time', name: 'Dusk', description: '' }, 'Novel/Novel.md');
		expect(onSaved).toHaveBeenCalledOnce();
		form.onClose();
		expect(await closing).toBe('entity-9');
	});

	it('opens the create form on the words handed in, though a field would make the note from them alone', async () => {
		const { view, opened, createEntity } = dashboard([]);
		Object.assign((view as unknown as { host: object }).host, {
			opensFormWhenCreatingFromField: () => false,
		});
		const making = view.createMemberThroughForm('location', 'Ash Tree');
		await vi.waitFor(() => expect(opened).toHaveLength(1));
		const form = opened[0]!;
		expect((form as unknown as { value: { kind: string; name: string } }).value).toMatchObject({
			kind: 'location',
			name: 'Ash Tree',
		});
		await submit(form, { kind: 'location', name: 'Ash Tree', description: '' });
		expect(createEntity).toHaveBeenCalledOnce();
		form.onClose();
		expect(await making).toBe(true);
		expect(view).toMatchObject({ refreshQueuedWhileHidden: true });
	});

	it('does not open an editor for a note that cannot be written, or one that is gone', async () => {
		const { view, opened } = dashboard([entity({ readOnly: true })]);
		expect(await view.openEntityForm({ mode: 'edit', id: 'entity-1', section: 'description' })).toBeNull();
		expect(await view.openEntityForm({ mode: 'edit', id: 'entity-2' })).toBeNull();
		expect(opened).toHaveLength(0);
	});
});

describe('a relationship card opened for the graph', () => {
	it("opens a note's form on the card and reports once the form has closed", async () => {
		const { view, opened, revealed, revealedRelationships } = dashboard([entity()]);
		const closing = view.openRelationship({ group: 'worldbuilding', id: 'entity-1' }, 2);
		await vi.waitFor(() => expect(opened).toHaveLength(1));
		expect(revealedRelationships).toHaveBeenCalledExactlyOnceWith(2);
		expect(revealed).not.toHaveBeenCalled();
		opened[0]!.onClose();
		expect(await closing).toBe(true);
	});

	it("opens a character's or a scene's own form, and reveals the card there", async () => {
		const { view } = dashboard([], { characters: [{ id: 'character-1' }], scenes: [{ id: 'scene-1' }] });
		const character = memberForm();
		const scene = memberForm();
		const openCharacterEditor = vi.fn(() => Promise.resolve(character));
		const openSceneEditor = vi.fn(() => Promise.resolve(scene));
		Object.assign(view, { openCharacterEditor, openSceneEditor });

		const closingCharacter = view.openRelationship({ group: 'character', id: 'character-1' }, 0);
		await vi.waitFor(() => expect(character.revealRelationships).toHaveBeenCalledExactlyOnceWith(0));
		expect(openCharacterEditor).toHaveBeenCalledWith(
			expect.objectContaining({ path: 'Novel/Novel.md' }),
			expect.objectContaining({ id: 'character-1' }),
			expect.any(Function),
		);
		character.onClose();
		expect(await closingCharacter).toBe(true);

		const closingScene = view.openRelationship({ group: 'scene', id: 'scene-1' }, 1);
		await vi.waitFor(() => expect(scene.revealRelationships).toHaveBeenCalledExactlyOnceWith(1));
		expect(openSceneEditor).toHaveBeenCalledWith(
			expect.objectContaining({ path: 'Novel/Novel.md' }),
			expect.objectContaining({ id: 'scene-1' }),
			undefined,
			expect.any(Function),
		);
		scene.onClose();
		expect(await closingScene).toBe(true);
	});

	it('says no for a member gone, one not to be written, and a project that cannot be', async () => {
		const blocked = dashboard([entity({ readOnly: true })], {
			characters: [{ id: 'character-1', healthIssues: [{ blocking: true }] }],
		});
		Object.assign(blocked.view, { openCharacterEditor: vi.fn() });
		expect(await blocked.view.openRelationship({ group: 'worldbuilding', id: 'entity-1' }, 0)).toBe(false);
		expect(await blocked.view.openRelationship({ group: 'worldbuilding', id: 'entity-9' }, 0)).toBe(false);
		expect(await blocked.view.openRelationship({ group: 'character', id: 'character-1' }, 0)).toBe(false);
		expect(await blocked.view.openRelationship({ group: 'scene', id: 'scene-1' }, 0)).toBe(false);
		expect(blocked.opened).toHaveLength(0);

		const readOnly = dashboard([entity()], { readOnly: true });
		expect(await readOnly.view.openRelationship({ group: 'worldbuilding', id: 'entity-1' }, 0)).toBe(false);
		expect(readOnly.opened).toHaveLength(0);
	});
});

describe('a record card revealed from outside', () => {
	function cardsEditor(count: number) {
		const editor = Object.create(RecordCardsEditor.prototype) as RecordCardsEditor;
		const block = { scrollIntoView: vi.fn() };
		/** The document's focus listeners by type: the mark comes off on a focus that lands outside the card. */
		const docListeners = new Map<string, (event: { target: unknown }) => void>();
		const doc = {
			addEventListener: vi.fn((type: string, listener: (event: { target: unknown }) => void) => {
				docListeners.set(type, listener);
			}),
			removeEventListener: vi.fn((type: string) => {
				docListeners.delete(type);
			}),
		};
		const cards = Array.from({ length: count }, () => {
			const classes = new Set<string>();
			const valueEl = { focus: vi.fn() };
			const el = {
				classes,
				doc,
				addClass: (cls: string): void => { classes.add(cls); },
				removeClass: (cls: string): void => { classes.delete(cls); },
				contains: (node: unknown): boolean => node === valueEl,
				scrollIntoView: vi.fn(),
			};
			return { el, valueEl };
		});
		Object.assign(editor, { cards, blockEl: block });
		return { editor, block, cards, doc, docListeners };
	}

	it('marks the card, puts the caret in its text and scrolls it to the middle, until the focus lands elsewhere', () => {
		const { editor, block, cards, doc, docListeners } = cardsEditor(2);
		editor.revealCard(1);
		const [first, second] = cards;
		expect(second!.el.classes.has('is-revealed')).toBe(true);
		expect(second!.valueEl.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
		expect(second!.el.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'center' });
		expect(doc.addEventListener).toHaveBeenCalledExactlyOnceWith('focusin', expect.any(Function));
		expect(first!.el.classes.size).toBe(0);
		expect(first!.valueEl.focus).not.toHaveBeenCalled();
		expect(block.scrollIntoView).not.toHaveBeenCalled();
		// A focus within the card keeps the mark; one anywhere else takes it off, and the listener with it.
		docListeners.get('focusin')!({ target: second!.valueEl });
		expect(second!.el.classes.has('is-revealed')).toBe(true);
		expect(doc.removeEventListener).not.toHaveBeenCalled();
		docListeners.get('focusin')!({ target: first!.valueEl });
		expect(second!.el.classes.has('is-revealed')).toBe(false);
		expect(doc.removeEventListener).toHaveBeenCalledExactlyOnceWith('focusin', expect.any(Function));
	});

	it('brings the block itself into view for no record, or one the form no longer holds', () => {
		const { editor, block, cards } = cardsEditor(1);
		editor.revealCard(null);
		editor.revealCard(4);
		expect(block.scrollIntoView).toHaveBeenCalledTimes(2);
		expect(block.scrollIntoView).toHaveBeenLastCalledWith({ block: 'start' });
		expect(cards[0]!.el.classes.size).toBe(0);
		expect(cards[0]!.valueEl.focus).not.toHaveBeenCalled();
	});

	it('does nothing before it is attached', () => {
		const detached = Object.create(RecordCardsEditor.prototype) as RecordCardsEditor;
		Object.assign(detached, { cards: [], blockEl: null });
		expect(() => { detached.revealCard(0); }).not.toThrow();
	});
});

describe('the description reveal lifetime', () => {
	function frameWindow() {
		const pending = new Map<number, () => void>();
		let next = 0;
		return {
			pending,
			requestAnimationFrame(callback: () => void): number {
				const id = ++next;
				pending.set(id, callback);
				return id;
			},
			cancelAnimationFrame(id: number): void {
				pending.delete(id);
			},
			advance(): void {
				for (const [id, callback] of [...pending]) {
					pending.delete(id);
					callback();
				}
			},
		};
	}

	function form(win?: ReturnType<typeof frameWindow>) {
		const modal = Object.create(EntityFormModal.prototype) as EntityFormModal;
		const focus = vi.fn();
		const scrollIntoView = vi.fn();
		const revealCard = vi.fn();
		const settingEl = { isConnected: true, scrollIntoView };
		Object.assign(modal, {
			modalEl: win === undefined ? {} : { win },
			contentEl: { empty: (): void => { settingEl.isConnected = false; } },
			actionsEl: null,
			pickers: [],
			descriptionRevealFrame: null,
			descriptionSetting: {
				settingEl,
				controlEl: { querySelector: () => ({ focus }) },
			},
			relationshipsRevealFrame: null,
			relationshipsEditor: { revealCard },
		});
		return { modal, focus, scrollIntoView, settingEl, revealCard };
	}

	it.each([0, 1])('cancels the pending reveal when closed after %i frames', (elapsed) => {
		const win = frameWindow();
		const { modal, focus, scrollIntoView } = form(win);
		modal.revealDescription();
		for (let i = 0; i < elapsed; i++) win.advance();
		expect(win.pending.size).toBe(1);
		modal.onClose();
		expect(win.pending.size).toBe(0);
		expect(modal).toMatchObject({ descriptionRevealFrame: null, descriptionSetting: null });
		win.advance();
		expect(focus).not.toHaveBeenCalled();
		expect(scrollIntoView).not.toHaveBeenCalled();
	});

	it('closes without accessing a window when no reveal was requested', () => {
		const { modal } = form();
		expect(() => modal.onClose()).not.toThrow();
		expect(modal).toMatchObject({ descriptionRevealFrame: null, descriptionSetting: null });
	});

	it('replaces an earlier reveal and focuses the description after two frames', () => {
		const win = frameWindow();
		const { modal, focus, scrollIntoView } = form(win);
		modal.revealDescription();
		win.advance();
		modal.revealDescription();
		expect(win.pending.size).toBe(1);
		win.advance();
		expect(focus).not.toHaveBeenCalled();
		win.advance();
		expect(win.pending.size).toBe(0);
		expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
		expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'start', behavior: 'auto' });
		expect(modal).toMatchObject({ descriptionRevealFrame: null });
	});

	it('does not focus or scroll a description row detached before its reveal', () => {
		const win = frameWindow();
		const { modal, focus, scrollIntoView, settingEl } = form(win);
		modal.revealDescription();
		win.advance();
		settingEl.isConnected = false;
		win.advance();
		expect(focus).not.toHaveBeenCalled();
		expect(scrollIntoView).not.toHaveBeenCalled();
		expect(win.pending.size).toBe(0);
	});
});

describe('the relationships reveal lifetime', () => {
	function frameWindow() {
		const pending = new Map<number, () => void>();
		let next = 0;
		return {
			pending,
			requestAnimationFrame(callback: () => void): number {
				const id = ++next;
				pending.set(id, callback);
				return id;
			},
			cancelAnimationFrame(id: number): void {
				pending.delete(id);
			},
			advance(): void {
				for (const [id, callback] of [...pending]) {
					pending.delete(id);
					callback();
				}
			},
		};
	}

	function form(win: ReturnType<typeof frameWindow>) {
		const modal = Object.create(EntityFormModal.prototype) as EntityFormModal;
		const revealCard = vi.fn();
		Object.assign(modal, {
			modalEl: { win },
			contentEl: { empty: (): void => undefined },
			actionsEl: null,
			pickers: [],
			descriptionRevealFrame: null,
			descriptionSetting: null,
			relationshipsRevealFrame: null,
			relationshipsEditor: { revealCard },
		});
		return { modal, revealCard };
	}

	it.each([0, 1])('cancels the pending reveal when closed after %i frames', (elapsed) => {
		const win = frameWindow();
		const { modal, revealCard } = form(win);
		modal.revealRelationships(1);
		for (let i = 0; i < elapsed; i++) win.advance();
		expect(win.pending.size).toBe(1);
		modal.onClose();
		expect(win.pending.size).toBe(0);
		expect(modal).toMatchObject({ relationshipsRevealFrame: null });
		win.advance();
		expect(revealCard).not.toHaveBeenCalled();
	});

	it('lands on the card after two frames, with the record it was asked for', () => {
		const win = frameWindow();
		const { modal, revealCard } = form(win);
		modal.revealRelationships(3);
		win.advance();
		expect(revealCard).not.toHaveBeenCalled();
		win.advance();
		expect(revealCard).toHaveBeenCalledExactlyOnceWith(3);
		expect(win.pending.size).toBe(0);
		expect(modal).toMatchObject({ relationshipsRevealFrame: null });
	});

	it('replaces an earlier reveal, and hands the block itself on for no record', () => {
		const win = frameWindow();
		const { modal, revealCard } = form(win);
		modal.revealRelationships(1);
		win.advance();
		modal.revealRelationships(null);
		expect(win.pending.size).toBe(1);
		win.advance();
		win.advance();
		expect(revealCard).toHaveBeenCalledExactlyOnceWith(null);
	});

	it('is at peace with a form drawn without the editor', () => {
		const win = frameWindow();
		const { modal } = form(win);
		Object.assign(modal, { relationshipsEditor: null });
		modal.revealRelationships(0);
		win.advance();
		expect(() => { win.advance(); }).not.toThrow();
	});
});
