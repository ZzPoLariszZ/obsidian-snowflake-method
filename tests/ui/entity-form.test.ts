import { describe, expect, it } from 'vitest';

import type { ProjectWorldbuildingKind } from '../../src/domain';
import {
	clauseForGroup,
	entityGroupLabel,
	entityGroupsOf,
	noteFieldOptions,
	noteIdentity,
} from '../../src/ui/entity-form';
import { unpickedOptions } from '../../src/ui/option-picker';

/**
 * A note field lists the project's notes by file path and holds them as links,
 * which name the same note two ways. Everything here is about the two ways
 * meeting: where they do not, a picked note shows as a path and stays on the
 * list to be picked again.
 */
const notes = [
	{ value: 'Novel/61_Time/Year 1023.md', label: 'Year 1023' },
	{ value: 'Novel/61_Time/The Regency.md', label: 'The Regency' },
];

/** A Vault holding exactly the notes above, however a link spells them. */
const leadsSomewhere = (path: string): boolean =>
	notes.some((note) => note.value.replace(/\.md$/u, '').endsWith(path));

describe('note field options', () => {
	it('knows a stored link and a listed note as the same note', () => {
		const held = ['[[Novel/61_Time/Year 1023|Year 1023]]'];
		const options = noteFieldOptions(notes, held, leadsSomewhere);
		expect(options.map((option) => option.value)).toEqual([
			'Novel/61_Time/Year 1023',
			'Novel/61_Time/The Regency',
		]);
		// Named by the note, never by where the note is filed.
		expect(options[0]?.label).toBe('Year 1023');
		expect(
			unpickedOptions(options, held.map(noteIdentity)).map(
				(option) => option.label,
			),
		).toEqual(['The Regency']);
	});

	it('carries words the project has no note for', () => {
		const held = ['Three days after the funeral'];
		const options = noteFieldOptions(notes, held, leadsSomewhere);
		expect(options).toHaveLength(3);
		// Words are what an author wrote, not a link that broke, so the field
		// carries them without marking them.
		expect(options[2]).toEqual({
			value: 'Three days after the funeral',
			label: 'Three days after the funeral',
			missing: false,
		});
		expect(
			unpickedOptions(options, held.map(noteIdentity)),
		).toHaveLength(2);
	});

	it('reads a link with no display name by its file name', () => {
		expect(noteIdentity('[[Novel/61_Time/Year 1023]]')).toBe(
			'Novel/61_Time/Year 1023',
		);
		// A link the project cannot place is a note that has gone: kept, so an
		// edit never drops it silently, and marked, so it reads as one to settle.
		expect(noteFieldOptions([], ['[[Novel/61_Time/Year 1023]]'], () => false)).toEqual([
			{ value: 'Novel/61_Time/Year 1023', label: 'Year 1023', missing: true },
		]);
		expect(
			noteFieldOptions(notes, ['[[Novel/61_Time/Year 1023|Year 1023]]'], leadsSomewhere),
		).toEqual(notes.map((note) => ({ ...note, value: note.value.replace(/\.md$/u, '') })));
	});

	it('does not call a shortened link missing when it still leads somewhere', () => {
		// Obsidian shortens the links it writes, so what a link resolves to is
		// the only honest answer to whether the note is still there.
		const options = noteFieldOptions([], ['[[Year 1023|Year 1023]]'], leadsSomewhere);
		expect(options).toEqual([
			{ value: 'Year 1023', label: 'Year 1023', missing: false },
		]);
	});

	it('offers nothing for a field holding nothing', () => {
		expect(noteFieldOptions([], [''], () => false)).toEqual([]);
	});
});

/**
 * The groups a record can point into are the project's own: the built-ins in
 * their fixed order, then every registered kind as a group of its own. A
 * custom kind missing from this list is a note nothing can point at.
 */
describe('entity groups', () => {
	const kind = (
		id: string,
		custom = true,
	): ProjectWorldbuildingKind => ({
		id,
		folderName: custom ? `64_${id}` : `61_${id}`,
		custom,
		missingFolder: false,
		icon: null,
		description: null,
	});

	it('lists registered kinds beside the built-ins, time split in two', () => {
		expect(
			entityGroupsOf([
				kind('time', false),
				kind('location', false),
				kind('item', false),
				kind('Faction'),
			]),
		).toEqual([
			'character',
			'scene',
			'time-point',
			'time-period',
			'location',
			'item',
			'Faction',
		]);
	});

	it('writes a custom-kind reference with the plain connector', () => {
		expect(clauseForGroup('Faction')).toBe('with');
		expect(clauseForGroup('location')).toBe('at');
		expect(clauseForGroup('time-point')).toBe('when');
		expect(clauseForGroup('time-period')).toBe('when');
		expect(clauseForGroup('character')).toBe('with');
	});

	it('names built-ins from the copy and a custom kind by itself', () => {
		const t = (key: string): string => `t:${key}`;
		expect(entityGroupLabel(t, 'location')).toBe('t:form.group.location');
		expect(entityGroupLabel(t, 'Faction')).toBe('Faction');
	});
});
