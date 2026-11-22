import { beforeAll, describe, expect, it } from 'vitest';

import { createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const items = (value: unknown): Body[] => bodyOf(value)['items'] as Body[];

let golden: Golden;
beforeAll(async () => {
	golden = await createGolden();
});

const pid = (): string => golden.project.id;

describe('the kinds of note a project keeps', () => {
	it('are characters, scenes and every kind of worldbuilding, in the author’s order', async () => {
		const reply = await golden.call('listKinds', { projectId: pid() });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(items(reply.body).map((kind) => [kind['id'], kind['group'], kind['builtIn'], kind['count']])).toEqual([
			['character', 'character', true, 2],
			['scene', 'scene', true, 2],
			['time', 'worldbuilding', true, 2],
			['location', 'worldbuilding', true, 1],
			['item', 'worldbuilding', true, 0],
			['Faction', 'worldbuilding', false, 1],
		]);
	});

	it('each say where their notes stand, what they are called and which template their notes begin with', async () => {
		const character = await golden.call('getKind', { projectId: pid(), kindId: 'character' });
		expect(faults(character)).toEqual([]);
		expect(character.body).toEqual({
			id: 'character',
			group: 'character',
			builtIn: true,
			name: 'Character',
			path: 'Snowflake Projects/North Wind/20_Character',
			icon: null,
			description: null,
			hasTimeFields: false,
			defaultFieldTemplate: 'Voice sheet',
			count: 2,
		});
		const time = bodyOf((await golden.call('getKind', { projectId: pid(), kindId: 'time' })).body);
		expect(time).toMatchObject({ name: 'Time', hasTimeFields: true, defaultFieldTemplate: null });
		expect(String(time['path'])).toMatch(/^Snowflake Projects\/North Wind\/\d+_Worldbuilding\/\d+_Time$/u);
		const faction = await golden.call('getKind', { projectId: pid(), kindId: 'Faction' });
		expect(faults(faction)).toEqual([]);
		expect(bodyOf(faction.body)).toMatchObject({
			id: 'Faction',
			builtIn: false,
			name: 'Faction',
			icon: 'flag',
			description: 'Groups with a cause.',
			hasTimeFields: false,
		});
	});

	it('are named in the project’s own language, under ids that stay the same', async () => {
		const reply = await golden.call('listKinds', { projectId: golden.chinese.id });
		expect(faults(reply)).toEqual([]);
		expect(items(reply.body).map((kind) => kind['id'])).toEqual(['character', 'scene', 'time', 'location', 'item']);
		expect(items(reply.body).map((kind) => kind['name'])).not.toContain('Character');
	});

	it('are not found under a name the project does not have', async () => {
		const reply = await golden.call('getKind', { projectId: pid(), kindId: 'Nation' });
		expect([reply.status, bodyOf(reply.body)['code']]).toEqual([404, 'not-found']);
		expect(faults(reply)).toEqual([]);
	});
});

describe('a project’s vocabularies', () => {
	it('are told as one tree for each kind', async () => {
		const reply = await golden.call('getVocabulary', { projectId: pid(), vocabulary: 'category' });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		const trees = bodyOf(reply.body)['trees'] as Body[];
		expect(trees.map((tree) => tree['kind'])).toEqual(['character', 'scene', 'time', 'location', 'item', 'Faction']);
		expect(bodyOf(reply.body)['vocabulary']).toBe('category');
		expect(trees[0]?.['path']).toBe('Snowflake Projects/North Wind/20_Character/21_Category');
	});

	it('list a kind’s words in reading order, each under the word above it', async () => {
		const reply = await golden.call('getVocabularyTree', { projectId: pid(), vocabulary: 'category', kindId: 'character' });
		expect(faults(reply)).toEqual([]);
		const nodes = bodyOf(reply.body)['nodes'] as Body[];
		const paths = nodes.map((node) => node['taxonomyPath']);
		expect(paths).toContain('Guild');
		expect(paths).toContain('Guild/Clockmakers');
		expect(paths.indexOf('Guild')).toBeLessThan(paths.indexOf('Guild/Clockmakers'));
		// The roles a character can have are words of this vocabulary too.
		expect(paths).toEqual(expect.arrayContaining(['Major', 'Supporting', 'Minor']));
		const clockmakers = nodes.find((node) => node['taxonomyPath'] === 'Guild/Clockmakers');
		expect(clockmakers).toEqual({
			taxonomyPath: 'Guild/Clockmakers',
			name: 'Clockmakers',
			depth: 2,
			parent: 'Guild',
			description: 'Keepers of the town clock.',
			path: 'Snowflake Projects/North Wind/20_Character/21_Category/Guild/Clockmakers/Clockmakers.md',
			folderPath: 'Snowflake Projects/North Wind/20_Character/21_Category/Guild/Clockmakers',
			state: 'ok',
			usage: { categorized: 1, labelled: 0 },
		});
		expect(nodes.find((node) => node['taxonomyPath'] === 'Guild')).toMatchObject({ depth: 1, parent: null, usage: { categorized: 0, labelled: 0 } });
	});

	it('count the notes that keep a line under a word', async () => {
		const status = await golden.call('getDefinitionNode', {
			projectId: pid(),
			vocabulary: 'world-status',
			kindId: 'character',
			taxonomyPath: 'Mood/Calm',
		});
		expect(status.status).toBe(200);
		expect(faults(status)).toEqual([]);
		expect(bodyOf(status.body)).toMatchObject({ name: 'Calm', description: 'At ease.', usage: { categorized: 0, labelled: 1 } });
		const sibling = await golden.call('getDefinitionNode', {
			projectId: pid(),
			vocabulary: 'relationship',
			kindId: 'character',
			taxonomyPath: 'family/sibling',
		});
		// Found whatever the case it is asked in, and told as the author spelled it.
		expect(bodyOf(sibling.body)).toMatchObject({ taxonomyPath: 'Family/Sibling', usage: { labelled: 1 } });
	});

	it('are refused under a name that is no vocabulary, and not found for a word or a kind that is not there', async () => {
		expect((await golden.call('getVocabulary', { projectId: pid(), vocabulary: 'tags' })).status).toBe(400);
		const noKind = await golden.call('getVocabularyTree', { projectId: pid(), vocabulary: 'category', kindId: 'Nation' });
		expect(noKind.status).toBe(404);
		const noWord = await golden.call('getDefinitionNode', {
			projectId: pid(),
			vocabulary: 'category',
			kindId: 'character',
			taxonomyPath: 'Guild/Bakers',
		});
		expect([noWord.status, bodyOf(noWord.body)['code']]).toEqual([404, 'not-found']);
		expect(faults(noWord)).toEqual([]);
	});
});

describe('a project’s field templates', () => {
	it('are listed kind by kind, each with whether new notes of its kind begin with it', async () => {
		const reply = await golden.call('listFieldTemplates', { projectId: pid() });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(items(reply.body)).toEqual([
			{
				kind: 'character',
				name: 'Voice sheet',
				description: 'How a character sounds.',
				path: 'Snowflake Projects/North Wind/20_Character/24_Custom_Field/Voice sheet.md',
				default: true,
			},
			{
				kind: 'scene',
				name: 'Beats',
				description: '',
				path: expect.stringMatching(/Custom_Field\/Beats\.md$/u) as unknown,
				default: false,
			},
		]);
		const scenes = await golden.call('listFieldTemplates', { projectId: pid(), kind: 'scene' });
		expect(items(scenes.body).map((template) => template['name'])).toEqual(['Beats']);
		expect((await golden.call('listFieldTemplates', { projectId: pid(), kind: 'Nation' })).status).toBe(400);
	});

	it('each tell their fields and the text each one starts with', async () => {
		const reply = await golden.call('getFieldTemplate', { projectId: pid(), kindId: 'character', templateName: 'Voice sheet' });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(bodyOf(reply.body)).toMatchObject({
			name: 'Voice sheet',
			default: true,
			fields: [
				{ title: 'Voice', content: '' },
				{ title: 'Catchphrase', content: 'None yet.' },
			],
		});
	});

	it('are not found under another kind or another name', async () => {
		const otherKind = await golden.call('getFieldTemplate', { projectId: pid(), kindId: 'scene', templateName: 'Voice sheet' });
		expect(otherKind.status).toBe(404);
		const otherName = await golden.call('getFieldTemplate', { projectId: pid(), kindId: 'character', templateName: 'Nonsense' });
		expect([otherName.status, bodyOf(otherName.body)['code']]).toEqual([404, 'not-found']);
		expect(faults(otherName)).toEqual([]);
	});
});

describe('kinds, vocabularies and templates, read', () => {
	it('leave the vault as it was', async () => {
		const before = vaultState(golden.host);
		await golden.call('listKinds', { projectId: pid() });
		await golden.call('getKind', { projectId: pid(), kindId: 'time' });
		await golden.call('getVocabulary', { projectId: pid(), vocabulary: 'relationship' });
		await golden.call('getVocabularyTree', { projectId: pid(), vocabulary: 'category', kindId: 'scene' });
		await golden.call('listFieldTemplates', { projectId: pid() });
		await golden.call('getFieldTemplate', { projectId: pid(), kindId: 'character', templateName: 'Voice sheet' });
		expect(vaultState(golden.host)).toEqual(before);
	});
});
