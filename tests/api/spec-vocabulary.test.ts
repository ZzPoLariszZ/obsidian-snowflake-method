import { describe, expect, it } from 'vitest';

import { STEP_NAMES } from '../../api/dto/project';
import { isJsonObject, type JsonValue } from '../../api/json';
import { resolveRef } from '../../api/spec/document';
import {
	BAND_SPANS,
	CHARACTER_TYPES,
	DEFINITION_FILE_IDS,
	DERIVED_TASK_KEYS,
	FORESHADOWING_STATUSES,
	FREEFORM_ARROWS,
	FREEFORM_DISPLAY_MODES,
	FREEFORM_LINES,
	FREEFORM_RECORD_TYPES,
	FREEFORM_SIDES,
	HISTORY_EVENT_ORIGINS,
	HISTORY_NOTE_KINDS,
	HISTORY_SOURCES,
	HISTORY_STEPS,
	MACARON_COLORS,
	OCCURRENCE_ROLES,
	PROGRESS_STATUSES,
	PROJECT_LANGUAGES,
	REVISION_KINDS,
	SCENE_PRESENTATIONS,
	STEP_IDS,
	STEP_SECTION_IDS,
	STEP_STATUSES,
	STICKY_NOTE_COLORS,
	TASK_PRIORITIES,
	TASK_STATUSES,
	TIMELINE_CARD_STYLES,
	TIME_KINDS,
	WRITING_COUNT_HEADINGS,
	WRITING_COUNT_MODES,
	WRITING_MODES,
	WRITING_SESSION_SCOPES,
	WRITING_SESSION_TYPES,
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

	it('name every convention writing can be counted by', () => {
		expect(listed(property('Counting', 'mode')['enum'])).toEqual([...WRITING_COUNT_MODES]);
		expect(listed(property('Counting', 'headings')['enum'])).toEqual([...WRITING_COUNT_HEADINGS]);
	});

	it('name every column and priority a task can have, in the order of the board', () => {
		expect(listed(schema('TaskStatus')['enum'])).toEqual([...TASK_STATUSES]);
		expect(listed(schema('TaskPriority')['enum'])).toEqual([...TASK_PRIORITIES]);
	});

	it('name every way a thread can stand, every part an appearance can play, and every kind of revision', () => {
		expect(listed(schema('ForeshadowingStatus')['enum'])).toEqual([...FORESHADOWING_STATUSES]);
		expect(listed(schema('OccurrenceRole')['enum'])).toEqual([...OCCURRENCE_ROLES]);
		expect(listed(schema('RevisionKind')['enum'])).toEqual([...REVISION_KINDS]);
	});

	it('give a sticky note the tints a scene has', () => {
		expect(property('StickyNote', 'color')).toEqual({ $ref: '#/components/schemas/Color' });
		expect(listed(schema('Color')['enum'])).toEqual([...STICKY_NOTE_COLORS]);
	});

	it('name every scope, stage and type a writing session can have, and every stretch its spread is read over', () => {
		expect(listed(schema('WritingScope')['enum'])).toEqual([...WRITING_SESSION_SCOPES]);
		expect(listed(schema('WritingMode')['enum'])).toEqual([...WRITING_MODES]);
		expect(listed(property('LiveWritingSession', 'type')['enum'])).toEqual([...WRITING_SESSION_TYPES]);
		expect(listed(property('WritingSpread', 'span')['enum'])).toEqual([...BAND_SPANS]);
	});

	it('name every kind of note the history knows, where its words come from and who made a note', () => {
		expect(listed(property('HistoryNote', 'kind')['enum'])).toEqual([...HISTORY_NOTE_KINDS]);
		expect(listed(property('HistoryNote', 'step')['enum'])).toEqual([...HISTORY_STEPS]);
		expect(listed(property('HistoryNoteEntry', 'source')['enum'])).toEqual([...HISTORY_SOURCES]);
		expect(listed(property('HistoryNoteEntry', 'origin')['enum'])).toEqual([...HISTORY_EVENT_ORIGINS]);
	});

	it('name every card the plugin derives, and every way a board shows its scenes and its cards', () => {
		expect(listed(property('DerivedTask', 'key')['enum'])).toEqual([...DERIVED_TASK_KEYS]);
		expect(listed(schema('ScenePresentation')['enum'])).toEqual([...SCENE_PRESENTATIONS]);
		expect(listed(property('TimelineView', 'cardStyle')['enum'])).toEqual([...TIMELINE_CARD_STYLES, null]);
		expect(listed(property('FreeformPlacement', 'displayMode')['enum'])).toEqual([...FREEFORM_DISPLAY_MODES]);
		expect(listed(property('FreeformEdge', 'sourceSide')['enum'])).toEqual([...FREEFORM_SIDES, null]);
		expect(listed(property('FreeformEdge', 'targetSide')['enum'])).toEqual([...FREEFORM_SIDES, null]);
		expect(listed(property('FreeformEdge', 'arrow')['enum'])).toEqual([...FREEFORM_ARROWS]);
		expect(listed(property('FreeformEdge', 'line')['enum'])).toEqual([...FREEFORM_LINES]);
		const records = listed(schema('FreeformResource')['oneOf']).flatMap((form) => {
			const properties = isJsonObject(form) ? form['properties'] : undefined;
			const type = isJsonObject(properties) ? properties['type'] : undefined;
			return isJsonObject(type) ? listed(type['enum']) : [];
		});
		expect(records).toEqual([...FREEFORM_RECORD_TYPES]);
	});

	it('promise the folders every project has and leave room for the ones a tool makes when it is first used', () => {
		const folders = property('Project', 'folders');
		const always = PROJECT_DIRECTORY_KEYS.filter((key) => !ON_DEMAND_DIRECTORY_KEYS.has(key));
		expect(listed(folders['required'])).toEqual(always);
		expect(Object.keys(isJsonObject(folders['properties']) ? folders['properties'] : {})).toEqual(always);
		expect(folders['additionalProperties']).toEqual({ type: 'string' });
	});
});
