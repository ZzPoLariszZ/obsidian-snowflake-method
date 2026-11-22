import { describe, expect, it } from 'vitest';

import { STEP_NAMES } from '../../api/dto/project';
import { isJsonObject, type JsonValue } from '../../api/json';
import { resolveRef } from '../../api/spec/document';
import {
	CHARACTER_TYPES,
	DEFINITION_FILE_IDS,
	MACARON_COLORS,
	PROGRESS_STATUSES,
	PROJECT_LANGUAGES,
	STEP_IDS,
	STEP_SECTION_IDS,
	STEP_STATUSES,
	TIME_KINDS,
} from '../../src/domain';
import { ON_DEMAND_DIRECTORY_KEYS, PROJECT_DIRECTORY_KEYS } from '../../src/services';
import { document, textOf } from './helpers/spec';

const schema = (name: string) => resolveRef(document, `#/components/schemas/${name}`);
const listed = (value: JsonValue | undefined): JsonValue[] => (Array.isArray(value) ? value : []);
const property = (name: string, key: string) => {
	const properties = schema(name)['properties'];
	const found = isJsonObject(properties) ? properties[key] : undefined;
	if (!isJsonObject(found)) throw new Error(`${name} has no property ${key}.`);
	return found;
};

/**
 * The words the contract lists, held against the plugin's own lists. A
 * value the plugin can write and the contract does not list would be
 * refused on its way out by any caller that checks, and one the contract
 * lists and the plugin does not know would be accepted and then fail.
 */
describe('the contract’s listed values', () => {
	it('name every language a project can be written in, in the plugin’s order', () => {
		expect(listed(schema('Language')['enum'])).toEqual([...PROJECT_LANGUAGES]);
	});

	it('name every status a step can have', () => {
		expect(listed(schema('StepStatus')['enum'])).toEqual([...STEP_STATUSES]);
	});

	it('name every step by what it produces', () => {
		expect(listed(property('Step', 'name')['enum'])).toEqual(STEP_IDS.map((id) => STEP_NAMES[id]));
	});

	it('name the steps that are written in a note of their own', () => {
		expect(listed(property('StepText', 'step')['enum'])).toEqual(Object.keys(STEP_SECTION_IDS).map(Number));
		const told = textOf(property('StepText', 'sections')['description']);
		for (const ids of Object.values(STEP_SECTION_IDS)) {
			// Each section a caller may meet is named in the words that describe them, the numbered ones by their first and last.
			for (const id of ids) {
				if (/^candidate-title-[2-5]$/u.test(id)) continue;
				expect(told, id).toContain(`\`${id}\``);
			}
		}
	});

	it('name every progress, role, tint and vocabulary a note can have', () => {
		expect(listed(schema('ProgressStatus')['enum'])).toEqual([...PROGRESS_STATUSES]);
		expect(listed(schema('CharacterRole')['enum'])).toEqual([...CHARACTER_TYPES]);
		expect(listed(schema('Color')['enum'])).toEqual([...MACARON_COLORS]);
		expect(listed(schema('VocabularyId')['enum'])).toEqual([...DEFINITION_FILE_IDS]);
	});

	it('name every way a record line can point at a note, and the two ways a time can be', () => {
		const forms = listed(schema('RecordClause')['oneOf']);
		const kinds = forms.flatMap((form) => {
			const properties = isJsonObject(form) ? form['properties'] : undefined;
			const kind = isJsonObject(properties) ? properties['kind'] : undefined;
			if (!isJsonObject(kind)) return [];
			return kind['const'] === undefined ? listed(kind['enum']) : [kind['const']];
		});
		// The four the plugin writes, and the older span it still reads.
		expect(kinds).toEqual(['target', 'at', 'when', 'with', 'span']);
		const time = listed(schema('EntityTime')['oneOf']).find((form) => isJsonObject(form) && form['type'] === 'object');
		const properties = isJsonObject(time) ? time['properties'] : undefined;
		const kind = isJsonObject(properties) ? properties['kind'] : undefined;
		expect(listed(isJsonObject(kind) ? kind['enum'] : undefined)).toEqual([...TIME_KINDS, null]);
	});

	it('promise the folders every project has and leave room for the ones a tool makes when it is first used', () => {
		const folders = property('Project', 'folders');
		const always = PROJECT_DIRECTORY_KEYS.filter((key) => !ON_DEMAND_DIRECTORY_KEYS.has(key));
		expect(listed(folders['required'])).toEqual(always);
		expect(Object.keys(isJsonObject(folders['properties']) ? folders['properties'] : {})).toEqual(always);
		expect(folders['additionalProperties']).toEqual({ type: 'string' });
	});
});
