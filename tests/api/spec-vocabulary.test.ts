import { describe, expect, it } from 'vitest';

import { STEP_NAMES } from '../../api/dto/project';
import { isJsonObject, type JsonValue } from '../../api/json';
import { resolveRef } from '../../api/spec/document';
import { PROJECT_LANGUAGES, STEP_IDS, STEP_SECTION_IDS, STEP_STATUSES } from '../../src/domain';
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

	it('promise the folders every project has and leave room for the ones a tool makes when it is first used', () => {
		const folders = property('Project', 'folders');
		const always = PROJECT_DIRECTORY_KEYS.filter((key) => !ON_DEMAND_DIRECTORY_KEYS.has(key));
		expect(listed(folders['required'])).toEqual(always);
		expect(Object.keys(isJsonObject(folders['properties']) ? folders['properties'] : {})).toEqual(always);
		expect(folders['additionalProperties']).toEqual({ type: 'string' });
	});
});
