import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { getProjectBases } from '../../src/templates';

const PROJECT_ID = 'project-85200cf4-9b68-40e9-a316-ead8ed859365';

function baseFor(id: 'characters' | 'scenes', language: 'en' | 'zh-CN' = 'en') {
	const base = getProjectBases(PROJECT_ID, language).find(
		(candidate) => candidate.id === id,
	);
	if (!base) throw new Error(`Missing generated base: ${id}`);
	return base;
}

function parsed(id: 'characters' | 'scenes', language: 'en' | 'zh-CN' = 'en') {
	return parse(baseFor(id, language).content) as {
		filters: { and: string[] };
		formulas: Record<string, string>;
		properties: Record<string, { displayName: string }>;
		views: {
			name: string;
			order: string[];
			sort: { property: string; direction: string }[];
			groupBy?: { property: string };
			filters?: { and: string[] };
		}[];
	};
}

describe('project base templates', () => {
	it('localizes both generated filenames', () => {
		expect(getProjectBases(PROJECT_ID, 'en').map(({ fileName }) => fileName)).toEqual([
			'Characters.base',
			'Scenes.base',
		]);
		expect(getProjectBases(PROJECT_ID, 'zh-CN').map(({ fileName }) => fileName)).toEqual([
			'角色总览.base',
			'场景总览.base',
		]);
	});

	it('names each base after the project directory it belongs in', () => {
		expect(getProjectBases(PROJECT_ID, 'en').map(({ id }) => id)).toEqual([
			'characters',
			'scenes',
		]);
	});

	it('scopes every base to one project by id rather than by folder', () => {
		for (const id of ['characters', 'scenes'] as const) {
			expect(parsed(id).filters.and).toContain(
				`note["snowflake-project-id"] == "${PROJECT_ID}"`,
			);
			expect(parsed(id).filters.and.join('\n')).not.toContain('inFolder');
		}
	});

	it('excludes the system template note from each base', () => {
		expect(parsed('characters').filters.and).toContain(
			`note["snowflake-character-id"] != "${PROJECT_ID}-template-character"`,
		);
		expect(parsed('scenes').filters.and).toContain(
			`note["snowflake-scene-id"] != "${PROJECT_ID}-template-scene"`,
		);
	});

	it('opens each note through a link that displays the stored name', () => {
		expect(parsed('characters').formulas['character']).toBe(
			'if(note["snowflake-character-name"], file.asLink(note["snowflake-character-name"]), file.asLink())',
		);
		expect(parsed('scenes').formulas['scene']).toBe(
			'if(note["snowflake-scene-title"], file.asLink(note["snowflake-scene-title"]), file.asLink())',
		);
	});

	it('leads every view with the link column', () => {
		for (const id of ['characters', 'scenes'] as const) {
			const formula = id === 'characters' ? 'formula.character' : 'formula.scene';
			for (const view of parsed(id).views) {
				expect(view.order[0]).toBe(formula);
			}
		}
	});

	it('sorts every view by the rank the dashboard maintains', () => {
		for (const id of ['characters', 'scenes'] as const) {
			for (const view of parsed(id).views) {
				expect(view.sort).toEqual([
					{ property: 'snowflake-rank', direction: 'ASC' },
				]);
			}
		}
	});

	it('keeps rank and identity out of the editable columns', () => {
		for (const id of ['characters', 'scenes'] as const) {
			for (const view of parsed(id).views) {
				expect(view.order).not.toContain('snowflake-rank');
				expect(view.order).not.toContain('snowflake-character-id');
				expect(view.order).not.toContain('snowflake-scene-id');
			}
		}
	});

	it('never repeats a column within one view', () => {
		for (const id of ['characters', 'scenes'] as const) {
			for (const view of parsed(id).views) {
				expect(new Set(view.order).size).toBe(view.order.length);
			}
		}
	});

	it('shows the character type in the project language', () => {
		// The stored value stays canonical; only the column is translated.
		expect(parsed('characters', 'zh-CN').formulas['character_type']).toBe(
			'if(note["snowflake-character-type"] == "major", "主角", ' +
				'if(note["snowflake-character-type"] == "supporting", "配角", ' +
				'if(note["snowflake-character-type"] == "minor", "次要角色", ' +
				'note["snowflake-character-type"])))',
		);
		expect(parsed('characters').formulas['character_type']).toContain('"Major"');
		for (const language of ['en', 'zh-CN'] as const) {
			const views = parsed('characters', language).views;
			expect(views[1]?.order).toContain('formula.character_type');
			expect(views[1]?.order).not.toContain('snowflake-character-type');
			// The major sheet still filters on the canonical stored value.
			expect(views[0]?.filters?.and).toEqual([
				'note["snowflake-character-type"] == "major"',
			]);
		}
	});

	it('groups a view by character type and by scene viewpoint', () => {
		// Grouping uses the translated column so the group headers localize too.
		expect(
			parsed('characters').views.map((view) => view.groupBy?.property),
		).toEqual([undefined, 'formula.character_type']);
		expect(parsed('scenes').views.map((view) => view.groupBy?.property)).toEqual([
			undefined,
			'snowflake-pov',
			'snowflake-scene-location',
		]);
	});

	it('restricts the major character sheet to major characters', () => {
		const [majorSheet] = parsed('characters').views;

		expect(majorSheet?.filters?.and).toEqual([
			'note["snowflake-character-type"] == "major"',
		]);
	});

	it('localizes view names and column labels', () => {
		expect(parsed('scenes', 'zh-CN').views.map(({ name }) => name)).toEqual([
			'场景列表',
			'按视点人物',
			'按地点',
		]);
		expect(
			parsed('scenes', 'zh-CN').properties['note.snowflake-pov']?.displayName,
		).toBe('视点人物');
	});

	it('writes every expression on a single line', () => {
		for (const id of ['characters', 'scenes'] as const) {
			for (const line of baseFor(id).content.split('\n')) {
				expect(line).not.toMatch(/^\s+"/u);
			}
		}
	});

	it('emits no YAML anchors for the sort clause shared by every view', () => {
		for (const id of ['characters', 'scenes'] as const) {
			expect(baseFor(id).content).not.toMatch(/&\w|\*\w/u);
		}
	});

	it('reads every label back unchanged through a YAML parser', () => {
		// The emitter is hand-written, so quoting has to survive a round trip.
		for (const language of ['en', 'zh-CN'] as const) {
			for (const id of ['characters', 'scenes'] as const) {
				const labels = Object.values(parsed(id, language).properties).map(
					({ displayName }) => displayName,
				);

				expect(labels.every((label) => label.trim() === label)).toBe(true);
				expect(labels).not.toContain('');
				expect(baseFor(id, language).content.endsWith('\n')).toBe(true);
			}
		}
	});
});
