import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';
import { createFakeEnvironment } from '../helpers/fake-vault';

interface MenuEntry { title: string; disabled: boolean; click(): void }
const { notices, menuEntries, opened } = vi.hoisted(() => ({
	notices: vi.fn(), menuEntries: [] as MenuEntry[], opened: [] as unknown[],
}));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		modalEl = { addClass: (): void => undefined };
		setTitle(): void {}
		override open(): void { opened.push(this); }
	}
	class Item implements MenuEntry {
		title = '';
		disabled = false;
		click = (): void => undefined;
		setTitle(title: string): this { this.title = title; return this; }
		setIcon(): this { return this; }
		setWarning(): this { return this; }
		setDisabled(disabled: boolean): this { this.disabled = disabled; return this; }
		onClick(click: () => void): this { this.click = click; return this; }
	}
	return {
		...runtime,
		Modal,
		// Keep atomic rank writes readable by the fake FileManager's JSON dialect.
		stringifyYaml: (value: unknown) => JSON.stringify(value, null, 2),
		FuzzySuggestModal: class extends Modal { setPlaceholder(): void {} },
		SuggestModal: class extends runtime.Modal {},
		SearchComponent: class extends runtime.SearchComponent { setValue(): this { return this; } },
		Notice: class { constructor(message: string) { notices(message); } },
		Menu: class {
			addItem(build: (item: Item) => void): this {
				const item = new Item(); build(item); menuEntries.push(item); return this;
			}
			addSeparator(): this { return this; }
			showAtMouseEvent(): void {}
		},
	};
});

vi.mock('../../src/ui/anchored-panel', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../../src/ui/anchored-panel')>();
	return {
		...runtime,
		hangPanel: (anchor: HTMLElement, spec: Parameters<typeof runtime.hangPanel>[1]) => {
			const panel = (anchor as unknown as CorkboardElement).dom.container.createDiv({ cls: spec.cls });
			spec.build(panel as unknown as HTMLElement);
			return { el: panel, release: vi.fn() };
		},
	};
});

import {
	FRONTMATTER_KEYS,
	SnowflakeProjectService,
	type RankRevisionChange,
	type SceneRecord,
} from '../../src/services';
import { renderCorkboard } from '../../src/ui/corkboard';
import type { CorkboardControls, CorkboardHandle, CorkboardHost } from '../../src/ui/corkboard-bridge';
import { SCENE_DRAG_TYPE } from '../../src/ui/corkboard-layout';
import { corkboardMemory } from '../../src/ui/story-structure-state';
import type { ProjectDashboardModel, SceneViewModel } from '../../src/ui/view-model';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((settle) => { resolve = settle; });
	return { promise, resolve };
}

function sceneModel(scene: SceneRecord): SceneViewModel {
	return {
		id: scene.sceneId, path: scene.path, title: scene.title, rank: scene.rank,
		progressStatus: scene.progressStatus, aliases: scene.aliases, categoryPaths: [],
		povPath: scene.povPath ?? '', povName: '', povMissing: false,
		times: scene.times, locations: scene.locations, characterPaths: [],
		conflict: scene.conflict, color: scene.color, linkedManuscript: [],
		worldStatus: scene.worldStatus, relationships: scene.relationships,
		events: scene.events, customFields: scene.customFields,
		revision: scene.revision, healthIssues: [], readOnly: scene.readOnly,
	};
}

const handles: CorkboardHandle[] = [];

/** Production rendering and service writes, with a gate before the reorder begins. */
async function board(ranks?: readonly number[]) {
	const environment = createFakeEnvironment();
	const service = new SnowflakeProjectService(environment.vault, environment.fileManager, environment.metadataCache);
	const project = await service.createProject({ title: 'Queued edits', locale: 'en' });
	for (let index = 0; index < (ranks?.length ?? 2); index++) {
		const created = await service.createScene(project, String.fromCharCode(65 + index));
		if (ranks !== undefined) {
			const file = environment.fakeVault.getFileByPath(created.path)!;
			await environment.fakeFileManager.processFrontMatter(file, (frontmatter) => {
				frontmatter[FRONTMATTER_KEYS.rank] = ranks[index];
			});
		}
	}
	const original = await service.listScenes(project);
	const dom = new CorkboardDom();
	let model = {
		path: project.projectFile, projectId: project.id, locale: 'en',
		scenes: original.map(sceneModel), characters: [], worldbuilding: {},
		manuscriptPaths: [], readOnly: false,
	} as unknown as ProjectDashboardModel;
	const gate = deferred();
	let afterRanks: ReturnType<typeof deferred> | null = null;
	const transitions: RankRevisionChange[] = [];
	const host = {
		patchScene: vi.fn<CorkboardHost['patchScene']>(async (id, patch, path) => {
			expect(path).toBe(project.projectFile);
			return (await service.updateScene(project, id, patch)).revision;
		}),
		reorderScene: vi.fn<CorkboardHost['reorderScene']>(async (id, target, path, written) => {
			expect(path).toBe(project.projectFile);
			await gate.promise;
			await service.reorderScene(project, id, target, (change) => {
				transitions.push(change);
				written?.(change);
			});
			await afterRanks?.promise;
		}),
		openSceneForm: vi.fn<CorkboardHost['openSceneForm']>(async (intent, path) => {
			expect(path).toBe(project.projectFile);
			if (intent.mode !== 'create') throw new Error('Expected a scene insertion');
			const created = await service.createScene(project, 'Inserted');
			if (intent.afterIndex !== null) await service.reorderScene(project, created.sceneId, intent.afterIndex + 1);
			return created.sceneId;
		}),
	};
	let handle: CorkboardHandle;
	const refresh = vi.fn(async () => {
		model = { ...model, scenes: (await service.listScenes(project)).map(sceneModel) };
		handle.refresh();
	});
	const memory = corkboardMemory();
	const controls = {
		app: { metadataCache: { getFirstLinkpathDest: () => null } },
		host, t: (key: string) => key, model: () => model, refresh,
		activateProject: vi.fn(), popover: { closeFilter: vi.fn() },
		memory, remember: vi.fn(),
	} as unknown as CorkboardControls;
	handle = renderCorkboard(dom.container as unknown as HTMLElement, controls);
	handles.push(handle);
	const card = (id: string): CorkboardElement => {
		const found = dom.container.querySelectorAll('.snowflake-method-corkboard-card')
			.find((candidate) => candidate.dataset.id === id);
		if (found === undefined) throw new Error(`Missing card: ${id}`);
		return found;
	};
	return {
		...environment, service, project, original, dom, host, handle, gate, card, transitions, refresh, memory,
		read: () => service.listScenes(project),
		holdAfterRanks: () => { afterRanks = deferred(); return afterRanks; },
	};
}

function chooseMenu(card: CorkboardElement, action: string): void {
	menuEntries.length = 0;
	card.querySelector('.snowflake-method-corkboard-more')!.dispatch('click');
	const item = menuEntries.find((candidate) => candidate.title === action)!;
	expect(item.disabled).toBe(false);
	item.click();
}

function moveDown(card: CorkboardElement): void {
	chooseMenu(card, 'actions.moveDown');
}

function event(element: CorkboardElement, type: string, properties: Record<string, unknown>): void {
	for (const listener of element.listeners.get(type) ?? []) {
		listener({ target: element, preventDefault: () => undefined, stopPropagation: () => undefined, ...properties });
	}
}

function dropAtEnd(fixture: Awaited<ReturnType<typeof board>>, card: CorkboardElement, before?: CorkboardElement): void {
	const canvas = fixture.dom.container.querySelector('.snowflake-method-corkboard-canvas')!;
	const data = new Map<string, string>();
	const dataTransfer = {
		types: [SCENE_DRAG_TYPE],
		setData: (type: string, value: string) => { data.set(type, value); },
		getData: (type: string) => data.get(type) ?? '',
	};
	event(card, 'dragstart', { target: null, dataTransfer });
	vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ height: 600, ...{ left: 0, top: 0 } });
	const position = before?.styles.transform?.match(/translate\(([\d.]+)px, ([\d.]+)px\)/u);
	if (before !== undefined) expect(position).not.toBeNull();
	event(canvas, 'dragover', {
		clientX: position ? Number(position[1]) + 1 : 0,
		clientY: position ? Number(position[2]) + 1 : 10_000,
		dataTransfer,
	});
	event(canvas, 'drop', { dataTransfer });
	card.dispatch('dragend');
}

function edit(card: CorkboardElement, field: 'progressStatus' | 'color'): void {
	if (field === 'progressStatus') {
		const input = card.querySelector('.snowflake-method-corkboard-status-select')!;
		input.value = 'complete';
		input.dispatch('change');
		return;
	}
	card.querySelector('.snowflake-method-corkboard-color')!.dispatch('click');
	const swatch = card.dom.container.querySelectorAll('.snowflake-method-sticky-swatch')
		.find((candidate) => candidate.dataset.color === 'macaron-2')!;
	swatch.dispatch('click');
}

beforeEach(() => { vi.clearAllMocks(); menuEntries.length = 0; opened.length = 0; });
afterEach(() => {
	for (const handle of handles.splice(0)) handle.dispose();
	vi.restoreAllMocks();
});

describe('corkboard drags queued behind rank writes', () => {
	it.each([false, true])('keeps the destination scene after an earlier move (disposed: %s)', async (disposed) => {
		const fixture = await board([0, 1, 2, 3]);
		const [a, b, , d] = fixture.original;
		dropAtEnd(fixture, fixture.card(a!.sceneId));
		await vi.waitFor(() => expect(fixture.host.reorderScene).toHaveBeenCalledOnce());
		dropAtEnd(fixture, fixture.card(b!.sceneId), fixture.card(d!.sceneId));
		if (disposed) fixture.handle.dispose();
		fixture.gate.resolve();
		await vi.waitFor(async () => {
			expect((await fixture.read()).map((scene) => scene.title)).toEqual(['C', 'B', 'D', 'A']);
		});
		expect(notices).not.toHaveBeenCalled();
	});

	it('keeps the direction selected when the second card was dropped', async () => {
		const fixture = await board([0, 1, 2, 3]);
		fixture.memory.reversed = true;
		fixture.handle.refresh();
		const [a, , c, d] = fixture.original;
		dropAtEnd(fixture, fixture.card(d!.sceneId));
		await vi.waitFor(() => expect(fixture.host.reorderScene).toHaveBeenCalledOnce());
		dropAtEnd(fixture, fixture.card(c!.sceneId), fixture.card(a!.sceneId));
		fixture.dom.container.querySelector('.snowflake-method-corkboard-direction')!.dispatch('click');
		expect(fixture.memory.reversed).toBe(false);
		fixture.gate.resolve();
		await vi.waitFor(async () => {
			expect((await fixture.read()).map((scene) => scene.title)).toEqual(['D', 'A', 'C', 'B']);
		});
		expect(notices).not.toHaveBeenCalled();
	});
});

describe('corkboard relative menu moves queued behind rank writes', () => {
	it.each([
		{ reversed: false, action: 'actions.moveDown', first: 0, before: null, moving: 1, expected: ['C', 'B', 'D', 'A'] },
		{ reversed: false, action: 'actions.moveUp', first: 3, before: 0, moving: 2, expected: ['D', 'A', 'C', 'B'] },
		{ reversed: true, action: 'actions.moveDown', first: 3, before: null, moving: 2, expected: ['D', 'A', 'C', 'B'] },
		{ reversed: true, action: 'actions.moveUp', first: 0, before: 3, moving: 1, expected: ['C', 'B', 'D', 'A'] },
	].flatMap((scenario) => [false, true].map((disposed) => ({ ...scenario, disposed }))))(
		'keeps the displayed neighbor for $action (reversed: $reversed, disposed: $disposed)',
		async ({ reversed, action, first, before, moving, expected, disposed }) => {
			const fixture = await board([0, 1, 2, 3]);
			fixture.memory.reversed = reversed;
			fixture.handle.refresh();
			dropAtEnd(fixture, fixture.card(fixture.original[first]!.sceneId),
				before === null ? undefined : fixture.card(fixture.original[before]!.sceneId));
			await vi.waitFor(() => expect(fixture.host.reorderScene).toHaveBeenCalledOnce());
			chooseMenu(fixture.card(fixture.original[moving]!.sceneId), action);
			if (disposed) fixture.handle.dispose();
			fixture.gate.resolve();
			await vi.waitFor(async () => {
				expect((await fixture.read()).map((scene) => scene.title)).toEqual(expected);
			});
			expect(notices).not.toHaveBeenCalled();
		},
	);

	it('keeps the neighbor within the displayed scene range', async () => {
		const fixture = await board([0, 1, 2, 3, 4]);
		fixture.memory.filters.sceneMin = 2;
		fixture.memory.filters.sceneMax = 4;
		fixture.handle.refresh();
		dropAtEnd(fixture, fixture.card(fixture.original[1]!.sceneId));
		await vi.waitFor(() => expect(fixture.host.reorderScene).toHaveBeenCalledOnce());
		moveDown(fixture.card(fixture.original[2]!.sceneId));
		fixture.gate.resolve();
		await vi.waitFor(async () => {
			expect((await fixture.read()).map((scene) => scene.title)).toEqual(['A', 'D', 'C', 'B', 'E']);
		});
		expect(notices).not.toHaveBeenCalled();
	});

	it.each([false, true])('follows the scene chosen in Move after (reversed: %s)', async (reversed) => {
		const fixture = await board([0, 1, 2, 3]);
		dropAtEnd(fixture, fixture.card(fixture.original[0]!.sceneId));
		await vi.waitFor(() => expect(fixture.host.reorderScene).toHaveBeenCalledOnce());
		fixture.memory.reversed = reversed;
		fixture.handle.refresh();
		chooseMenu(fixture.card(fixture.original[1]!.sceneId), 'table.moveAfter');
		const modal = opened[0] as {
			getItems(): { id: string; index: number; label: string }[];
			onChooseItem(item: { id: string; index: number; label: string }): void;
		};
		modal.onChooseItem(modal.getItems().find((item) => item.id === fixture.original[2]!.sceneId)!);
		fixture.handle.dispose();
		fixture.gate.resolve();
		await vi.waitFor(async () => {
			expect((await fixture.read()).map((scene) => scene.title)).toEqual(['C', 'B', 'D', 'A']);
		});
		expect(notices).not.toHaveBeenCalled();
	});

	it('keeps Move to position absolute after an earlier move', async () => {
		const fixture = await board([0, 1, 2, 3]);
		dropAtEnd(fixture, fixture.card(fixture.original[0]!.sceneId));
		await vi.waitFor(() => expect(fixture.host.reorderScene).toHaveBeenCalledOnce());
		chooseMenu(fixture.card(fixture.original[1]!.sceneId), 'table.moveToPosition');
		const modal = opened[0] as { submitHandler(position: number): Promise<void> };
		const moving = modal.submitHandler(2);
		fixture.gate.resolve();
		await moving;
		expect((await fixture.read()).map((scene) => scene.title)).toEqual(['C', 'D', 'B', 'A']);
		expect(fixture.host.reorderScene).toHaveBeenLastCalledWith(
			fixture.original[1]!.sceneId, 2, fixture.project.projectFile, expect.any(Function),
		);
		expect(notices).not.toHaveBeenCalled();
	});
});

describe('corkboard insertions queued behind rank writes', () => {
	it.each([
		{ route: 'before', reversed: false, expected: ['Inserted', 'B', 'C', 'D', 'A'] },
		{ route: 'after', reversed: false, expected: ['B', 'Inserted', 'C', 'D', 'A'] },
		{ route: 'menu', reversed: false, expected: ['B', 'Inserted', 'C', 'D', 'A'] },
		{ route: 'before', reversed: true, expected: ['D', 'A', 'B', 'Inserted', 'C'] },
		{ route: 'after', reversed: true, expected: ['D', 'A', 'Inserted', 'B', 'C'] },
		{ route: 'menu', reversed: true, expected: ['D', 'A', 'Inserted', 'B', 'C'] },
	])('keeps the clicked anchor for $route insertion (reversed: $reversed)', async ({ route, reversed, expected }) => {
		const fixture = await board([0, 1, 2, 3]);
		fixture.memory.reversed = reversed;
		fixture.handle.refresh();
		// Moving A to the narrative end, or D to the start, changes B's index.
		dropAtEnd(fixture, fixture.card(fixture.original[reversed ? 3 : 0]!.sceneId));
		await vi.waitFor(() => expect(fixture.host.reorderScene).toHaveBeenCalledOnce());
		const anchor = fixture.card(fixture.original[1]!.sceneId);
		if (route === 'menu') {
			anchor.querySelector('.snowflake-method-corkboard-more')!.dispatch('click');
			const item = menuEntries.find((candidate) => candidate.title === 'table.insertSceneAfter')!;
			expect(item.disabled).toBe(false);
			item.click();
		} else {
			const button = anchor.querySelector(`.snowflake-method-corkboard-insert-${route}`)!;
			expect(button.classes.has('is-hidden')).toBe(false);
			button.dispatch('click');
		}
		expect(fixture.host.openSceneForm).not.toHaveBeenCalled();
		fixture.gate.resolve();
		await vi.waitFor(async () => {
			expect((await fixture.read()).map((scene) => scene.title)).toEqual(expected);
		});
		expect(fixture.host.openSceneForm).toHaveBeenCalledOnce();
		expect(notices).not.toHaveBeenCalled();
	});

	it('keeps the insertion direction chosen before the queued action starts', async () => {
		const fixture = await board([0, 1, 2, 3]);
		dropAtEnd(fixture, fixture.card(fixture.original[0]!.sceneId));
		await vi.waitFor(() => expect(fixture.host.reorderScene).toHaveBeenCalledOnce());
		fixture.card(fixture.original[1]!.sceneId)
			.querySelector('.snowflake-method-corkboard-insert-after')!.dispatch('click');
		fixture.dom.container.querySelector('.snowflake-method-corkboard-direction')!.dispatch('click');
		expect(fixture.memory.reversed).toBe(true);
		fixture.gate.resolve();
		await vi.waitFor(async () => {
			expect((await fixture.read()).map((scene) => scene.title)).toEqual(['B', 'Inserted', 'C', 'D', 'A']);
		});
		expect(notices).not.toHaveBeenCalled();
	});
});

describe('corkboard edits queued behind rank writes', () => {
	it.each([
		['menu', 'progressStatus'], ['menu', 'color'],
		['drag', 'progressStatus'], ['drag', 'color'],
	] as const)('saves a queued %s %s edit using the rank write revision', async (route, field) => {
		const fixture = await board();
		const first = fixture.original[0]!;
		const card = fixture.card(first.sceneId);
		if (route === 'menu') moveDown(card);
		else dropAtEnd(fixture, card);
		await vi.waitFor(() => expect(fixture.host.reorderScene).toHaveBeenCalledOnce());
		edit(card, field);
		expect(fixture.host.patchScene).not.toHaveBeenCalled();
		fixture.gate.resolve();
		await vi.waitFor(async () => {
			const saved = (await fixture.read()).find((scene) => scene.sceneId === first.sceneId)!;
			expect(saved[field]).toBe(field === 'color' ? 'macaron-2' : 'complete');
		});
		expect((await fixture.read()).map((scene) => scene.title)).toEqual(['B', 'A']);
		expect(fixture.transitions).toHaveLength(1);
		expect(fixture.transitions[0]!.before).toBe(first.revision);
		expect(fixture.host.patchScene.mock.calls[0]![1].expectedRevision).toBe(fixture.transitions[0]!.after);
		expect(notices).not.toHaveBeenCalled();
	});

	it.each(['before', 'after'] as const)('rejects a stale queued edit when external content arrives %s the atomic rank write', async (timing) => {
		const fixture = await board();
		const first = fixture.original[0]!;
		const card = fixture.card(first.sceneId);
		const process = fixture.fakeVault.process.bind(fixture.fakeVault);
		let injected = false;
		vi.spyOn(fixture.fakeVault, 'process').mockImplementation(async (file, update) => {
			if (file.path !== first.path || injected) return process(file, update);
			injected = true;
			const externalEdit = (): void => {
				fixture.fakeVault.write(file.path, `${fixture.fakeVault.contents.get(file.path)!}\nExternal prose.\n`);
			};
			if (timing === 'before') externalEdit();
			const written = await process(file, update);
			if (timing === 'after') externalEdit();
			return written;
		});
		moveDown(card);
		await vi.waitFor(() => expect(fixture.host.reorderScene).toHaveBeenCalledOnce());
		edit(card, 'progressStatus');
		fixture.gate.resolve();
		await vi.waitFor(() => expect(notices).toHaveBeenCalledOnce());
		const saved = (await fixture.read()).find((scene) => scene.sceneId === first.sceneId)!;
		expect(injected).toBe(true);
		expect(saved.progressStatus).toBe(first.progressStatus);
		expect(fixture.fakeVault.contents.get(first.path)).toContain('External prose.');
		expect(fixture.host.patchScene).toHaveBeenCalledOnce();
		expect(fixture.host.patchScene.mock.calls[0]![1].expectedRevision).toBe(
			timing === 'before' ? first.revision : fixture.transitions[0]!.after,
		);
	});

	it('advances a queued edit on another card when the reorder normalizes its rank', async () => {
		const fixture = await board([1, 2, 3]);
		const [first, second] = fixture.original;
		moveDown(fixture.card(first!.sceneId));
		await vi.waitFor(() => expect(fixture.host.reorderScene).toHaveBeenCalledOnce());
		edit(fixture.card(second!.sceneId), 'color');
		fixture.gate.resolve();
		await vi.waitFor(async () => {
			expect((await fixture.read()).find((scene) => scene.sceneId === second!.sceneId)!.color).toBe('macaron-2');
		});
		expect(fixture.transitions.map((change) => change.id).sort())
			.toEqual(fixture.original.map((scene) => scene.sceneId).sort());
		expect((await fixture.read()).map((scene) => scene.title)).toEqual(['B', 'A', 'C']);
		expect(notices).not.toHaveBeenCalled();
	});

	it('keeps the rank revision for an edit made after a card remounts from the old model', async () => {
		const fixture = await board();
		const first = fixture.original[0]!;
		const originalCard = fixture.card(first.sceneId);
		const afterRanks = fixture.holdAfterRanks();
		moveDown(originalCard);
		fixture.gate.resolve();
		await vi.waitFor(() => expect(fixture.transitions).toHaveLength(1));
		// A filter can unmount and recreate the card before the reorder's reread.
		fixture.memory.query = 'B';
		fixture.handle.refresh();
		expect(originalCard.isConnected).toBe(false);
		fixture.memory.query = '';
		fixture.handle.refresh();
		const remounted = fixture.card(first.sceneId);
		expect(remounted).not.toBe(originalCard);
		edit(remounted, 'progressStatus');
		afterRanks.resolve();
		await vi.waitFor(async () => {
			expect((await fixture.read()).find((scene) => scene.sceneId === first.sceneId)!.progressStatus).toBe('complete');
		});
		expect(fixture.host.patchScene.mock.calls[0]![1].expectedRevision).toBe(fixture.transitions[0]!.after);
		expect(notices).not.toHaveBeenCalled();
	});

	it('completes accepted edits after disposal while their reorder is pending', async () => {
		const fixture = await board();
		const first = fixture.original[0]!;
		const card = fixture.card(first.sceneId);
		moveDown(card);
		await vi.waitFor(() => expect(fixture.host.reorderScene).toHaveBeenCalledOnce());
		edit(card, 'progressStatus');
		edit(card, 'color');
		fixture.handle.dispose();
		fixture.gate.resolve();
		await vi.waitFor(async () => {
			expect((await fixture.read()).find((scene) => scene.sceneId === first.sceneId))
				.toMatchObject({ progressStatus: 'complete', color: 'macaron-2' });
		});
		expect(fixture.host.patchScene).toHaveBeenCalledTimes(2);
		expect(notices).not.toHaveBeenCalled();
	});
});
