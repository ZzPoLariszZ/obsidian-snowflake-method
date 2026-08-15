import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
	BASE_EXCLUDED_COLUMN_KEYS,
	appendBaseColumns,
	baseColumnDisplayNames,
	getProjectBases,
} from '../../src/templates';

const PROJECT_ID = 'project-85200cf4-9b68-40e9-a316-ead8ed859365';

const CATEGORY_PATH = 'Snowflake Projects/Novel/60_Worldbuilding/Category';
const ROLES = {
	major: `[[${CATEGORY_PATH}#Major|Character/Major]]`,
	supporting: `[[${CATEGORY_PATH}#Supporting|Character/Supporting]]`,
	minor: `[[${CATEGORY_PATH}#Minor|Character/Minor]]`,
};

type BaseId = 'characters' | 'scenes' | 'time' | 'location' | 'item';
type BaseFilter = string | { or: string[] };

const BUILT_IN_KINDS = (['time', 'location', 'item'] as const).map((id) => ({
	id,
	folderName: `6${['time', 'location', 'item'].indexOf(id) + 1}_${id}`,
	custom: false,
	missingFolder: false,
	icon: null,
	description: null,
}));

function baseFor(id: BaseId, language: 'en' | 'zh-CN' = 'en') {
	const base = getProjectBases(PROJECT_ID, language, ROLES, BUILT_IN_KINDS).find(
		(candidate) => candidate.id === id,
	);
	if (!base) throw new Error(`Missing generated base: ${id}`);
	return base;
}

function parsed(id: BaseId, language: 'en' | 'zh-CN' = 'en') {
	return parse(baseFor(id, language).content) as {
		filters: { and: BaseFilter[] };
		formulas: Record<string, string>;
		properties: Record<string, { displayName: string }>;
		views: {
			name: string;
			order: string[];
			sort: { property: string; direction: string }[];
			groupBy?: { property: string };
			filters?: { and: BaseFilter[] };
		}[];
	};
}

describe('project base templates', () => {
	it('localizes every generated filename', () => {
		expect(
			getProjectBases(PROJECT_ID, 'en', ROLES, BUILT_IN_KINDS).map(({ fileName }) => fileName),
		).toEqual([
			'Characters.base',
			'Scenes.base',
			'Time.base',
			'Location.base',
			'Item.base',
		]);
		expect(
			getProjectBases(PROJECT_ID, 'zh-CN', ROLES, BUILT_IN_KINDS).map(
				({ fileName }) => fileName,
			),
		).toEqual([
			'角色总览.base',
			'场景总览.base',
			'时间总览.base',
			'地点总览.base',
			'物品总览.base',
		]);
	});

	it('names each base after the folder it belongs in', () => {
		expect(getProjectBases(PROJECT_ID, 'en', ROLES, BUILT_IN_KINDS).map(({ id }) => id)).toEqual([
			'characters',
			'scenes',
			'time',
			'location',
			'item',
		]);
	});

	it('scopes every base to one project by id rather than by folder', () => {
		for (const id of ['characters', 'scenes', 'time', 'location', 'item'] as const) {
			expect(parsed(id).filters.and).toContain(
				`note["snowflake-project-id"] == "${PROJECT_ID}"`,
			);
			expect(JSON.stringify(parsed(id).filters.and)).not.toContain('inFolder');
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
		for (const id of ['characters', 'scenes', 'time', 'location', 'item'] as const) {
			const formula =
				id === 'characters'
					? 'formula.character'
					: id === 'scenes'
						? 'formula.scene'
						: 'formula.entity';
			for (const view of parsed(id).views) {
				expect(view.order[0]).toBe(formula);
			}
		}
	});

	it('sorts every view by the rank the dashboard maintains', () => {
		for (const id of ['characters', 'scenes', 'time', 'location', 'item'] as const) {
			for (const view of parsed(id).views) {
				expect(view.sort).toEqual([
					{ property: 'snowflake-rank', direction: 'ASC' },
				]);
			}
		}
	});

	it('keeps rank and identity out of the editable columns', () => {
		for (const id of ['characters', 'scenes', 'time', 'location', 'item'] as const) {
			for (const view of parsed(id).views) {
				expect(view.order).not.toContain('snowflake-rank');
				expect(view.order).not.toContain('snowflake-character-id');
				expect(view.order).not.toContain('snowflake-scene-id');
				expect(view.order).not.toContain('snowflake-entity-id');
				expect(view.order).not.toContain('snowflake-worldbuilding-kind');
			}
		}
	});

	it('never repeats a column within one view', () => {
		for (const id of ['characters', 'scenes', 'time', 'location', 'item'] as const) {
			for (const view of parsed(id).views) {
				expect(new Set(view.order).size).toBe(view.order.length);
			}
		}
	});

	it('reads the role from the category links first, the legacy key second', () => {
		const formula = parsed('characters', 'zh-CN').formulas['character_type'];
		// The category links decide when the property exists at all.
		expect(formula).toContain(`note["snowflake-category"].contains(${JSON.stringify(ROLES.major)})`);
		expect(formula).toContain('"主角"');
		// The legacy key is the fallthrough for unmigrated notes.
		expect(formula).toContain('note["snowflake-character-type"] == "major"');
		expect(parsed('characters').formulas['character_type']).toContain('"Major"');
		for (const language of ['en', 'zh-CN'] as const) {
			const views = parsed('characters', language).views;
			// The role heads the groups; it has no column of its own.
			expect(views[1]?.groupBy?.property).toBe('formula.character_type');
			expect(views[1]?.order).not.toContain('formula.character_type');
			expect(views[1]?.order).not.toContain('snowflake-character-type');
			// The major sheet lists a role stored either way.
			expect(views[0]?.filters?.and).toEqual([
				{
					or: [
						`note["snowflake-category"].contains(${JSON.stringify(ROLES.major)})`,
						'note["snowflake-character-type"] == "major"',
					],
				},
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
			'formula.pov',
			'snowflake-scene-location',
		]);
	});

	it('shows the narrative modes of the point of view in the project language', () => {
		// A character link falls through unchanged and still opens the note.
		expect(parsed('scenes', 'zh-CN').formulas['pov']).toBe(
			'if(note["snowflake-pov"] == "omniscient", "全知视角", ' +
				'if(note["snowflake-pov"] == "multiple", "多人视角", ' +
				'note["snowflake-pov"]))',
		);
		expect(parsed('scenes').formulas['pov']).toContain('"Omniscient"');
		for (const view of parsed('scenes').views) {
			expect(view.order).not.toContain('snowflake-pov');
		}
	});

	it('reads a character row as who they are, the story, then the progress', () => {
		// Both views carry the same columns in the same order: the sheet is the
		// major characters of the list beside it, not a different table.
		for (const view of parsed('characters').views) {
			expect(view.order).toEqual([
				'formula.character',
				'aliases',
				'snowflake-category',
				'snowflake-one-sentence-storyline',
				'snowflake-motivation',
				'snowflake-goal',
				'snowflake-conflict',
				'snowflake-growth',
				'snowflake-progress-status',
			]);
		}
	});

	it('never grows a column for the character type it replaced', () => {
		// A note the migration has not reached still carries the legacy key, and
		// the category column is where its role reads now.
		expect(BASE_EXCLUDED_COLUMN_KEYS.has('snowflake-character-type')).toBe(true);
		expect(baseColumnDisplayNames('en').has('snowflake-character-type')).toBe(
			false,
		);
	});

	it('lists the universal columns on every member view', () => {
		for (const id of ['characters', 'scenes', 'time', 'location', 'item'] as const) {
			for (const view of parsed(id).views) {
				expect(view.order).toContain('snowflake-category');
			}
		}
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

	it('lists the scene conflict now that it lives in the frontmatter', () => {
		expect(parsed('scenes').views[0]?.order).toContain('snowflake-conflict');
		expect(
			parsed('scenes', 'zh-CN').properties['note.snowflake-conflict']
				?.displayName,
		).toBe('冲突');
		// The cast stays ahead of the conflict, matching the overview block.
		const order = parsed('scenes').views[0]?.order ?? [];
		expect(order.indexOf('snowflake-scene-characters')).toBeLessThan(
			order.indexOf('snowflake-conflict'),
		);
	});

	it('reads a scene row as what it is, the story, then the progress', () => {
		expect(parsed('scenes').views[0]?.order).toEqual([
			'formula.scene',
			'aliases',
			'snowflake-category',
			'formula.pov',
			'snowflake-scene-time',
			'snowflake-scene-location',
			'snowflake-scene-characters',
			'snowflake-conflict',
			'snowflake-progress-status',
		]);
		// The grouped views drop the column they group by and keep the rest in
		// the same order.
		expect(parsed('scenes').views[1]?.order).toEqual(
			(parsed('scenes').views[0]?.order ?? []).filter(
				(column) => column !== 'formula.pov',
			),
		);
	});

	it('heads both member bases with a plain name', () => {
		// A scene column headed "Scene name" said twice what the base says once.
		expect(
			parsed('scenes').properties['formula.scene']?.displayName,
		).toBe('Name');
		expect(
			parsed('scenes', 'zh-CN').properties['formula.scene']?.displayName,
		).toBe('名称');
	});
});

describe('worldbuilding kind bases', () => {
	it('filters each base to one kind of one project', () => {
		for (const kind of ['time', 'location', 'item'] as const) {
			expect(parsed(kind).filters.and).toEqual([
				'note["snowflake-document"] == "worldbuilding"',
				`note["snowflake-project-id"] == "${PROJECT_ID}"`,
				`note["snowflake-worldbuilding-kind"] == "${kind}"`,
			]);
		}
	});

	it('links each row through the stored entity name', () => {
		expect(parsed('location').formulas['entity']).toBe(
			'if(note["snowflake-name"], file.asLink(note["snowflake-name"]), file.asLink())',
		);
	});

	it('localizes the progress status column and defaults it to not started', () => {
		const formula = parsed('item', 'zh-CN').formulas['status'];
		expect(formula).toContain('"进行中"');
		expect(formula).toContain('"已完成"');
		// A missing status reads as not started, an unknown one shows itself.
		expect(formula).toContain('"未开始"');
		expect(formula).toContain('note["snowflake-progress-status"], note["snowflake-progress-status"]');
	});

	it('gives only the time base its kind formula and grouped view', () => {
		const time = parsed('time', 'zh-CN');
		expect(time.formulas['time_kind']).toContain('"时间段"');
		expect(time.views.map(({ name }) => name)).toEqual(['时间列表', '按类型']);
		expect(time.views[0]?.order).toContain('snowflake-time-start');
		expect(time.views[1]?.groupBy?.property).toBe('formula.time_kind');
		for (const kind of ['location', 'item'] as const) {
			const document = parsed(kind);
			expect(document.formulas['time_kind']).toBeUndefined();
			expect(document.views).toHaveLength(1);
			expect(document.views[0]?.order).not.toContain('snowflake-time-start');
		}
	});

	it('reads an entry as what it is, then how far along it is', () => {
		for (const kind of ['time', 'location', 'item'] as const) {
			const order = parsed(kind).views[0]?.order ?? [];
			expect(order[0]).toBe('formula.entity');
			expect(order[1]).toBe('aliases');
			expect(order[2]).toBe('snowflake-category');
			// The description is the last of the entry's own fields, and the
			// progress closes the row the way it does everywhere else.
			expect(order[order.length - 2]).toBe('snowflake-description');
			expect(order[order.length - 1]).toBe('formula.status');
		}
	});
});

describe('appendBaseColumns', () => {
	const base = () => baseFor('scenes').content;

	it('appends an unreferenced property to every view and names it', () => {
		const { content, added } = appendBaseColumns(base(), [
			{ key: 'status', displayName: 'Status' },
		]);
		expect(added).toEqual(['note.status']);
		const document = parse(content) as ReturnType<typeof parsed>;
		for (const view of document.views) {
			expect(view.order[view.order.length - 1]).toBe('note.status');
		}
		expect(document.properties['note.status']?.displayName).toBe('Status');
	});

	it('leaves a key alone once the base references it in either form', () => {
		expect(
			appendBaseColumns(base(), [{ key: 'snowflake-conflict' }]).added,
		).toEqual([]);
		const withNoteForm = appendBaseColumns(base(), [
			{ key: 'status', displayName: 'Status' },
		]).content;
		expect(appendBaseColumns(withNoteForm, [{ key: 'status' }]).added).toEqual(
			[],
		);
	});

	it('respects an author who removed a column from one view only', () => {
		const trimmed = base().replace('      - snowflake-conflict\n', '');
		expect(parse(trimmed)).toBeTruthy();
		expect(
			appendBaseColumns(trimmed, [{ key: 'snowflake-conflict' }]).added,
		).toEqual([]);
	});

	it('keeps the untouched document byte for byte when nothing is added', () => {
		const before = base();
		expect(appendBaseColumns(before, [{ key: 'snowflake-pov' }]).content).toBe(
			before,
		);
	});

	it('adds nothing to a file it cannot parse', () => {
		expect(appendBaseColumns(':\nbroken', [{ key: 'status' }]).added).toEqual(
			[],
		);
	});

	it('preserves filters, formulas and sorts through the rewrite', () => {
		const { content } = appendBaseColumns(base(), [
			{ key: 'status', displayName: 'Status' },
		]);
		const document = parse(content) as ReturnType<typeof parsed>;
		const original = parsed('scenes');
		expect(document.filters).toEqual(original.filters);
		expect(document.formulas).toEqual(original.formulas);
		expect(document.views.map((view) => view.sort)).toEqual(
			original.views.map((view) => view.sort),
		);
	});
});
