import { describe, expect, it } from 'vitest';

import { noteFieldOptions, noteIdentity } from '../../src/ui/entity-form';
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

describe('note field options', () => {
	it('knows a stored link and a listed note as the same note', () => {
		const held = ['[[Novel/61_Time/Year 1023|Year 1023]]'];
		const options = noteFieldOptions(notes, held);
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
		const options = noteFieldOptions(notes, held);
		expect(options).toHaveLength(3);
		expect(options[2]).toEqual({
			value: 'Three days after the funeral',
			label: 'Three days after the funeral',
		});
		expect(
			unpickedOptions(options, held.map(noteIdentity)),
		).toHaveLength(2);
	});

	it('reads a link with no display name by its file name', () => {
		expect(noteIdentity('[[Novel/61_Time/Year 1023]]')).toBe(
			'Novel/61_Time/Year 1023',
		);
		expect(noteFieldOptions([], ['[[Novel/61_Time/Year 1023]]'])).toEqual([
			{ value: 'Novel/61_Time/Year 1023', label: 'Year 1023' },
		]);
	});

	it('offers nothing for a field holding nothing', () => {
		expect(noteFieldOptions([], [''])).toEqual([]);
	});
});
