import { describe, expect, it } from 'vitest';

import {
	ENTITY_GROUP_FIELDS,
	clearEntityFilters,
	entityFilterRows,
	entityFiltered,
	entityFilters,
	entityGroupFields,
	entityGroupLabel,
	entityGroupValues,
	filterEntities,
	isEntityGroupField,
	reconcileEntityFilters,
} from '../../src/ui/entity-filters';
import type { FilterOptionRow } from '../../src/ui/filter-rows';
import type { CharacterViewModel, WorldbuildingEntityViewModel } from '../../src/ui/view-model';

const t = (key: string, vars?: Record<string, string | number>): string =>
	vars === undefined ? key : `${key}:${JSON.stringify(vars)}`;

const character = (name: string, overrides: Partial<CharacterViewModel> = {}): CharacterViewModel => ({
	id: name, path: `Novel/20_Character/${name}.md`, name, rank: 1024, type: null, progressStatus: null,
	aliases: [], categoryPaths: [], oneSentenceStoryline: '', oneParagraphStoryline: '', motivation: '',
	goal: '', conflict: '', growth: '', color: null, worldStatus: [], relationships: [], customFields: '',
	gallery: [], galleryMain: null, revision: 'r1', readOnly: false, healthIssues: [], ...overrides,
});

const time = (name: string, overrides: Partial<WorldbuildingEntityViewModel> = {}): WorldbuildingEntityViewModel => ({
	id: name, path: `Novel/60_Worldbuilding/61_Time/${name}.md`, name, kind: 'time', rank: 1024, progressStatus: null,
	aliases: [], categoryPaths: [], description: '', timeKind: null, timeStart: '', timeEnd: '',
	timeStartMissing: false, timeEndMissing: false, color: null, worldStatus: [], relationships: [],
	customFields: '', gallery: [], galleryMain: null, revision: 'r1', readOnly: false, healthIssues: [], ...overrides,
});

describe('entity filters', () => {
	it('start unasked, say when a question is asked, and clear in place', () => {
		const filters = entityFilters();
		expect(entityFiltered(filters)).toBe(false);
		filters.role = 'major';
		expect(entityFiltered(filters)).toBe(true);
		clearEntityFilters(filters);
		expect(filters).toEqual(entityFilters());
	});

	it('drop a category the kind no longer has, and keep one it has', () => {
		const filters = { ...entityFilters(), category: 'Race/Elf' };
		reconcileEntityFilters(filters, { definitions: { category: { character: { nodes: [{ taxonomyPath: 'Race/Elf' }] } } } }, 'character');
		expect(filters.category).toBe('Race/Elf');
		reconcileEntityFilters(filters, { definitions: { category: { character: { nodes: [] } } } }, 'character');
		expect(filters.category).toBe('');
	});

	it('narrow by status, category subtree, colour, role and time kind, and search the table\'s fields', () => {
		const members = [
			character('Ada', { type: 'major', progressStatus: 'complete', categoryPaths: ['Race/Elf'], color: 'macaron-1', oneSentenceStoryline: 'Seeks the crown', aliases: ['The Wanderer'] }),
			character('Lin', { type: 'minor', progressStatus: 'not-started', categoryPaths: ['Race/Human/Sailor'] }),
			character('Mo'),
		];
		const shown = (filters: Partial<ReturnType<typeof entityFilters>>, query = ''): string[] =>
			filterEntities(members, query, { ...entityFilters(), ...filters }, t).map((entry) => `${entry.member.name}@${String(entry.index)}`);
		expect(shown({})).toEqual(['Ada@0', 'Lin@1', 'Mo@2']);
		expect(shown({ status: 'complete' })).toEqual(['Ada@0']);
		expect(shown({ category: 'Race' })).toEqual(['Ada@0', 'Lin@1']);
		expect(shown({ category: 'Race/Human' })).toEqual(['Lin@1']);
		expect(shown({ color: 'macaron-1' })).toEqual(['Ada@0']);
		expect(shown({ role: 'minor' })).toEqual(['Lin@1']);
		expect(shown({}, 'wanderer')).toEqual(['Ada@0']);
		expect(shown({}, 'crown')).toEqual(['Ada@0']);
		expect(shown({}, 'status.complete')).toEqual(['Ada@0']);
		expect(shown({}, 'sailor')).toEqual(['Lin@1']);
		const times = [time('Dawn', { timeKind: 'point', description: 'First light' }), time('Spring', { timeKind: 'period' })];
		expect(filterEntities(times, '', { ...entityFilters(), timeKind: 'period' }, t).map((entry) => entry.member.name)).toEqual(['Spring']);
		expect(filterEntities(times, 'light', entityFilters(), t).map((entry) => entry.member.name)).toEqual(['Dawn']);
	});

	it('offer each view its own group fields and labels', () => {
		expect(entityGroupFields('character')).toEqual(['status', 'category', 'role', 'color']);
		expect(entityGroupFields('time')).toEqual(['status', 'category', 'timeKind', 'color']);
		expect(entityGroupFields('location')).toEqual(['status', 'category', 'color']);
		expect(entityGroupFields('faction')).toEqual(['status', 'category', 'color']);
		for (const field of ENTITY_GROUP_FIELDS) expect(isEntityGroupField(field)).toBe(true);
		expect(isEntityGroupField('pov')).toBe(false);
		expect(entityGroupLabel(t, 'role')).toBe('corkboard.group.role');
		expect(entityGroupLabel(t, 'timeKind')).toBe('form.timeKind');
		expect(entityGroupLabel(t, 'color')).toBe('stickyNotes.color');
	});

	it('gather by every field with the field\'s own order', () => {
		const ctx = { t, locale: 'en' as const };
		const ada = character('Ada', { type: 'supporting', progressStatus: 'in-progress', color: 'macaron-3', categoryPaths: ['Race/Elf', 'Guild/Mages'] });
		expect(entityGroupValues(ada, 'role', ctx)).toEqual([{ key: 'supporting', label: 'Supporting', rank: 1 }]);
		expect(entityGroupValues(ada, 'status', ctx)).toEqual([{ key: 'in-progress', label: 'status.in-progress', rank: 1 }]);
		expect(entityGroupValues(ada, 'color', ctx)).toEqual([{ key: 'macaron-3', label: 'stickyNotes.color.macaron-3', rank: 2 }]);
		expect(entityGroupValues(ada, 'category', ctx)).toEqual([
			{ key: 'Race/Elf', label: 'Race/Elf', rank: 0 },
			{ key: 'Guild/Mages', label: 'Guild/Mages', rank: 0 },
		]);
		expect(entityGroupValues(character('Mo'), 'role', ctx)).toEqual([]);
		expect(entityGroupValues(ada, 'timeKind', ctx)).toEqual([]);
		expect(entityGroupValues(time('Spring', { timeKind: 'period' }), 'timeKind', { t, locale: 'zh-CN' })).toEqual([
			{ key: 'period', label: 'form.timeKind.period', rank: 1 },
		]);
		expect(entityGroupValues(ada, 'role', { t, locale: 'zh-CN' })[0]?.label).toBe('配角');
	});

	it('ask the character view about roles, the time view about kinds, and every view about status, category and colour', () => {
		const filters = entityFilters();
		const labels = (kind: string): string[] => entityFilterRows(t, kind, 'en', filters, { categoryPaths: ['Race'] }).map((row) => row.label);
		expect(labels('character')).toEqual(['table.progressStatus', 'table.category', 'corkboard.group.role', 'table.sceneColor']);
		expect(labels('time')).toEqual(['table.progressStatus', 'table.category', 'form.timeKind', 'table.sceneColor']);
		expect(labels('item')).toEqual(['table.progressStatus', 'table.category', 'table.sceneColor']);
		const roleRow = entityFilterRows(t, 'character', 'en', filters, { categoryPaths: [] })[2] as FilterOptionRow;
		expect(roleRow.options().map((option) => option.label)).toEqual(['Major', 'Supporting', 'Minor']);
		roleRow.apply('minor');
		expect(filters.role).toBe('minor');
		roleRow.apply('nobody');
		expect(filters.role).toBe('');
		const kindRow = entityFilterRows(t, 'time', 'en', filters, { categoryPaths: [] })[2] as FilterOptionRow;
		kindRow.apply('period');
		expect(filters.timeKind).toBe('period');
		const colorRow = entityFilterRows(t, 'item', 'en', filters, { categoryPaths: [] })[2] as FilterOptionRow;
		expect(colorRow.presentation).toBe('color-swatches');
		colorRow.apply('macaron-2');
		expect(filters.color).toBe('macaron-2');
		colorRow.apply('plaid');
		expect(filters.color).toBe('');
	});
});
