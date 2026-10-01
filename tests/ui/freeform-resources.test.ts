import { describe, expect, it } from 'vitest';

import type { FreeformPlacement, FreeformResource, Task } from '../../src/domain';
import type { StickyNoteRecord } from '../../src/services';
import type { ForeshadowingTableItem } from '../../src/ui/foreshadowing-rows';
import {
	freeformFileExtension,
	freeformFileKind,
	freeformFileName,
	freeformLabelOf,
	freeformLinkHost,
	resolvePlacement,
	type FreeformFileReading,
	type FreeformResources,
} from '../../src/ui/freeform-resources';
import type { RevisionRow } from '../../src/ui/revision-panel';
import type {
	CharacterViewModel,
	ProjectDashboardModel,
	SceneViewModel,
	WorldbuildingEntityViewModel,
} from '../../src/ui/view-model';

const placed = (resource: FreeformResource, id = 'p1'): FreeformPlacement => ({
	id, resource, x: 0, y: 0, width: 100, height: 60, displayMode: 'auto', zIndex: 0, frameId: null,
});

const character = { id: 'character-1', name: 'Ada', path: 'Cast/Ada.md' } as CharacterViewModel;
const scenes = [
	{ id: 'scene-1', title: 'Arrival', path: 'Scenes/Arrival.md' },
	{ id: 'scene-2', title: 'Storm', path: 'Scenes/Storm.md' },
] as SceneViewModel[];
const harbour = { id: 'entity-1', name: 'Harbour', kind: 'location' } as WorldbuildingEntityViewModel;
const guild = { id: 'entity-2', name: 'Guild', kind: 'Faction' } as WorldbuildingEntityViewModel;

const model = {
	path: 'P',
	characters: [character],
	scenes,
	worldbuilding: { location: [harbour], Faction: [guild], time: [], item: [] },
} as unknown as ProjectDashboardModel;

const task = (id: string, archived = false): Task => ({
	id, title: `Task ${id}`, description: '', status: 'todo', priority: 'medium', dueDate: null,
	related: [], archived, createdAt: 1, updatedAt: 1,
});
const thread = { id: 'foreshadowing-1', name: 'The letter', occurrences: [] } as unknown as ForeshadowingTableItem;
const revision = (id: string, original: string, proposed: string): RevisionRow =>
	({ id, original, proposed, path: 'Draft/One.md', title: 'One' }) as unknown as RevisionRow;
const note = (id: string, body: string, archived = false): StickyNoteRecord =>
	({ id, body, archived, path: `Notes/${id}.md` }) as unknown as StickyNoteRecord;
const file = (relativePath: string): FreeformFileReading => ({
	path: `Root/${relativePath}`,
	relativePath,
	name: freeformFileName(relativePath),
	extension: freeformFileExtension(relativePath),
	kind: freeformFileKind(relativePath),
	stamp: '1:1',
});

const read = (overrides: Partial<FreeformResources> = {}): FreeformResources => ({
	projectPath: 'P',
	tasks: [task('task-1'), task('task-2', true)],
	foreshadowing: [thread],
	revisions: [revision('revision-1', 'old words', 'new words'), revision('revision-2', '', 'put in')],
	stickyNotes: [note('sticky-note-1', '\n  First line  \nSecond'), note('sticky-note-2', 'Set aside', true)],
	files: new Map([['80_Material/map.png', file('80_Material/map.png')]]),
	failed: new Set(),
	...overrides,
});

describe('resolvePlacement', () => {
	it('finds an entity by its id alone, whatever kind the placement kept', () => {
		expect(resolvePlacement(placed({ type: 'entity', kind: 'character', id: 'scene-2', name: 'Old' }), model, null))
			.toMatchObject({ type: 'scene', scene: scenes[1], index: 1 });
		expect(resolvePlacement(placed({ type: 'entity', kind: 'scene', id: 'character-1', name: '' }), model, null))
			.toMatchObject({ type: 'character', character });
		expect(resolvePlacement(placed({ type: 'entity', kind: 'location', id: 'entity-1', name: '' }), model, null))
			.toMatchObject({ type: 'worldbuilding', entity: harbour });
		expect(resolvePlacement(placed({ type: 'entity', kind: 'Faction', id: 'entity-2', name: '' }), model, null))
			.toMatchObject({ type: 'worldbuilding', entity: guild });
	});

	it('shows an entity that has gone as missing, under the name and the kind it last went by', () => {
		expect(resolvePlacement(placed({ type: 'entity', kind: 'character', id: 'character-9', name: 'Bea' }), model, read()))
			.toMatchObject({ type: 'missing', of: 'entity', kind: 'character', why: 'gone', name: 'Bea' });
	});

	it('hands a text and a link over as they stand', () => {
		expect(resolvePlacement(placed({ type: 'text', text: 'Who knows?' }), model, null))
			.toMatchObject({ type: 'text', text: 'Who knows?' });
		expect(resolvePlacement(placed({ type: 'link', url: 'https://example.com/a/b?c=1', label: '' }), model, null))
			.toMatchObject({ type: 'link', url: 'https://example.com/a/b?c=1', label: '', host: 'example.com' });
	});

	it('finds a task, a thread, a revision and a sticky note by their ids', () => {
		expect(resolvePlacement(placed({ type: 'task', id: 'task-1', name: '' }), model, read()))
			.toMatchObject({ type: 'task', task: { id: 'task-1' } });
		expect(resolvePlacement(placed({ type: 'foreshadowing', id: 'foreshadowing-1', name: '' }), model, read()))
			.toMatchObject({ type: 'foreshadowing', item: thread });
		expect(resolvePlacement(placed({ type: 'revision', id: 'revision-1', name: '' }), model, read()))
			.toMatchObject({ type: 'revision', row: { id: 'revision-1' } });
		expect(resolvePlacement(placed({ type: 'sticky-note', id: 'sticky-note-1', name: '' }), model, read()))
			.toMatchObject({ type: 'sticky-note', note: { id: 'sticky-note-1' } });
	});

	it('says why a record is not there: gone, set aside, or settled', () => {
		const missing = (resource: FreeformResource) => resolvePlacement(placed(resource), model, read());
		expect(missing({ type: 'task', id: 'task-9', name: 'Lost' }))
			.toMatchObject({ type: 'missing', of: 'task', kind: null, why: 'gone', name: 'Lost' });
		expect(missing({ type: 'task', id: 'task-2', name: 'Shelved' }))
			.toMatchObject({ type: 'missing', of: 'task', why: 'archived', name: 'Shelved' });
		expect(missing({ type: 'foreshadowing', id: 'foreshadowing-9', name: 'A thread' }))
			.toMatchObject({ type: 'missing', of: 'foreshadowing', why: 'gone' });
		// Accepted, rejected or discarded, a revision leaves its file all the same.
		expect(missing({ type: 'revision', id: 'revision-9', name: 'old' }))
			.toMatchObject({ type: 'missing', of: 'revision', why: 'settled', name: 'old' });
		expect(missing({ type: 'sticky-note', id: 'sticky-note-9', name: '' }))
			.toMatchObject({ type: 'missing', of: 'sticky-note', why: 'gone' });
		expect(missing({ type: 'sticky-note', id: 'sticky-note-2', name: 'Set aside' }))
			.toMatchObject({ type: 'missing', of: 'sticky-note', why: 'archived' });
	});

	it('finds a file by the path the placement keeps, and shows one that has gone by its name', () => {
		expect(resolvePlacement(placed({ type: 'file', path: '80_Material/map.png' }), model, read()))
			.toMatchObject({ type: 'file', file: { kind: 'image', name: 'map', extension: 'png' } });
		expect(resolvePlacement(placed({ type: 'file', path: '80_Material/gone.md' }), model, read()))
			.toMatchObject({ type: 'missing', of: 'file', why: 'gone', name: 'gone.md' });
	});

	it('shows nothing as lost while its reading is on the way, or would not read', () => {
		for (const resource of [
			{ type: 'task', id: 'task-1', name: '' },
			{ type: 'foreshadowing', id: 'foreshadowing-1', name: '' },
			{ type: 'revision', id: 'revision-1', name: '' },
			{ type: 'sticky-note', id: 'sticky-note-1', name: '' },
			{ type: 'file', path: '80_Material/map.png' },
		] as FreeformResource[]) {
			expect(resolvePlacement(placed(resource), model, null)).toMatchObject({ type: 'pending', of: resource.type });
			expect(
				resolvePlacement(placed(resource), model, read({
					tasks: null, foreshadowing: null, revisions: null, stickyNotes: null, files: null,
					failed: new Set(['task']),
				})),
			).toMatchObject({ type: 'pending', of: resource.type });
		}
	});

	it('answers from an index made once for a model and once for a reading', () => {
		const counted = { ...model };
		let walks = 0;
		Object.defineProperty(counted, 'scenes', {
			get: () => {
				walks += 1;
				return scenes;
			},
		});
		const reading = read();
		for (let index = 0; index < 50; index += 1) {
			resolvePlacement(placed({ type: 'entity', kind: 'scene', id: 'scene-1', name: '' }), counted, reading);
			resolvePlacement(placed({ type: 'task', id: 'task-1', name: '' }), counted, reading);
		}
		expect(walks).toBe(1);
	});
});

describe('what a resource is called', () => {
	it('names what keeps a name by what it is called now', () => {
		const name = (resource: FreeformResource) => freeformLabelOf(resolvePlacement(placed(resource), model, read()));
		expect(name({ type: 'entity', kind: 'scene', id: 'scene-1', name: 'Old' })).toEqual({ name: 'Arrival', kind: 'scene' });
		expect(name({ type: 'entity', kind: 'scene', id: 'character-1', name: 'Old' })).toEqual({ name: 'Ada', kind: 'character' });
		expect(name({ type: 'entity', kind: 'item', id: 'entity-2', name: '' })).toEqual({ name: 'Guild', kind: 'Faction' });
		expect(name({ type: 'task', id: 'task-1', name: '' })).toEqual({ name: 'Task task-1' });
		expect(name({ type: 'foreshadowing', id: 'foreshadowing-1', name: '' })).toEqual({ name: 'The letter' });
		expect(name({ type: 'revision', id: 'revision-1', name: '' })).toEqual({ name: 'old words' });
		// Words that run long name the revision by their first line, trimmed as a sticky note's are.
		const row = read().revisions![0]!;
		expect(freeformLabelOf({
			type: 'revision',
			placement: placed({ type: 'revision', id: 'revision-1', name: '' }),
			row: { ...row, original: `${'a'.repeat(100)}\nsecond line` },
		})).toEqual({ name: 'a'.repeat(80) });
		// An insertion was made over no words, so it goes by what it puts in.
		expect(name({ type: 'revision', id: 'revision-2', name: '' })).toEqual({ name: 'put in' });
		expect(name({ type: 'sticky-note', id: 'sticky-note-1', name: '' })).toEqual({ name: 'First line' });
		// The marks that draw the words are no part of the name, as the canvas has it.
		const note = read().stickyNotes![0]!;
		expect(freeformLabelOf({
			type: 'sticky-note',
			placement: placed({ type: 'sticky-note', id: note.id, name: '' }),
			note: { ...note, body: '# Remember\nthe tide' },
		})).toEqual({ name: 'Remember' });
	});

	it('names nothing that keeps no name, and never writes a missing one’s last name over', () => {
		const name = (resource: FreeformResource) => freeformLabelOf(resolvePlacement(placed(resource), model, read()));
		expect(name({ type: 'text', text: 'a' })).toBeNull();
		expect(name({ type: 'link', url: 'https://a.b', label: 'A' })).toBeNull();
		expect(name({ type: 'file', path: '80_Material/map.png' })).toBeNull();
		expect(name({ type: 'task', id: 'task-9', name: 'Lost' })).toBeNull();
		expect(freeformLabelOf(resolvePlacement(placed({ type: 'task', id: 'task-1', name: '' }), model, null))).toBeNull();
	});
});

describe('files and links', () => {
	it('reads how a file is shown off its extension, whatever its case', () => {
		expect(freeformFileKind('a/b/Chapter.md')).toBe('markdown');
		expect(freeformFileKind('map.PNG')).toBe('image');
		expect(freeformFileKind('clip.webm')).toBe('video');
		expect(freeformFileKind('theme.mp3')).toBe('audio');
		expect(freeformFileKind('book.pdf')).toBe('pdf');
		expect(freeformFileKind('archive.zip')).toBe('other');
		expect(freeformFileKind('a.dir/README')).toBe('other');
		expect(freeformFileKind('.hidden')).toBe('other');
	});

	it('names a file with no folder and no extension', () => {
		expect(freeformFileName('80_Material/Maps/harbour.v2.png')).toBe('harbour.v2');
		expect(freeformFileName('README')).toBe('README');
		expect(freeformFileName('.hidden')).toBe('.hidden');
		expect(freeformFileExtension('80_Material/Maps/harbour.v2.PNG')).toBe('png');
		expect(freeformFileExtension('README')).toBe('');
	});

	it('reads the host a link leads to', () => {
		expect(freeformLinkHost('https://en.wikipedia.org/wiki/Snowflake#History')).toBe('en.wikipedia.org');
		expect(freeformLinkHost('http://localhost:8080')).toBe('localhost:8080');
		expect(freeformLinkHost('not an address')).toBe('not an address');
	});
});
