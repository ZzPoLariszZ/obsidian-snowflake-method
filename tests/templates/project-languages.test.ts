import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
	DEFAULT_STOPWORDS,
	MAIN_VIEW_NAMES,
	PROJECT_LANGUAGES,
	exportProse,
	exportScriptOf,
	exportScriptOfLanguage,
	freshFreeformDocument,
	freshTimelineDocument,
	isProjectLanguage,
	type ProjectLanguage,
} from '../../src/domain';
import {
	PROJECT_PATH_LAYOUTS,
	getProjectMetadataRelativePath,
	type ProjectDirectoryKey,
} from '../../src/services';
import {
	characterRoleFromValue,
	characterRoleName,
	characterStarterNames,
	characterTypeFromNodeName,
	customFieldRootNameForFolder,
	definitionRootName,
	galleryRootNameForFolder,
} from '../../src/services/definition-files';
import {
	characterTemplate,
	draftTemplate,
	entityTemplate,
	getProjectBases,
	getStoryArtifacts,
	getSystemTemplates,
	parseRecordLine,
	parseRecordSection,
	parseRecordSectionLenient,
	projectTemplate,
	recordSectionTitle,
	renderCharacterFieldsBlock,
	renderEntityFieldsBlock,
	renderRecordLine,
	renderRecordSection,
	renderSceneFieldsBlock,
	sceneTemplate,
	starterMemberNames,
	storyArtifactTemplate,
	type RecordLine,
} from '../../src/templates';

/** What no file or folder name may hold on any platform Obsidian runs on. */
const UNSAFE_NAME = /[\\:*?"<>|#^[\]]/u;

/** The number a name starts with, `711` of `711_Writing_Session`. */
const numberOf = (name: string): string => /^\d+[A-Za-z]?_/u.exec(name)?.[0] ?? '';

const segmentsOf = (path: string): string[] => path.split('/');

describe('the languages a project can be written in', () => {
	it('lists eight languages, English first, and recognizes only those', () => {
		expect([...PROJECT_LANGUAGES]).toEqual(['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es']);
		for (const language of PROJECT_LANGUAGES) expect(isProjectLanguage(language)).toBe(true);
		for (const other of ['zh', 'zh-Hant', 'pt', 'it', '', null, 3]) expect(isProjectLanguage(other)).toBe(false);
	});

	it('gives every language a layout of its own, numbered as the English one is', () => {
		const en = PROJECT_PATH_LAYOUTS.en;
		const keys = Object.keys(en.directories) as ProjectDirectoryKey[];
		for (const language of PROJECT_LANGUAGES) {
			const layout = PROJECT_PATH_LAYOUTS[language];
			expect(Object.keys(layout.directories)).toEqual(keys);
			expect(numberOf(layout.projectFileName)).toBe(numberOf(en.projectFileName));
			for (const key of keys) {
				const ours = segmentsOf(layout.directories[key]);
				const theirs = segmentsOf(en.directories[key]);
				expect(ours.map(numberOf), `${language} ${key}`).toEqual(theirs.map(numberOf));
			}
			for (const kind of ['time', 'location', 'item'] as const) {
				expect(numberOf(layout.worldbuildingKinds[kind])).toBe(numberOf(en.worldbuildingKinds[kind]));
			}
			// Folders that share a parent share its spelling: the statistics,
			// task and visualization chains each hang under one tool folder.
			const tool = segmentsOf(layout.directories.writingSessions)[0];
			for (const key of ['manuscriptAnalysis', 'tasks', 'freeform', 'imports'] as const) {
				expect(segmentsOf(layout.directories[key])[0]).toBe(tool);
			}
			expect(segmentsOf(layout.directories.tasks)[1]).toBe(segmentsOf(layout.directories.stickyNotes)[1]);
			expect(segmentsOf(layout.directories.freeform)[1]).toBe(segmentsOf(layout.directories.relationshipGraph)[1]);
			// Every leaf is distinct, so no two tenants share a folder.
			const leaves = keys.map((key) => layout.directories[key]);
			expect(new Set(leaves).size).toBe(leaves.length);
		}
	});

	it('writes every name it puts on disk composed, and safe on every platform', () => {
		for (const language of PROJECT_LANGUAGES) {
			const layout = PROJECT_PATH_LAYOUTS[language];
			const names = [
				layout.projectFileName,
				layout.draftFileName,
				...Object.values(layout.directories).flatMap(segmentsOf),
				...Object.values(layout.worldbuildingKinds),
				...getStoryArtifacts(language).flatMap(({ relativePath }) => segmentsOf(relativePath)),
				...getSystemTemplates(language).map(({ fileName }) => fileName),
				...getProjectBases('p', language, { major: '', supporting: '', minor: '' }, []).map(({ fileName }) => fileName),
				...(['category', 'world-status', 'relationship'] as const).flatMap((id) =>
					(['character', 'scene', 'time', 'location', 'item'] as const).map((kind) => definitionRootName(kind, id, language)),
				),
				customFieldRootNameForFolder(layout.directories.characters, language),
				galleryRootNameForFolder(layout.directories.characters, language),
				...(['category', 'world-status', 'relationship'] as const).flatMap((id) => characterStarterNames(language, id)),
				MAIN_VIEW_NAMES[language],
			];
			for (const name of names) {
				expect(name, `${language}: ${name}`).toBe(name.normalize('NFC'));
				expect(name, `${language}: ${name}`).not.toMatch(UNSAFE_NAME);
				expect(name.trim(), `${language}: ${name}`).toBe(name);
				expect(name.length, `${language}: ${name}`).toBeGreaterThan(0);
			}
		}
	});

	it('tells every language apart by its metadata note, so a project missing its language is still read right', () => {
		const paths = PROJECT_LANGUAGES.map((language) => getProjectMetadataRelativePath(language));
		expect(new Set(paths).size).toBe(paths.length);
		const systems = PROJECT_LANGUAGES.map((language) => PROJECT_PATH_LAYOUTS[language].directories.system);
		const projectFiles = PROJECT_LANGUAGES.map((language) => PROJECT_PATH_LAYOUTS[language].projectFileName);
		expect(new Set(projectFiles).size).toBe(projectFiles.length);
		// German writes its system folder the way English does, so the note's
		// own name is what tells those two apart.
		expect(systems.filter((name) => name === PROJECT_PATH_LAYOUTS.en.directories.system)).toEqual(['00_System', '00_System']);
	});

	it('keeps the step files under the language’s own summary and synopsis folders', () => {
		for (const language of PROJECT_LANGUAGES) {
			const layout = PROJECT_PATH_LAYOUTS[language];
			const artifacts = getStoryArtifacts(language);
			expect(artifacts.map(({ step, document }) => [step, document])).toEqual(
				getStoryArtifacts('en').map(({ step, document }) => [step, document]),
			);
			const [one, two, four, six] = artifacts.map(({ relativePath }) => segmentsOf(relativePath));
			expect(one?.[0]).toBe(layout.directories.summaries);
			expect(two?.[0]).toBe(layout.directories.summaries);
			expect(four?.[0]).toBe(layout.directories.synopses);
			expect(six?.[0]).toBe(layout.directories.synopses);
			expect(getSystemTemplates(language).map(({ id, fileName }) => [id, numberOf(fileName)])).toEqual(
				getSystemTemplates('en').map(({ id, fileName }) => [id, numberOf(fileName)]),
			);
		}
	});

	it('writes every starter note in the language, with the second step’s section named without its step', () => {
		for (const language of PROJECT_LANGUAGES) {
			expect(projectTemplate('Novel', language).body.startsWith('# Novel\n\n')).toBe(true);
			for (const step of [1, 2, 4, 6] as const) {
				const body = storyArtifactTemplate(step, language).body;
				expect(body).not.toContain('undefined');
			}
			const two = storyArtifactTemplate(2, language);
			const heading = two.sections.find((section) => section.id === 'one-paragraph-summary')?.heading ?? '';
			expect(heading.startsWith('## ')).toBe(true);
			expect(heading).not.toContain(' · ');
			expect(two.body.split('\n')[0]).toContain(' · ');
			for (const template of [
				characterTemplate('A', language),
				sceneTemplate('B', language),
				entityTemplate('C', 'time', language),
				draftTemplate(language),
			]) {
				expect(template.body).not.toContain('undefined');
			}
			const names = starterMemberNames(language);
			expect(names.character.length).toBeGreaterThan(0);
			expect(names.scene.length).toBeGreaterThan(0);
		}
	});

	it('labels every overview field in the language', () => {
		for (const language of PROJECT_LANGUAGES) {
			const character = renderCharacterFieldsBlock(language, {
				progressStatus: 'in-revision',
				aliases: ['A', 'B'],
				categories: ['C'],
				oneSentenceStoryline: 'S',
				motivation: 'M',
				goal: 'G',
				conflict: 'X',
				growth: 'Y',
			});
			const scene = renderSceneFieldsBlock(language, {
				progressStatus: 'complete',
				aliases: [],
				categories: [],
				pov: { kind: 'mode', mode: 'omniscient' },
				times: ['T'],
				locations: ['L'],
				conflict: 'X',
				cast: [{ path: 'N/20_Character/A', name: 'A' }],
			});
			const entity = renderEntityFieldsBlock(language, 'time', {
				progressStatus: 'not-started',
				aliases: [],
				categories: [],
				description: 'D',
				time: { kind: 'period', start: 'One', end: 'Two' },
			});
			for (const block of [character, scene, entity]) {
				expect(block.startsWith('> [!info] ')).toBe(true);
				expect(block).not.toContain('undefined');
				expect(block.split('\n').filter((line) => line.startsWith('> **'))).not.toHaveLength(0);
			}
		}
	});
});

describe('record lines in every project language', () => {
	const record: RecordLine = {
		label: { path: 'Novel/23_Relationship/Member/Member', display: 'Member' },
		value: 'Guild Master',
		clauses: [
			{ kind: 'target', term: { kind: 'link', path: 'Novel/63_Item/Guild', name: 'Guild' } },
			{ kind: 'at', term: { kind: 'link', path: 'Novel/62_Location/Capital', name: 'Capital' } },
			{ kind: 'when', term: { kind: 'link', path: 'Novel/61_Time/War', name: 'War' } },
			{ kind: 'with', term: { kind: 'link', path: 'Novel/20_Character/Ana', name: 'Ana' } },
		],
	};
	const bare: RecordLine = {
		label: { path: 'Novel/22_Status/Injured/Injured', display: 'Injured' },
		value: '',
		clauses: [{ kind: 'at', term: { kind: 'link', path: 'Novel/62_Location/Keep', name: 'Keep' } }],
	};

	it('reads back what it writes, value and every kind of clause', () => {
		for (const language of PROJECT_LANGUAGES) {
			for (const line of [record, bare]) {
				expect(parseRecordLine(language, renderRecordLine(language, line)), language).toEqual(line);
			}
		}
	});

	it('takes back out the span it writes behind a period', () => {
		const spanOf = (path: string) =>
			path === 'Novel/61_Time/War'
				? {
					start: { kind: 'link', path: 'Novel/61_Time/Year 1', name: 'Year 1' } as const,
					end: { kind: 'link', path: 'Novel/61_Time/Year 9', name: 'Year 9' } as const,
				}
				: null;
		for (const language of PROJECT_LANGUAGES) {
			const written = renderRecordLine(language, record, spanOf);
			expect(written, language).toContain('Year 9');
			expect(parseRecordLine(language, written), language).toEqual(record);
		}
	});

	it('reads lines written in any other language, and writes them back in its own', () => {
		for (const written of PROJECT_LANGUAGES) {
			const section = renderRecordSection(written, 'relationships', [record, bare]);
			for (const reader of PROJECT_LANGUAGES) {
				const parsed = parseRecordSectionLenient(reader, section);
				expect(parsed.unrecognized, `${written} read as ${reader}`).toEqual([]);
				expect(parsed.records, `${written} read as ${reader}`).toEqual([record, bare]);
			}
			expect(parseRecordSection(written, section).records).toEqual([record, bare]);
			expect(section.split('\n')[0]).toBe(`> [!info] ${recordSectionTitle('relationships', written)}`);
		}
	});

	it('lets the language the section is titled in read its own lines, links in the value and all', () => {
		// "in" is a German connector: read as German, the value would lose its link.
		const own: RecordLine = {
			label: { path: 'Novel/23_Relationship/Member/Member', display: 'Member' },
			value: 'Knight in [[Novel/63_Item/Order|Order]]',
			clauses: [],
		};
		const section = renderRecordSection('en', 'relationships', [own]);
		for (const reader of PROJECT_LANGUAGES) {
			expect(parseRecordSectionLenient(reader, section).records, reader).toEqual([own]);
		}
	});

	it('reads an untitled section of an older release in whichever language wrote it', () => {
		for (const written of PROJECT_LANGUAGES) {
			const lines = [record, bare].map((line) => `- ${renderRecordLine(written, line)}`).join('\n');
			for (const reader of PROJECT_LANGUAGES) {
				expect(parseRecordSectionLenient(reader, lines).records, `${written} read as ${reader}`).toEqual([record, bare]);
			}
		}
	});
});

describe('the vocabulary trees in every project language', () => {
	it('numbers each root after the folder it sits in, as English does', () => {
		for (const language of PROJECT_LANGUAGES) {
			for (const kind of ['character', 'scene', 'time', 'location', 'item'] as const) {
				for (const id of ['category', 'world-status', 'relationship'] as const) {
					expect(numberOf(definitionRootName(kind, id, language))).toBe(numberOf(definitionRootName(kind, id, 'en')));
				}
			}
		}
	});

	it('knows a role by its name in any language, at the root of any language’s category tree', () => {
		for (const language of PROJECT_LANGUAGES) {
			for (const type of ['major', 'supporting', 'minor'] as const) {
				const name = characterRoleName(language, type);
				expect(characterTypeFromNodeName(name)).toBe(type);
				const root = definitionRootName('character', 'category', language);
				expect(characterRoleFromValue(`[[Novel/20/${root}/${name}/${name}|${name}]]`)).toBe(type);
			}
		}
	});

	it('generates every base in every language', () => {
		const roles = { major: '[[a]]', supporting: '[[b]]', minor: '[[c]]' };
		const kinds = (['time', 'location', 'item'] as const).map((id, at) => ({
			id,
			folderName: `6${at + 1}_${id}`,
			custom: false,
			icon: null,
			description: null,
		}));
		for (const language of PROJECT_LANGUAGES) {
			const bases = getProjectBases('p', language, roles, kinds);
			expect(bases.map(({ id }) => id)).toEqual(['characters', 'scenes', 'time', 'location', 'item']);
			for (const base of bases) {
				const document = parse(base.content) as { views: { name: string }[] };
				expect(document.views.length, `${language} ${base.id}`).toBeGreaterThan(0);
				expect(base.content).not.toContain('undefined');
			}
		}
	});
});

describe('what a project of each language starts with', () => {
	it('names the first freeform and timeline view in the project’s language', () => {
		for (const language of PROJECT_LANGUAGES) {
			expect(freshFreeformDocument(language).views[0]?.name).toBe(MAIN_VIEW_NAMES[language]);
			expect(freshTimelineDocument(language).views[0]?.name).toBe(MAIN_VIEW_NAMES[language]);
		}
	});

	it('passes over each language’s own function words, written as tokens are', () => {
		for (const language of PROJECT_LANGUAGES) {
			const words = [...DEFAULT_STOPWORDS[language]];
			expect(words.length, language).toBeGreaterThan(40);
			for (const word of words) expect(word).toBe(word.normalize('NFC').toLowerCase());
		}
		expect(DEFAULT_STOPWORDS['zh-TW'].has('們')).toBe(true);
		expect(DEFAULT_STOPWORDS.ja.has('の')).toBe(true);
		expect(DEFAULT_STOPWORDS.ko.has('그리고')).toBe(true);
		expect(DEFAULT_STOPWORDS.de.has('die')).toBe(true);
		// English keeps its own words: the German article is an English verb.
		expect(DEFAULT_STOPWORDS.en.has('die')).toBe(false);
	});
});

describe('the indent an export sets in each language', () => {
	const options = (script: ReturnType<typeof exportScriptOfLanguage>) => ({
		indent: true,
		paragraphSpacing: true,
		script,
	});
	const languages: Record<ProjectLanguage, string> = {
		en: '  ',
		'zh-CN': '　　',
		'zh-TW': '　　',
		ja: '　',
		ko: '　',
		fr: '  ',
		de: '  ',
		es: '  ',
	};

	it('sets Chinese two characters in, Japanese and Korean one, the rest two em spaces', () => {
		for (const language of PROJECT_LANGUAGES) {
			expect(exportProse('Words.\n', [], options(exportScriptOfLanguage(language))), language).toBe(`${languages[language]}Words.\n`);
		}
	});

	it('reads which a note asks for from its own words when no project says', () => {
		expect(exportScriptOf('她走进房间，看见窗外的雪。')).toBe('cjk');
		expect(exportScriptOf('她走進房間，看見窗外的雪。')).toBe('cjk');
		expect(exportScriptOf('彼女は部屋に入り、窓の外の雪を見た。')).toBe('kana');
		expect(exportScriptOf('그녀는 방에 들어가 창밖의 눈을 보았다.')).toBe('hangul');
		expect(exportScriptOf('She walked into the room and saw the snow.')).toBe('latin');
		expect(exportScriptOf('Elle entra dans la pièce et vit la neige.')).toBe('latin');
	});
});
