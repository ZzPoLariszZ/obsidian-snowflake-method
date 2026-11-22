import { beforeAll, describe, expect, it } from 'vitest';

import { createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const items = (value: unknown): Body[] => bodyOf(value)['items'] as Body[];

const ROOT = 'Snowflake Projects/North Wind';
const FOLDER = `${ROOT}/50_Manuscript`;
const noteRef = (title: string): Body => ({ path: `${FOLDER}/${title}.md`, relativePath: `50_Manuscript/${title}.md`, title });
const SECOND = noteRef('Chapter 2');
const THIRD = noteRef('Chapter 3');

/** A third chapter with speech in it, the project's notes named in it, and two words the author watches for. */
const CHAPTER_THREE = [
	'“Ada,” said Ben, “the tower is very cold.”',
	'',
	'Ada climbed. Suddenly The clockmaker stopped.',
	'',
	`"Home," she said. The Guild waited at the [[${ROOT}/60_Worldbuilding/62_Location/Clocktower|Clocktower]].`,
	'',
].join('\n');
const LINK_TEXT = CHAPTER_THREE.lastIndexOf('Clocktower');
const spanOf = (words: string, from = 0): Body => {
	const at = CHAPTER_THREE.indexOf(words, from);
	if (at < 0) throw new Error(`The chapter says "${words}".`);
	return { from: at, to: at + words.length };
};

/** The vault most tests ask about, with the third chapter and a second character who goes by Ada's alias. */
async function createWritten(start: Parameters<typeof createGolden>[0] = {}): Promise<Golden> {
	const made = await createGolden({ sensitiveWords: ['suddenly', 'very'], ...start });
	const service = made.host.projects;
	await service.createCharacter(made.project, { name: 'Old Ada', type: 'minor', aliases: ['The clockmaker'] });
	await service.manuscript.appendSegments(made.project, [{ title: 'Chapter 3', body: CHAPTER_THREE }], { userInput: true });
	return made;
}

let golden: Golden;
beforeAll(async () => {
	golden = await createWritten();
});
const pid = (): string => golden.project.id;
const call = async (operation: string, params: Body = {}): Promise<Body> => {
	const reply = await golden.call(operation, { projectId: pid(), ...params });
	expect([reply.status, faults(reply)], operation).toEqual([200, []]);
	return bodyOf(reply.body);
};

describe('the writing of a project, counted', () => {
	it('says how much the whole project holds and how much of that is the manuscript, by the author’s convention', async () => {
		const counts = await call('getWritingCounts');
		// Three words in the note a project is made with, then seven, eight and twenty-three.
		expect(counts['manuscript']).toMatchObject({ notes: 4, unreadable: 0, count: { total: 41, words: 41, cjkCharacters: 0 } });
		const project = bodyOf(counts['project']);
		expect(project['notes']).toBeGreaterThan(4);
		expect(bodyOf(project['count'])['total']).toBeGreaterThan(41);
		expect(counts['counting']).toEqual({ mode: 'ms-word', headings: 'count' });
	});

	it('is counted by another convention where the author chose one', async () => {
		const other = await createWritten({ counting: { mode: 'jinjiang', headings: 'skip-all' } });
		const reply = await other.call('getWritingCounts', { projectId: other.project.id });
		expect(faults(reply)).toEqual([]);
		const counts = bodyOf(reply.body);
		expect(counts['counting']).toEqual({ mode: 'jinjiang', headings: 'skip-all' });
		// Every character that is not a space, against every word.
		expect(bodyOf(bodyOf(counts['manuscript'])['count'])['total']).toBeGreaterThan(41);
	});
});

describe('the prose statistics', () => {
	it('give every manuscript note its length, its sentences and how much of it is dialogue, and the manuscript the sum', async () => {
		const statistics = await call('getProseStatistics');
		expect(items(statistics).map((row) => [bodyOf(row['note'])['title'], row['total'], row['sentences'], row['dialogueTotal']])).toEqual([
			['Draft', 3, 2, 0],
			['Chapter 1', 7, 2, 0],
			['Chapter 2', 8, 2, 0],
			// One word, five words and one word stand inside quotation marks.
			['Chapter 3', 23, 5, 7],
		]);
		expect(items(statistics)[3]).toEqual({ note: THIRD, total: 23, words: 23, cjkCharacters: 0, sentences: 5, dialogueTotal: 7 });
		expect(statistics).toMatchObject({
			notes: 4,
			manuscript: { total: 41, words: 41, cjkCharacters: 0, sentences: 11, dialogueTotal: 7 },
			counting: { mode: 'ms-word', headings: 'count' },
		});
	});

	it('come a page at a time, with the manuscript’s sum still that of every note', async () => {
		const page = await call('getProseStatistics', { limit: 2, offset: 1 });
		expect(page).toMatchObject({ total: 4, offset: 1, limit: 2, nextOffset: 3, notes: 4, manuscript: { total: 41 } });
		expect(items(page).map((row) => bodyOf(row['note'])['title'])).toEqual(['Chapter 1', 'Chapter 2']);
	});

	it('are read for a project in another language', async () => {
		const reply = await golden.call('getProseStatistics', { projectId: golden.chinese.id });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({ notes: 1, total: 1 });
		expect(bodyOf(bodyOf(items(reply.body)[0])['note'])['relativePath']).toBe('50_正文/初稿.md');
	});
});

describe('the words used most', () => {
	it('come commonest first, without the common words and without the names of the project’s notes', async () => {
		const words = await call('getWordFrequency', { limit: 3 });
		// Three words are used twice. Words used as often come in the order of the alphabet.
		expect(items(words)).toEqual([
			{ term: 'home', count: 2 },
			{ term: 'said', count: 2 },
			{ term: 'stopped', count: 2 },
		]);
		expect(words).toMatchObject({ offset: 0, limit: 3, nextOffset: 3, tokens: 38 });
		const all = items(await call('getWordFrequency')).map((row) => row['term']);
		expect(all).not.toContain('the');
		expect(all).not.toContain('ada');
		expect(all).not.toContain('clocktower');
		expect(all).toHaveLength(words['total'] as number);
	});

	it('keep the common words and the names where each is asked for, the whole staying what it was', async () => {
		const common = await call('getWordFrequency', { includeStopwords: true });
		expect(items(common)[0]).toEqual({ term: 'the', count: 3 });
		expect(items(common).map((row) => row['term'])).not.toContain('ada');
		const named = await call('getWordFrequency', { includeNames: true });
		const count = (term: string): unknown => items(named).find((row) => row['term'] === term)?.['count'];
		expect([count('ada'), count('ben'), count('clocktower'), count('the')]).toEqual([2, 2, 1, undefined]);
		// What is left out changes the list and never the number every share is worked out against.
		expect([common['tokens'], named['tokens']]).toEqual([38, 38]);
		expect(named['total']).toBeGreaterThan((await call('getWordFrequency'))['total'] as number);
	});
});

describe('the words the author watches for', () => {
	it('are given in the order of the author’s list, each with how often the manuscript uses it', async () => {
		const watched = await call('getSensitiveWords');
		expect(watched).toEqual({
			terms: [
				{ term: 'suddenly', total: 1 },
				{ term: 'very', total: 1 },
			],
		});
	});

	it('come with every place where that is asked for, in the letters the manuscript has there', async () => {
		const watched = await call('getSensitiveWords', { include: 'occurrences' });
		expect(watched['terms']).toEqual([
			{ term: 'suddenly', total: 1, occurrences: [{ note: THIRD, range: spanOf('Suddenly'), text: 'Suddenly' }] },
			{ term: 'very', total: 1, occurrences: [{ note: THIRD, range: spanOf('very'), text: 'very' }] },
		]);
		expect((await golden.call('getSensitiveWords', { projectId: pid(), include: 'everything' })).status).toBe(400);
	});

	it('are none where the author keeps no list', async () => {
		const plain = await createGolden();
		const reply = await plain.call('getSensitiveWords', { projectId: plain.project.id, include: 'occurrences' });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(reply.body).toEqual({ terms: [] });
	});
});

describe('the dialogue', () => {
	it('is counted for each manuscript note that holds any, with the quotation marks that were read', async () => {
		const dialogue = await call('getDialogue');
		expect(items(dialogue)).toEqual([{ note: THIRD, count: 3 }]);
		expect(dialogue).toMatchObject({
			total: 1,
			marks: [
				{ open: '“', close: '”' },
				{ open: '"', close: '"' },
			],
		});
	});

	it('is given stretch by stretch for one note, marks included, with where each stands', async () => {
		const stretches = await call('listNoteDialogue', { notePath: '50_Manuscript/Chapter 3.md' });
		expect(items(stretches)).toEqual([
			{ range: { from: 0, to: 6 }, text: '“Ada,”' },
			{ range: spanOf('“the tower is very cold.”'), text: '“the tower is very cold.”' },
			{ range: spanOf('"Home,"'), text: '"Home,"' },
		]);
		expect(items(await call('listNoteDialogue', { notePath: '50_Manuscript/Chapter 1.md' }))).toEqual([]);
	});

	it('is not read at all where the author switched every kind of quotation mark off', async () => {
		const silent = await createWritten({ dialogue: [] });
		const reply = await silent.call('getDialogue', { projectId: silent.project.id });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({ items: [], total: 0, marks: [] });
		const one = await silent.call('listNoteDialogue', { projectId: silent.project.id, notePath: '50_Manuscript/Chapter 3.md' });
		expect(items(one.body)).toEqual([]);
	});
});

describe('the mentions', () => {
	const member = (row: Body): Body => bodyOf(row['member']);

	it('give each note the manuscript names, in the order each is first named, with how often and where', async () => {
		const mentions = await call('getMentions');
		expect(items(mentions).map((row) => [member(row)['name'], row['total'], row['linked'], row['unlinked']])).toEqual([
			['Ben', 2, 0, 2],
			['Ada', 2, 0, 2],
			['The Guild', 1, 0, 1],
			// Named once, as the text of a link to it.
			['Clocktower', 1, 1, 0],
		]);
		const { ben } = golden.members;
		expect(items(mentions)[0]).toEqual({
			member: { kind: 'character', id: ben.characterId, name: 'Ben', path: ben.path, resolved: true },
			total: 2,
			linked: 0,
			unlinked: 2,
			first: { note: SECOND, from: 0 },
			last: { note: THIRD, from: 12 },
			notes: [
				{ note: SECOND, count: 1 },
				{ note: THIRD, count: 1 },
			],
		});
		// "The clockmaker" is what two characters go by, so it is counted for neither.
		expect(mentions).toMatchObject({ total: 4, unresolved: 1 });
	});

	it('are told only by spellings a note goes by, letter for letter', async () => {
		const mentions = items(await call('getMentions'));
		// The first chapter says "midnight", and the note is Midnight.
		expect(mentions.map((row) => member(row)['name'])).not.toContain('Midnight');
		// The third says "the tower", and the Clocktower also goes by The tower. Only the link to it is counted.
		expect(mentions.find((row) => member(row)['name'] === 'Clocktower')?.['total']).toBe(1);
	});

	it('can be narrowed to one kind of note or to one note', async () => {
		const names = async (params: Body): Promise<unknown[]> => items(await call('getMentions', params)).map((row) => member(row)['name']);
		expect(await names({ kind: 'character' })).toEqual(['Ben', 'Ada']);
		expect(await names({ kind: 'Faction' })).toEqual(['The Guild']);
		expect(await names({ kind: 'scene' })).toEqual([]);
		expect(await names({ member: golden.members.ada.characterId })).toEqual(['Ada']);
		expect(await names({ member: 'character-nobody' })).toEqual([]);
		// What is left out of the list is still counted in what could mean more than one note.
		expect((await call('getMentions', { kind: 'scene' }))['unresolved']).toBe(1);
		const refused = await golden.call('getMentions', { projectId: pid(), kind: 'weather' });
		expect([refused.status, bodyOf(refused.body)['code']]).toEqual([400, 'invalid-request']);
		expect(bodyOf(refused.body)['errors']).toMatchObject([{ pointer: 'params/kind' }]);
	});

	it('come a page at a time', async () => {
		const page = await call('getMentions', { limit: 2, offset: 1 });
		expect(page).toMatchObject({ total: 4, offset: 1, limit: 2, nextOffset: 3, unresolved: 1 });
		expect(items(page).map((row) => member(row)['name'])).toEqual(['Ada', 'The Guild']);
	});
});

describe('the mentions in one manuscript note', () => {
	it('come in reading order, each with where it stands and how sure it is', async () => {
		const found = await call('listNoteMentions', { notePath: '50_Manuscript/Chapter 3.md' });
		expect(items(found).map((mention) => [mention['text'], mention['resolution'], mention['range']])).toEqual([
			['Ada', 'unique', { from: 1, to: 4 }],
			['Ben', 'unique', { from: 12, to: 15 }],
			['Ada', 'unique', spanOf('Ada', 4)],
			['The clockmaker', 'ambiguous', spanOf('The clockmaker')],
			['The Guild', 'unique', spanOf('The Guild')],
			// The text the link shows, which is the second of the two places the link spells the name.
			['Clocktower', 'wikilink', { from: LINK_TEXT, to: LINK_TEXT + 'Clocktower'.length }],
		]);
	});

	it('say which note is meant where that is certain, and every note it could be where it is not', async () => {
		const found = items(await call('listNoteMentions', { notePath: '50_Manuscript/Chapter 3.md' }));
		const { ada, tower } = golden.members;
		const adaRef = { kind: 'character', id: ada.characterId, name: 'Ada', path: ada.path, resolved: true };
		expect(found[0]).toMatchObject({ member: adaRef, candidates: [adaRef] });
		const unsure = found.find((mention) => mention['resolution'] === 'ambiguous');
		expect(unsure?.['member']).toBeNull();
		expect((unsure?.['candidates'] as Body[]).map((candidate) => candidate['name'])).toEqual(['Ada', 'Old Ada']);
		const linked = found.find((mention) => mention['resolution'] === 'wikilink');
		expect(linked?.['member']).toEqual({ kind: 'location', id: tower.entityId, name: 'Clocktower', path: tower.path, resolved: true });
	});

	it('are found only for a note of this project’s manuscript', async () => {
		for (const operation of ['listNoteMentions', 'listNoteDialogue']) {
			for (const notePath of ['20_Character/Ada.md', '50_Manuscript/No such chapter.md', '../北境之雪/50_正文/初稿.md']) {
				const reply = await golden.call(operation, { projectId: pid(), notePath });
				expect([reply.status, bodyOf(reply.body)['code']], `${operation} ${notePath}`).toEqual([404, 'not-found']);
				expect(faults(reply), notePath).toEqual([]);
			}
		}
	});
});

describe('the statistics and the mentions, read', () => {
	const CACHES = [
		`${ROOT}/70_Tool/71_Data_Statistics/712_Prose_Analysis/device_analysis_stats.json`,
		`${ROOT}/70_Tool/71_Data_Statistics/713_Entity_Tracking/device_mention_index.json`,
	];

	it('write nothing but the plugin’s own cache for this device, and that only once', async () => {
		const fresh = await createWritten();
		const ask = async (operation: string, params: Body = {}): Promise<void> => {
			const reply = await fresh.call(operation, { projectId: fresh.project.id, ...params });
			expect(reply.status, operation).toBe(200);
		};
		const before = vaultState(fresh.host);
		// Counting alone keeps what it worked out in memory.
		await ask('getWritingCounts');
		expect(vaultState(fresh.host)).toEqual(before);

		const round = async (): Promise<void> => {
			await ask('getProseStatistics');
			await ask('getWordFrequency', { includeNames: true });
			await ask('getSensitiveWords', { include: 'occurrences' });
			await ask('getDialogue');
			await ask('listNoteDialogue', { notePath: '50_Manuscript/Chapter 3.md' });
			await ask('getMentions');
			await ask('listNoteMentions', { notePath: '50_Manuscript/Chapter 3.md' });
		};
		await round();
		const after = vaultState(fresh.host);
		expect(Object.keys(after).filter((path) => after[path] !== before[path])).toEqual(CACHES);
		// Nothing has changed, so nothing is worked out again and nothing written.
		await round();
		expect(vaultState(fresh.host)).toEqual(after);
		expect(fresh.host.ranAsPlugin).toBe(0);
	});
});
