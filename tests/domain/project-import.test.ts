import { describe, expect, it } from 'vitest';

import {
	catalogImportParts,
	characterInputOf,
	classifyImportStanding,
	closeSelection,
	emptyImportProvenanceDocument,
	entityInputOf,
	importHash,
	importLinkResolver,
	importNodePath,
	importPathKey,
	importRewriteContext,
	importTranslation,
	inspectImport,
	linkedParts,
	planImport,
	plannedMemberPath,
	recordImports,
	remapBeatSheet,
	remapEntityRef,
	remapForeshadowing,
	remapFreeformView,
	remapRevision,
	remapTask,
	remapTimeline,
	rememberChoices,
	rewriteProseLinks,
	sceneInputOf,
	taxonomyBelow,
	translateTaxonomy,
	type BeatSheet,
	type DefinitionFileId,
	type EntityRef,
	type Foreshadowing,
	type FreeformPlacement,
	type FreeformResource,
	type FreeformView,
	type ImportCharacter,
	type ImportEntity,
	type ImportInspection,
	type ImportLinkResolver,
	type ImportMapping,
	type ImportMemberBase,
	type ImportPlanHooks,
	type ImportProjectContents,
	type ImportProjectShape,
	type ImportProvenanceDocument,
	type ImportProvenanceEntry,
	type ImportScene,
	type ImportVocabularyNode,
	type ProjectWorldbuildingKind,
	type Revision,
	type Task,
	type Timeline,
} from '../../src/domain';
import type { RecordLine, RecordTerm } from '../../src/templates/record-lines';

// ---- Two projects, one in each language ----------------------------------------

const WORDS = {
	en: {
		characters: '30_Character',
		scenes: '40_Scene',
		worldbuilding: '60_Worldbuilding',
		category: '21_Category',
		worldStatus: '22_World_Status',
		relationship: '23_Relationship',
		customField: '24_Custom_Field',
		gallery: '25_Gallery',
		draft: '50_Manuscript',
		kinds: { time: '61_Time', location: '62_Location', item: '63_Item' },
		roles: { major: 'Major', supporting: 'Supporting', minor: 'Minor' },
		statusStarters: ['Injured', 'Missing', 'Deceased'],
		relationshipStarters: ['Ally', 'Enemy', 'Friend', 'Family', 'Member'],
	},
	'zh-CN': {
		characters: '30_角色',
		scenes: '40_场景',
		worldbuilding: '60_世界观',
		category: '21_分类',
		worldStatus: '22_世界状态',
		relationship: '23_关系',
		customField: '24_自定义字段',
		gallery: '25_图库',
		draft: '50_正文',
		kinds: { time: '61_时间', location: '62_地点', item: '63_物品' },
		roles: { major: '主角', supporting: '配角', minor: '次要角色' },
		statusStarters: ['受伤', '失踪', '已故'],
		relationshipStarters: ['盟友', '敌人', '朋友', '家人', '成员'],
	},
} as const;

function shape(
	locale: 'en' | 'zh-CN',
	rootPath: string,
	title: string,
	custom: readonly { id: string; folderName: string }[] = [],
): ImportProjectShape {
	const words = WORDS[locale];
	const kinds: ProjectWorldbuildingKind[] = [
		{ id: 'time', folderName: words.kinds.time, custom: false, icon: null, description: null },
		{ id: 'location', folderName: words.kinds.location, custom: false, icon: null, description: null },
		{ id: 'item', folderName: words.kinds.item, custom: false, icon: null, description: null },
		...custom.map((kind) => ({
			id: kind.id,
			folderName: kind.folderName,
			custom: true,
			icon: 'flag',
			description: `About ${kind.id}`,
		})),
	];
	const memberFolders: Record<string, string> = {
		character: `${rootPath}/${words.characters}`,
		scene: `${rootPath}/${words.scenes}`,
	};
	for (const kind of kinds) memberFolders[kind.id] = `${rootPath}/${words.worldbuilding}/${kind.folderName}`;
	const definitionRoots: Record<string, Record<DefinitionFileId, string>> = {};
	const galleryFolders: Record<string, string> = {};
	const customFieldRoots: Record<string, string> = {};
	for (const [kind, folder] of Object.entries(memberFolders)) {
		definitionRoots[kind] = {
			category: `${folder}/${words.category}`,
			'world-status': `${folder}/${words.worldStatus}`,
			relationship: `${folder}/${words.relationship}`,
		};
		galleryFolders[kind] = `${folder}/${words.gallery}`;
		customFieldRoots[kind] = `${folder}/${words.customField}`;
	}
	return {
		id: `project-${title}`,
		title,
		rootPath,
		locale,
		kinds,
		memberFolders,
		definitionRoots,
		galleryFolders,
		customFieldRoots,
		draftFolder: `${rootPath}/${words.draft}`,
		roles: words.roles,
		starters: {
			category: [words.roles.major, words.roles.supporting, words.roles.minor],
			'world-status': words.statusStarters,
			relationship: words.relationshipStarters,
		},
	};
}

const ZH = shape('zh-CN', 'Snowflake Projects/第一卷', '第一卷', [{ id: '势力', folderName: '64_势力' }]);
const EN = shape('en', 'Snowflake Projects/Book 2', 'Book 2');
const EN1 = shape('en', 'Snowflake Projects/Book 1', 'Book 1');

const folderOf = (project: ImportProjectShape, kind: string): string => {
	const folder = project.memberFolders[kind];
	if (folder === undefined) throw new Error(`no folder for ${kind}`);
	return folder;
};
const rootOf = (project: ImportProjectShape, kind: string, id: DefinitionFileId): string => {
	const root = project.definitionRoots[kind]?.[id];
	if (root === undefined) throw new Error(`no ${id} root for ${kind}`);
	return root;
};
const galleryOf = (project: ImportProjectShape, kind: string): string => {
	const folder = project.galleryFolders[kind];
	if (folder === undefined) throw new Error(`no gallery for ${kind}`);
	return folder;
};
const fieldRootOf = (project: ImportProjectShape, kind: string): string => {
	const folder = project.customFieldRoots[kind];
	if (folder === undefined) throw new Error(`no field root for ${kind}`);
	return folder;
};

const base = (project: ImportProjectShape, kind: string, id: string, name: string, rank: number): ImportMemberBase => ({
	id,
	path: `${folderOf(project, kind)}/${name}.md`,
	name,
	rank,
	progressStatus: null,
	aliases: [],
	categories: [],
	color: null,
	gallery: [],
	galleryMain: null,
	worldStatus: [],
	relationships: [],
	worldStatusUnrecognized: [],
	relationshipsUnrecognized: [],
	customFields: '',
});
const character = (
	project: ImportProjectShape,
	id: string,
	name: string,
	rank: number,
	extra: Partial<ImportCharacter> = {},
): ImportCharacter => ({
	...base(project, 'character', id, name, rank),
	type: null,
	oneSentenceStoryline: '',
	motivation: '',
	goal: '',
	conflict: '',
	growth: '',
	oneParagraphStoryline: '',
	characterSynopsis: '',
	characterProfile: '',
	...extra,
});
const scene = (project: ImportProjectShape, id: string, name: string, rank: number, extra: Partial<ImportScene> = {}): ImportScene => ({
	...base(project, 'scene', id, name, rank),
	povPath: null,
	times: [],
	locations: [],
	characters: [],
	conflict: '',
	linkedManuscript: [],
	events: '',
	planning: '',
	...extra,
});
const entity = (
	project: ImportProjectShape,
	kind: string,
	id: string,
	name: string,
	rank: number,
	extra: Partial<ImportEntity> = {},
): ImportEntity => ({
	...base(project, kind, id, name, rank),
	kind,
	description: '',
	timeKind: null,
	timeStart: '',
	timeEnd: '',
	notes: '',
	...extra,
});
const categoryLink = (project: ImportProjectShape, kind: string, taxonomy: string): string =>
	`[[${importNodePath(rootOf(project, kind, 'category'), taxonomy)}|${taxonomy}]]`;
const labelOf = (project: ImportProjectShape, kind: string, id: DefinitionFileId, taxonomy: string): RecordLine['label'] => ({
	path: importNodePath(rootOf(project, kind, id), taxonomy),
	display: taxonomy,
});
const linkTerm = (member: ImportMemberBase): RecordTerm => ({ kind: 'link', path: importPathKey(member.path), name: member.name });
const node = (project: ImportProjectShape, kind: string, id: DefinitionFileId, taxonomy: string, description = ''): ImportVocabularyNode => ({
	kind,
	id,
	taxonomyPath: taxonomy,
	selfPath: `${importNodePath(rootOf(project, kind, id), taxonomy)}.md`,
	description,
});
const seeded = (project: ImportProjectShape): ImportVocabularyNode[] => [
	...project.starters.category.map((word) => node(project, 'character', 'category', word)),
	...project.starters['world-status'].map((word) => node(project, 'character', 'world-status', word)),
	...project.starters.relationship.map((word) => node(project, 'character', 'relationship', word)),
];
const ref = (member: ImportMemberBase, kind: string): EntityRef => ({ kind, id: member.id, name: member.name });
const contents = (
	project: ImportProjectShape,
	parts: Partial<Omit<ImportProjectContents, 'project'>> = {},
): ImportProjectContents => ({
	project,
	characters: [],
	scenes: [],
	entities: [],
	vocabulary: [],
	templates: [],
	pictures: [],
	chapters: [],
	steps: [],
	tasks: [],
	foreshadowing: [],
	revisions: [],
	stickyNotes: [],
	freeformViews: [],
	timelines: [],
	beatSheets: [],
	beatSheetTemplates: [],
	...parts,
});

const placement = (id: string, resource: FreeformResource): FreeformPlacement => ({
	id,
	resource,
	x: 0,
	y: 0,
	width: 256,
	height: 160,
	displayMode: 'auto',
	zIndex: 0,
	frameId: null,
});
const edge = (id: string, source: string, target: string): FreeformView['edges'][number] => ({
	id,
	source,
	target,
	sourceSide: null,
	targetSide: null,
	label: '',
	arrow: 'end',
	line: 'solid',
});

// The zh-CN source: two characters, a scene, two entities, the vocabulary,
// a template, a picture, two chapters and one record of every tool kind.
const bob = character(ZH, 'character-bob', '鲍勃', 2048, {
	type: 'supporting',
	categories: [categoryLink(ZH, 'character', '配角')],
});
const pictureLink = `[[${galleryOf(ZH, 'character')}/portrait.png]]`;
const ali = character(ZH, 'character-ali', '阿丽', 1024, {
	type: 'major',
	categories: [categoryLink(ZH, 'character', '主角'), categoryLink(ZH, 'character', '家族/史塔克')],
	worldStatus: [
		{ label: labelOf(ZH, 'character', 'world-status', '受伤'), value: '战时', clauses: [{ kind: 'with', term: linkTerm(bob) }] },
	],
	gallery: [pictureLink],
	galleryMain: pictureLink,
	goal: '回家',
	oneParagraphStoryline: `她和[[${importPathKey(bob.path)}|鲍勃]]同行，[[鲍勃]]也在。`,
});
const dawn = entity(ZH, 'time', 'entity-dawn', '黎明', 1024, { timeKind: 'point' });
const wolves = entity(ZH, '势力', 'entity-wolves', '狼族', 1024, {
	timeStart: `[[${importPathKey(dawn.path)}|黎明]]`,
});
const chapterOne = { path: `${ZH.draftFolder}/第一章.md`, title: '第一章' };
const chapterTwo = { path: `${ZH.draftFolder}/第二章.md`, title: '第二章' };
const opening = scene(ZH, 'scene-opening', '开场', 1024, {
	povPath: ali.path,
	characters: [ali.path, bob.path],
	times: [`[[${importPathKey(dawn.path)}|黎明]]`],
	locations: ['北方'],
	linkedManuscript: [`[[${importPathKey(chapterOne.path)}#开头|第一章]]`],
	events: `[[${importPathKey(ali.path)}]] 到达。`,
});
const picture = { kind: 'character', path: `${galleryOf(ZH, 'character')}/portrait.png`, name: 'portrait.png' };
const template = {
	kind: 'character',
	name: '基本资料',
	description: '每个角色的基本信息',
	path: `${fieldRootOf(ZH, 'character')}/基本资料.md`,
	fields: [{ title: '年龄', content: '' }],
};
const stepOne = {
	step: 1 as const,
	path: `${ZH.rootPath}/10_概要/11_一句话.md`,
	sections: { genre: '奇幻', 'one-sentence-summary': '一句话' },
};
const task: Task = {
	id: 'task-source',
	title: '改开头',
	description: '',
	status: 'todo',
	priority: 'medium',
	dueDate: null,
	related: [ref(ali, 'character')],
	archived: false,
	createdAt: 1,
	updatedAt: 1,
};
const occurrence = (id: string, path: string): Foreshadowing['occurrences'][number] => ({
	id,
	role: 'plant',
	note: '',
	path,
	from: 0,
	to: 2,
	originalText: '开头',
	before: '',
	after: '',
});
const thread: Foreshadowing = {
	id: 'foreshadowing-source',
	name: '狼嚎',
	description: '',
	status: 'planned',
	related: [ref(ali, 'character')],
	createdAt: 1,
	updatedAt: 1,
	occurrences: [occurrence('occurrence-1', chapterOne.path), occurrence('occurrence-2', chapterTwo.path)],
};
const revision = (id: string, path: string): Revision => ({
	id,
	path,
	kind: 'replace',
	from: 0,
	to: 2,
	originalText: '开头',
	before: '',
	after: '',
	proposed: '开篇',
	comment: '',
	createdAt: 1,
});
const revisionOne = revision('revision-source-1', chapterOne.path);
const revisionTwo = revision('revision-source-2', chapterTwo.path);
const sticky = {
	id: 'sticky-note-source',
	color: 'macaron-1' as const,
	createdAt: 1,
	archived: false,
	path: `${ZH.rootPath}/70_工具/便签.md`,
	body: '记得改结尾\n第二行',
};
const view: FreeformView = {
	id: 'freeform-view-source',
	name: '构思',
	placements: [
		placement('placement-1', { type: 'entity', kind: 'character', id: ali.id, name: '阿丽' }),
		placement('placement-2', { type: 'task', id: task.id, name: '改开头' }),
		placement('placement-3', { type: 'file', path: '50_正文/第一章.md' }),
		placement('placement-4', { type: 'text', text: '随想' }),
		placement('placement-5', { type: 'entity', kind: 'character', id: bob.id, name: '鲍勃' }),
	],
	frames: [],
	edges: [edge('edge-1', 'placement-1', 'placement-2'), edge('edge-2', 'placement-1', 'placement-4')],
	viewport: { x: 10, y: 20, zoom: 2 },
	createdAt: 1,
	updatedAt: 2,
	strays: { placements: [], frames: [], edges: [] },
};
const timeline: Timeline = {
	id: 'timeline-source',
	name: '主线',
	binding: ref(ali, 'character'),
	times: [
		{ timeId: dawn.id, rows: [{ id: 'row-1', text: '', scenes: [opening.id, 'scene-gone', opening.id] }] },
		{ timeId: 'entity-gone', rows: [{ id: 'row-2', text: '', scenes: [opening.id] }] },
	],
	createdAt: 1,
	updatedAt: 1,
};
const sheet: BeatSheet = {
	id: 'beat-sheet-source',
	name: '三幕',
	acts: [{ id: 'act-1', label: '', beats: [{ id: 'beat-1', name: '开场', description: '', rows: [{ id: 'row-1', text: '', scenes: [opening.id] }] }] }],
	presentation: null,
	showSubDescriptions: true,
	reversed: false,
	createdAt: 1,
	updatedAt: 1,
};

const source = (): ImportProjectContents =>
	contents(ZH, {
		characters: [bob, ali],
		scenes: [opening],
		entities: [wolves, dawn],
		vocabulary: [
			...seeded(ZH),
			node(ZH, 'character', 'category', '家族/史塔克', '北境'),
			node(ZH, 'character', 'category', '家族', '贵族世家'),
		],
		templates: [template],
		pictures: [picture],
		chapters: [chapterOne, chapterTwo],
		steps: [stepOne],
		tasks: [task],
		foreshadowing: [thread],
		revisions: [revisionOne, revisionTwo],
		stickyNotes: [sticky],
		freeformViews: [view],
		timelines: [timeline],
		beatSheets: [sheet],
		beatSheetTemplates: [{ name: '三幕', description: '', structure: { acts: [] } }],
	});
const target = (parts: Partial<Omit<ImportProjectContents, 'project'>> = {}): ImportProjectContents =>
	contents(EN, {
		vocabulary: seeded(EN),
		steps: [{ step: 1, path: `${EN.rootPath}/10_Summary/11_One_Sentence.md`, sections: { genre: '', 'one-sentence-summary': '' } }],
		...parts,
	});

const KEYS = {
	ali: 'character:character-ali',
	bob: 'character:character-bob',
	opening: 'scene:scene-opening',
	dawn: 'worldbuilding:entity-dawn',
	wolves: 'worldbuilding:entity-wolves',
	stark: 'vocabulary:character/category/家族/史塔克',
	houses: 'vocabulary:character/category/家族',
	injured: 'vocabulary:character/world-status/受伤',
	major: 'vocabulary:character/category/主角',
	picture: `picture:${picture.path}`,
	chapterOne: `chapter:${chapterOne.path}`,
	chapterTwo: `chapter:${chapterTwo.path}`,
	template: 'custom-field-template:character/基本资料',
	task: 'task:task-source',
	thread: 'foreshadowing:foreshadowing-source',
	revisionOne: 'revision:revision-source-1',
	revisionTwo: 'revision:revision-source-2',
	sticky: 'sticky-note:sticky-note-source',
	view: 'freeform-view:freeform-view-source',
	timeline: 'timeline:timeline-source',
	sheet: 'beat-sheet:beat-sheet-source',
	sheetTemplate: 'beat-sheet-template:三幕',
	step: 'step:1',
};

const hooks = (): ImportPlanHooks => {
	const minted = new Map<string, number>();
	return {
		mint: (prefix) => {
			const next = (minted.get(prefix) ?? 0) + 1;
			minted.set(prefix, next);
			return `${prefix}-${next}`;
		},
		chapterPath: (title) => `${EN.draftFolder}/${title}.md`,
	};
};
const inspect = (
	sourceContents: ImportProjectContents,
	targetContents: ImportProjectContents,
	options: { takenPaths?: string[]; provenance?: ImportProvenanceDocument } = {},
): ImportInspection =>
	inspectImport({
		source: sourceContents,
		target: targetContents,
		takenPaths: options.takenPaths ?? [],
		provenance: options.provenance ?? emptyImportProvenanceDocument(),
	});
const defaults = (inspection: ImportInspection): Set<string> =>
	new Set(inspection.parts.filter((part) => part.defaultSelected).map((part) => part.key));
const entryOf = (plan: ReturnType<typeof planImport>['plan'], key: string): ReturnType<typeof planImport>['plan']['entries'][number] => {
	const entry = plan.entries.find((candidate) => candidate.part.key === key);
	if (entry === undefined) throw new Error(`no entry for ${key}`);
	return entry;
};

// ---- Catalogue -------------------------------------------------------------------

describe('catalogImportParts', () => {
	const parts = catalogImportParts(source());
	const part = (key: string): (typeof parts)[number] => {
		const found = parts.find((candidate) => candidate.key === key);
		if (found === undefined) throw new Error(`no part ${key}`);
		return found;
	};

	it('offers a folder named after its parent as its own part, one level down', () => {
		const chain = contents(ZH, {
			vocabulary: [
				node(ZH, 'character', 'category', '主角/主角', '主角中的主角'),
				node(ZH, 'character', 'category', '主角', '故事的中心'),
			],
		});
		const offered = catalogImportParts(chain).filter((candidate) => candidate.kind === 'vocabulary');
		expect(offered.map((candidate) => candidate.key)).toEqual([
			'vocabulary:character/category/主角',
			'vocabulary:character/category/主角/主角',
		]);
		expect(offered[1]?.requires).toEqual(['vocabulary:character/category/主角']);
		expect(offered[1]?.sourcePath).toMatch(/\/主角\/主角\/主角\.md$/u);
	});

	it('offers no step that says nothing', () => {
		const silent = contents(ZH, {
			steps: [{ step: 2, path: `${ZH.rootPath}/10_概要/12_一段话.md`, sections: { 'one-paragraph-summary': ' ' } }],
		});
		expect(catalogImportParts(silent)).toEqual([]);
	});

	it('lists the steps, then the members by rank, then everything else in dialog order', () => {
		const keys = parts.map((candidate) => candidate.key);
		expect(keys.slice(0, 6)).toEqual([KEYS.step, KEYS.ali, KEYS.bob, KEYS.opening, KEYS.dawn, KEYS.wolves]);
		expect(keys.indexOf(KEYS.houses)).toBeLessThan(keys.indexOf(KEYS.stark));
		expect(keys.indexOf(KEYS.major)).toBeLessThan(keys.indexOf(KEYS.injured));
		expect(keys.slice(-11)).toEqual([
			KEYS.chapterOne,
			KEYS.chapterTwo,
			KEYS.task,
			KEYS.thread,
			KEYS.revisionOne,
			KEYS.revisionTwo,
			KEYS.sticky,
			KEYS.view,
			KEYS.timeline,
			KEYS.sheet,
			KEYS.sheetTemplate,
		]);
		expect(keys.indexOf(KEYS.template)).toBeLessThan(keys.indexOf(KEYS.picture));
	});

	it('a member requires its own nodes and pictures, the role left out, and a node requires its parent', () => {
		expect(part(KEYS.ali).requires).toEqual([KEYS.stark, KEYS.injured, KEYS.picture]);
		expect(part(KEYS.bob).requires).toEqual([]);
		expect(part(KEYS.stark).requires).toEqual([KEYS.houses]);
		expect(part(KEYS.houses).requires).toEqual([]);
		expect(part(KEYS.ali).group).toBe('character');
		expect(part(KEYS.wolves).group).toBe('势力');
		expect(part(KEYS.stark).bucket).toBe('character/category');
		expect(part(KEYS.template).bucket).toBe('character');
	});

	it('names what a part points at, field by field, and never a link it cannot place', () => {
		expect(part(KEYS.ali).links).toEqual([{ key: KEYS.bob, field: 'record' }]);
		expect(part(KEYS.opening).links).toEqual([
			{ key: KEYS.ali, field: 'pov' },
			{ key: KEYS.ali, field: 'cast' },
			{ key: KEYS.bob, field: 'cast' },
			{ key: KEYS.dawn, field: 'time' },
			{ key: KEYS.chapterOne, field: 'linked-manuscript' },
		]);
		expect(part(KEYS.wolves).links).toEqual([{ key: KEYS.dawn, field: 'time-span' }]);
		expect(part(KEYS.task).links).toEqual([{ key: KEYS.ali, field: 'related' }]);
		expect(part(KEYS.thread).links).toEqual([
			{ key: KEYS.ali, field: 'related' },
			{ key: KEYS.chapterOne, field: 'chapter' },
			{ key: KEYS.chapterTwo, field: 'chapter' },
		]);
		expect(part(KEYS.revisionTwo).links).toEqual([{ key: KEYS.chapterTwo, field: 'chapter' }]);
		expect(part(KEYS.view).links).toEqual([
			{ key: KEYS.ali, field: 'placement' },
			{ key: KEYS.task, field: 'record' },
			{ key: KEYS.chapterOne, field: 'file' },
			{ key: KEYS.bob, field: 'placement' },
		]);
		expect(part(KEYS.timeline).links).toEqual([
			{ key: KEYS.ali, field: 'binding' },
			{ key: KEYS.dawn, field: 'time' },
			{ key: KEYS.opening, field: 'scene' },
		]);
		expect(part(KEYS.sheet).links).toEqual([{ key: KEYS.opening, field: 'scene' }]);
	});

	it('ticks everything by default but the manuscript and the revisions on it', () => {
		const off = parts.filter((candidate) => !candidate.defaultSelected).map((candidate) => candidate.key);
		expect(off).toEqual([KEYS.chapterOne, KEYS.chapterTwo, KEYS.revisionOne, KEYS.revisionTwo]);
		expect(part(KEYS.sticky).name).toBe('记得改结尾');
		expect(part(KEYS.step).name).toBe('1');
		expect(part(KEYS.stark).name).toBe('家族/史塔克');
	});

	it('closes a selection over what it requires, and names what it links to one hop out', () => {
		expect(closeSelection(parts, [KEYS.ali, 'nothing:here'])).toEqual(
			new Set([KEYS.ali, KEYS.picture, KEYS.injured, KEYS.stark, KEYS.houses]),
		);
		expect(linkedParts(parts, new Set([KEYS.opening]))).toEqual([KEYS.ali, KEYS.bob, KEYS.dawn, KEYS.chapterOne]);
		expect(linkedParts(parts, new Set([KEYS.opening, KEYS.ali, KEYS.bob, KEYS.dawn, KEYS.chapterOne]))).toEqual([]);
	});
});

// ---- Paths and words ----------------------------------------------------------------

describe('paths and words', () => {
	it('reads a taxonomy path below a root the way the service does', () => {
		const root = rootOf(ZH, 'character', 'category');
		expect(taxonomyBelow(`${root}/家族/史塔克/史塔克`, root)).toBe('家族/史塔克');
		expect(taxonomyBelow(`${root}/家族/史塔克/史塔克.md`, root)).toBe('家族/史塔克');
		expect(taxonomyBelow(`${root}/家族/史塔克`, root)).toBe('家族/史塔克');
		expect(taxonomyBelow(`${root}/Race/race`, root)).toBe('Race');
		expect(taxonomyBelow(root, root)).toBeNull();
		expect(taxonomyBelow(`${rootOf(ZH, 'scene', 'category')}/地点`, root)).toBeNull();
	});

	it('plans a member path from the target layout and the name, never the source stem', () => {
		expect(plannedMemberPath(EN, 'character', '阿丽')).toBe('Snowflake Projects/Book 2/30_Character/阿丽.md');
		expect(plannedMemberPath(EN, 'scene', 'A/B')).toBe('Snowflake Projects/Book 2/40_Scene/A-B.md');
		expect(plannedMemberPath(EN, '势力', '狼族')).toBeNull();
		expect(plannedMemberPath(EN, 'scene', '...')).toBeNull();
	});

	it('says a taxonomy in the target language: roles always, starters where the seat stands', () => {
		const translation = importTranslation(source(), target());
		expect(translateTaxonomy(translation, 'character', 'category', '主角/贵族')).toBe('Major/贵族');
		expect(translateTaxonomy(translation, 'character', 'category', '家族/史塔克')).toBe('家族/史塔克');
		expect(translateTaxonomy(translation, 'scene', 'category', '主角')).toBe('主角');
		expect(translateTaxonomy(translation, 'character', 'world-status', '受伤')).toBe('Injured');
		expect(translateTaxonomy(translation, 'character', 'world-status', '失踪/重伤')).toBe('Missing/重伤');
		expect(translateTaxonomy(translation, 'character', 'relationship', '盟友')).toBe('Ally');
		expect(translateTaxonomy(translation, 'scene', 'world-status', '受伤')).toBe('受伤');
		const without = importTranslation(
			source(),
			target({ vocabulary: seeded(EN).filter((candidate) => candidate.taxonomyPath !== 'Missing') }),
		);
		expect(translateTaxonomy(without, 'character', 'world-status', '失踪')).toBe('失踪');
		const same = importTranslation(target(), target());
		expect(translateTaxonomy(same, 'character', 'world-status', 'Injured')).toBe('Injured');
	});
});

// ---- Projection and standing -------------------------------------------------------

describe('projection', () => {
	const none: ImportLinkResolver = () => null;

	it('fingerprints the design, not where it is kept', () => {
		const hash = importHash({ kind: 'character', member: ali }, none);
		const moved: ImportCharacter = {
			...ali,
			path: `${folderOf(ZH, 'character')}/阿丽 (2).md`,
			worldStatus: [
				{
					label: { ...labelOf(ZH, 'character', 'world-status', '受伤'), path: 'elsewhere/受伤/受伤' },
					value: '战时',
					clauses: [{ kind: 'with', term: { kind: 'link', path: 'elsewhere/鲍勃', name: '鲍勃' } }],
				},
			],
		};
		expect(importHash({ kind: 'character', member: moved }, none)).toBe(hash);
		expect(importHash({ kind: 'character', member: { ...ali, goal: '离家' } }, none)).not.toBe(hash);
		expect(importHash({ kind: 'scene', member: opening }, none)).toBe(
			importHash({ kind: 'scene', member: { ...opening, povPath: 'elsewhere/阿丽.md', characters: ['elsewhere/阿丽.md', 'elsewhere/鲍勃.md'] } }, none),
		);
	});

	it('names a linked member by its id, so a rename elsewhere leaves a part as it was', () => {
		const before = importLinkResolver(source());
		const hash = importHash({ kind: 'character', member: ali }, before);
		const sceneHash = importHash({ kind: 'scene', member: opening }, before);
		// Bob becomes Bobby: the clause, the prose link and the cast are rewritten, path and name alike.
		const bobby = { ...bob, path: `${folderOf(ZH, 'character')}/鲍比.md`, name: '鲍比' };
		const afterRename: ImportCharacter = {
			...ali,
			worldStatus: [
				{ label: labelOf(ZH, 'character', 'world-status', '受伤'), value: '战时', clauses: [{ kind: 'with', term: linkTerm(bobby) }] },
			],
			oneParagraphStoryline: `她和[[${importPathKey(bobby.path)}|鲍勃]]同行，[[鲍勃]]也在。`,
		};
		const recast = { ...opening, characters: [ali.path, bobby.path] };
		const after = importLinkResolver(contents(ZH, { characters: [bobby, afterRename], scenes: [recast], entities: [wolves, dawn] }));
		expect(importHash({ kind: 'character', member: afterRename }, after)).toBe(hash);
		expect(importHash({ kind: 'scene', member: recast }, after)).toBe(sceneHash);
		// A link to no member of the project is its words, and other words are a change.
		const elsewhere: ImportCharacter = {
			...afterRename,
			oneParagraphStoryline: `她和[[elsewhere/鲍比|鲍勃]]同行，[[鲍勃]]也在。`,
		};
		expect(importHash({ kind: 'character', member: elsewhere }, after)).not.toBe(hash);
		expect(importHash({ kind: 'character', member: { ...afterRename, goal: '离家' } }, after)).not.toBe(hash);
	});

	it('classifies against provenance', () => {
		const entry: ImportProvenanceEntry = {
			kind: 'character',
			targetId: 'copy',
			targetPath: null,
			targetName: 'A',
			sourceProjectId: 'p',
			sourceId: 's',
			sourcePath: null,
			sourceHash: 'then',
			copyHash: 'written',
			importedAt: 1,
		};
		const hashes = (sourceHash: string, copyHash: string): { source: () => string; copy: () => string } => ({
			source: () => sourceHash,
			copy: () => copyHash,
		});
		expect(classifyImportStanding(null, true, hashes('then', 'written'))).toBe('new');
		expect(classifyImportStanding(entry, false, hashes('then', 'written'))).toBe('new');
		expect(classifyImportStanding(entry, true, hashes('then', 'edited'))).toBe('unchanged');
		expect(classifyImportStanding(entry, true, hashes('now', 'written'))).toBe('update');
		expect(classifyImportStanding(entry, true, hashes('now', 'edited'))).toBe('conflict');
	});
});

describe('inspectImport', () => {
	const alice1 = character(EN1, 'character-alice-1', 'Alice', 1024, { goal: 'Find the key' });
	const bob1 = character(EN1, 'character-bob-1', 'Bob', 2048, { goal: 'Keep up' });
	const alice2 = character(EN, 'character-alice-2', 'alice', 1024);
	const bob2 = character(EN, 'character-bob-2', 'Bob', 2048, { goal: 'Keep up' });
	const carol2 = character(EN, 'character-carol-2', 'Carol', 3072);
	const task2: Task = { ...task, id: 'task-2', related: [] };
	const entry = (overrides: Partial<ImportProvenanceEntry>): ImportProvenanceEntry => ({
		kind: 'character',
		targetId: null,
		targetPath: null,
		targetName: '',
		sourceProjectId: EN1.id,
		sourceId: '',
		sourcePath: null,
		sourceHash: '',
		copyHash: '',
		importedAt: 1,
		...overrides,
	});
	const bobEntry = (copy: ImportCharacter): ImportProvenanceEntry =>
		entry({
			targetId: copy.id,
			targetPath: copy.path,
			targetName: copy.name,
			sourceId: bob1.id,
			sourcePath: bob1.path,
			sourceHash: importHash({ kind: 'character', member: bob1 }, importLinkResolver(book1())),
			copyHash: importHash({ kind: 'character', member: copy }, importLinkResolver(book2())),
		});
	const provenance = (entries: ImportProvenanceEntry[]): ImportProvenanceDocument =>
		rememberChoices(
			recordImports(emptyImportProvenanceDocument(), entries) ?? emptyImportProvenanceDocument(),
			EN1.id,
			{ parts: ['character:character-bob-1'], clashPolicy: 'replace', at: 9 },
		);
	const book1 = (overrides: Partial<ImportCharacter> = {}): ImportProjectContents =>
		contents(EN1, { characters: [alice1, { ...bob1, ...overrides }], tasks: [{ ...task, id: 'task-1', related: [] }] });
	const book2 = (overrides: Partial<ImportCharacter> = {}): ImportProjectContents =>
		contents(EN, { characters: [alice2, { ...bob2, ...overrides }, carol2], tasks: [task2], vocabulary: seeded(EN) });

	it('finds a namesake, a copy unchanged, a part gone from the source, and the last choices', () => {
		const inspection = inspect(
			book1(),
			book2(),
			{
				provenance: provenance([
					bobEntry(bob2),
					entry({ sourceId: 'character-carol-1', targetId: carol2.id, targetPath: carol2.path, targetName: 'Carol' }),
					entry({ kind: 'task', sourceId: 'task-1', targetId: 'task-2', targetName: '改开头' }),
				]),
				takenPaths: ['Snowflake Projects/Book 2/30_Character/Alice.md'],
			},
		);
		expect(inspection.standing.get('character:character-alice-1')).toEqual({
			kind: 'existing',
			targetId: alice2.id,
			targetPath: alice2.path,
			targetName: 'alice',
		});
		expect(inspection.standing.get('character:character-bob-1')).toEqual({
			kind: 'unchanged',
			targetId: bob2.id,
			targetPath: bob2.path,
			targetName: 'Bob',
		});
		expect(inspection.standing.get('task:task-1')).toEqual({ kind: 'unchanged', targetId: 'task-2', targetPath: null, targetName: '改开头' });
		expect(inspection.gone).toEqual([{ kind: 'character', name: 'Carol', targetId: carol2.id, targetPath: carol2.path }]);
		expect(inspection.lastChoices).toEqual({ parts: ['character:character-bob-1'], clashPolicy: 'replace', at: 9 });
		expect(inspection.takenPaths.has('snowflake projects/book 2/30_character/alice.md')).toBe(true);
	});

	it('tells a source that moved from a copy that was edited, and starts over when the copy is gone', () => {
		const held = provenance([bobEntry(bob2)]);
		expect(inspect(book1({ goal: 'Keep ahead' }), book2(), { provenance: held }).standing.get('character:character-bob-1')?.kind).toBe('update');
		expect(inspect(book1({ goal: 'Keep ahead' }), book2({ goal: 'Lead' }), { provenance: held }).standing.get('character:character-bob-1')?.kind).toBe('conflict');
		expect(inspect(book1(), book2({ goal: 'Lead' }), { provenance: held }).standing.get('character:character-bob-1')?.kind).toBe('unchanged');
		const ghost = provenance([bobEntry({ ...bob2, id: 'character-ghost' })]);
		expect(inspect(book1(), book2(), { provenance: ghost }).standing.get('character:character-bob-1')).toEqual({
			kind: 'existing',
			targetId: bob2.id,
			targetPath: bob2.path,
			targetName: 'Bob',
		});
		expect(inspect(book1(), contents(EN), { provenance: ghost }).standing.get('character:character-bob-1')).toEqual({ kind: 'new' });
		expect(inspect(book1(), contents(EN), { provenance: ghost }).gone).toEqual([]);
	});

	it('knows a node and a step text that already stand, in either language', () => {
		const inspection = inspect(source(), target({ steps: [{ step: 1, path: 'Book 2/step1.md', sections: { genre: 'Fantasy' } }] }));
		// A seeded word with nothing to say about itself is already said here.
		expect(inspection.standing.get(KEYS.major)).toEqual({
			kind: 'unchanged',
			targetId: null,
			targetPath: `${importNodePath(rootOf(EN, 'character', 'category'), 'Major')}.md`,
			targetName: 'Major',
		});
		expect(inspection.standing.get(KEYS.injured)?.kind).toBe('unchanged');
		expect(inspection.standing.get(KEYS.stark)).toEqual({ kind: 'new' });
		expect(inspection.standing.get(KEYS.step)).toEqual({ kind: 'existing', targetId: null, targetPath: 'Book 2/step1.md', targetName: '1' });
		expect(inspect(source(), target()).standing.get(KEYS.step)).toEqual({ kind: 'new' });
	});

	it('tells a namesake that says the same from one that says something else', () => {
		const described = contents(ZH, {
			vocabulary: [node(ZH, 'character', 'category', '主角', '故事的中心')],
			steps: [stepOne],
		});
		expect(inspect(described, target()).standing.get(KEYS.major)?.kind).toBe('existing');
		const agreeing = target({
			vocabulary: [...seeded(EN).filter((candidate) => candidate.taxonomyPath !== 'Major'), node(EN, 'character', 'category', 'Major', '故事的中心')],
			steps: [{ step: 1, path: 'Book 2/step1.md', sections: { ...stepOne.sections } }],
		});
		const inspection = inspect(described, agreeing);
		expect(inspection.standing.get(KEYS.major)?.kind).toBe('unchanged');
		expect(inspection.standing.get(KEYS.step)).toEqual({ kind: 'unchanged', targetId: null, targetPath: 'Book 2/step1.md', targetName: '1' });
	});
});

// ---- Planning -------------------------------------------------------------------------

describe('planImport', () => {
	it('creates the default selection with fresh ids, planned paths and ranks after the target', () => {
		const inspection = inspect(source(), target());
		const { plan, mapping } = planImport(inspection, { parts: defaults(inspection), clashPolicy: 'skip' }, hooks());
		expect(entryOf(plan, KEYS.ali)).toMatchObject({
			action: 'create',
			targetId: 'character-1',
			targetPath: 'Snowflake Projects/Book 2/30_Character/阿丽.md',
			targetName: '阿丽',
			rank: 1024,
		});
		expect(entryOf(plan, KEYS.bob)).toMatchObject({ action: 'create', targetId: 'character-2', rank: 2048 });
		expect(entryOf(plan, KEYS.opening)).toMatchObject({ action: 'create', targetId: 'scene-1', targetPath: 'Snowflake Projects/Book 2/40_Scene/开场.md', rank: 1024 });
		expect(entryOf(plan, KEYS.dawn)).toMatchObject({ action: 'create', targetId: 'entity-1', targetPath: 'Snowflake Projects/Book 2/60_Worldbuilding/61_Time/黎明.md', rank: 1024 });
		expect(entryOf(plan, KEYS.wolves)).toMatchObject({ action: 'create', targetId: 'entity-2', targetPath: null, rank: 1024 });
		expect(plan.kindsToCreate).toEqual([{ id: '势力', folderName: '64_势力', icon: 'flag', description: 'About 势力' }]);
		// Nodes: the seeded ones already stand and say nothing, the author's own are made under the target's root.
		expect(entryOf(plan, KEYS.major)).toMatchObject({ action: 'skip', reason: 'unchanged', targetName: 'Major' });
		expect(entryOf(plan, KEYS.injured)).toMatchObject({ action: 'skip', reason: 'unchanged', targetName: 'Injured' });
		expect(entryOf(plan, KEYS.houses)).toMatchObject({
			action: 'create',
			targetName: '家族',
			targetPath: `${rootOf(EN, 'character', 'category')}/家族/家族.md`,
		});
		expect(entryOf(plan, KEYS.stark)).toMatchObject({ action: 'create', targetPath: `${rootOf(EN, 'character', 'category')}/家族/史塔克/史塔克.md` });
		expect(entryOf(plan, KEYS.template)).toMatchObject({ action: 'create', targetPath: `${fieldRootOf(EN, 'character')}/基本资料.md` });
		expect(entryOf(plan, KEYS.picture)).toMatchObject({ action: 'create', targetPath: null });
		expect(entryOf(plan, KEYS.step)).toMatchObject({ action: 'create', targetPath: 'Snowflake Projects/Book 2/10_Summary/11_One_Sentence.md' });
		expect(entryOf(plan, KEYS.task)).toMatchObject({ action: 'create', targetId: 'task-1' });
		expect(entryOf(plan, KEYS.thread)).toMatchObject({ action: 'create', targetId: 'foreshadowing-1' });
		expect(entryOf(plan, KEYS.sticky)).toMatchObject({ action: 'create', targetId: null });
		expect(entryOf(plan, KEYS.view)).toMatchObject({ action: 'create', targetName: '构思' });
		expect(entryOf(plan, KEYS.timeline)).toMatchObject({ action: 'create', targetName: '主线' });
		expect(entryOf(plan, KEYS.sheet)).toMatchObject({ action: 'create', targetName: '三幕' });
		expect(entryOf(plan, KEYS.sheetTemplate)).toMatchObject({ action: 'create' });
		expect(plan.entries.some((entry) => entry.part.key === KEYS.chapterOne)).toBe(false);
		expect(plan.entries.some((entry) => entry.part.key === KEYS.revisionOne)).toBe(false);
		expect(mapping.ids.get('character-ali')).toBe('character-1');
		expect(mapping.names.get('character-ali')).toBe('阿丽');
		expect(mapping.paths.get(importPathKey(ali.path))).toBe('Snowflake Projects/Book 2/30_Character/阿丽.md');
		expect(mapping.paths.get(importPathKey(node(ZH, 'character', 'world-status', '受伤').selfPath))).toBe(
			`${rootOf(EN, 'character', 'world-status')}/Injured/Injured.md`,
		);
		expect(plan.counts.character).toEqual({ create: 2, replace: 0, skip: 0 });
		expect(plan.counts.vocabulary.create).toBe(2);
		expect(plan.counts.chapter).toEqual({ create: 0, replace: 0, skip: 0 });
	});

	it('reports links to parts outside the selection, and offers them', () => {
		const inspection = inspect(source(), target());
		const { plan } = planImport(inspection, { parts: defaults(inspection), clashPolicy: 'skip' }, hooks());
		expect(plan.droppedLinks).toEqual([
			{ ownerKey: KEYS.opening, link: { key: KEYS.chapterOne, field: 'linked-manuscript' }, reason: 'not-selected' },
			{ ownerKey: KEYS.thread, link: { key: KEYS.chapterOne, field: 'chapter' }, reason: 'not-selected' },
			{ ownerKey: KEYS.thread, link: { key: KEYS.chapterTwo, field: 'chapter' }, reason: 'not-selected' },
			{ ownerKey: KEYS.view, link: { key: KEYS.chapterOne, field: 'file' }, reason: 'not-selected' },
		]);
		expect(plan.unselectedLinks).toEqual([KEYS.chapterOne, KEYS.chapterTwo]);
	});

	it('skips a namesake by default and answers links with it, or replaces it keeping its id, path and name', () => {
		const standing = character(EN, 'character-bob-en', '鲍勃', 2048);
		const inspection = inspect(source(), target({ characters: [standing] }));
		const skipped = planImport(inspection, { parts: new Set([KEYS.ali, KEYS.bob, KEYS.opening]), clashPolicy: 'skip' }, hooks());
		expect(entryOf(skipped.plan, KEYS.bob)).toMatchObject({
			action: 'skip',
			reason: 'name-taken',
			targetId: 'character-bob-en',
			targetPath: standing.path,
			targetName: '鲍勃',
		});
		expect(entryOf(skipped.plan, KEYS.ali)).toMatchObject({ action: 'create', rank: 3072 });
		expect(skipped.mapping.ids.get('character-bob')).toBe('character-bob-en');
		expect(skipped.plan.droppedLinks).toEqual([
			{ ownerKey: KEYS.opening, link: { key: KEYS.dawn, field: 'time' }, reason: 'not-selected' },
			{ ownerKey: KEYS.opening, link: { key: KEYS.chapterOne, field: 'linked-manuscript' }, reason: 'not-selected' },
		]);
		const replaced = planImport(inspection, { parts: new Set([KEYS.bob]), clashPolicy: 'replace' }, hooks());
		expect(entryOf(replaced.plan, KEYS.bob)).toEqual({
			part: entryOf(replaced.plan, KEYS.bob).part,
			action: 'replace',
			reason: null,
			targetId: 'character-bob-en',
			targetPath: standing.path,
			targetName: '鲍勃',
			rank: null,
		});
		expect(replaced.plan.counts.character).toEqual({ create: 0, replace: 1, skip: 0 });
	});

	it('leaves a copy alone while its source is unchanged, whatever the policy', () => {
		const copy = character(EN, 'character-bob-en', '鲍勃', 1024, { type: 'supporting' });
		const held =
			recordImports(emptyImportProvenanceDocument(), [
				{
					kind: 'character',
					targetId: copy.id,
					targetPath: copy.path,
					targetName: '鲍勃',
					sourceProjectId: ZH.id,
					sourceId: bob.id,
					sourcePath: bob.path,
					sourceHash: importHash({ kind: 'character', member: bob }, importLinkResolver(source())),
					copyHash: importHash({ kind: 'character', member: copy }, importLinkResolver(target({ characters: [copy] }))),
					importedAt: 1,
				},
			]) ?? emptyImportProvenanceDocument();
		const inspection = inspect(source(), target({ characters: [copy] }), { provenance: held });
		for (const clashPolicy of ['skip', 'replace'] as const) {
			const { plan } = planImport(inspection, { parts: new Set([KEYS.bob]), clashPolicy }, hooks());
			expect(entryOf(plan, KEYS.bob)).toMatchObject({ action: 'skip', reason: 'unchanged', targetId: copy.id });
		}
	});

	it('skips a note whose file name is taken, and brings nothing it would have required', () => {
		const inspection = inspect(source(), target(), { takenPaths: ['Snowflake Projects/Book 2/30_Character/阿丽.md'] });
		const { plan, mapping } = planImport(inspection, { parts: new Set([KEYS.ali]), clashPolicy: 'replace' }, hooks());
		expect(plan.entries.map((entry) => [entry.part.key, entry.action, entry.reason])).toEqual([[KEYS.ali, 'skip', 'file-name-taken']]);
		expect(mapping.ids.has('character-ali')).toBe(false);
	});

	it('tells two notes folding to one name apart from two folding to one file name', () => {
		const dan = character(EN1, 'character-dan-1', 'Dan', 1024);
		const dan2 = character(EN1, 'character-dan-2', 'dan', 2048);
		const slash = character(EN1, 'character-ef-1', 'E/F', 3072);
		const dash = character(EN1, 'character-ef-2', 'E-F', 4096);
		const inspection = inspect(contents(EN1, { characters: [dan, dan2, slash, dash] }), contents(EN));
		const { plan } = planImport(inspection, { parts: defaults(inspection), clashPolicy: 'replace' }, hooks());
		expect(plan.entries.map((entry) => [entry.part.name, entry.action, entry.reason])).toEqual([
			['Dan', 'create', null],
			['dan', 'skip', 'name-taken'],
			['E/F', 'create', null],
			['E-F', 'skip', 'file-name-taken'],
		]);
		expect(entryOf(plan, 'character:character-ef-1').targetPath).toBe('Snowflake Projects/Book 2/30_Character/E-F.md');
	});

	it('appends chapters under free titles, and lands a revision only with its chapter', () => {
		const inspection = inspect(source(), target({ chapters: [{ path: `${EN.draftFolder}/第一章.md`, title: '第一章' }] }));
		const { plan, mapping } = planImport(
			inspection,
			{ parts: new Set([KEYS.opening, KEYS.chapterOne, KEYS.thread, KEYS.revisionOne, KEYS.revisionTwo]), clashPolicy: 'skip' },
			hooks(),
		);
		expect(entryOf(plan, KEYS.chapterOne)).toMatchObject({ action: 'create', targetName: '第一章 2', targetPath: `${EN.draftFolder}/第一章 2.md` });
		expect(entryOf(plan, KEYS.revisionOne)).toMatchObject({ action: 'create', targetId: 'revision-1' });
		expect(entryOf(plan, KEYS.revisionTwo)).toMatchObject({ action: 'skip', reason: 'no-chapter' });
		expect(mapping.paths.get(importPathKey(chapterOne.path))).toBe(`${EN.draftFolder}/第一章 2.md`);
		expect(mapping.names.get(chapterOne.path)).toBe('第一章 2');
		expect(plan.droppedLinks).toEqual([
			{ ownerKey: KEYS.opening, link: { key: KEYS.ali, field: 'pov' }, reason: 'not-selected' },
			{ ownerKey: KEYS.opening, link: { key: KEYS.ali, field: 'cast' }, reason: 'not-selected' },
			{ ownerKey: KEYS.opening, link: { key: KEYS.bob, field: 'cast' }, reason: 'not-selected' },
			{ ownerKey: KEYS.opening, link: { key: KEYS.dawn, field: 'time' }, reason: 'not-selected' },
			{ ownerKey: KEYS.thread, link: { key: KEYS.ali, field: 'related' }, reason: 'not-selected' },
			{ ownerKey: KEYS.thread, link: { key: KEYS.chapterTwo, field: 'chapter' }, reason: 'not-selected' },
		]);
	});

	it('remembers a chapter imported before, so a revision on it lands without the chapter being ticked again', () => {
		const copyPath = `${EN.draftFolder}/第一章.md`;
		const held =
			recordImports(emptyImportProvenanceDocument(), [
				{
					kind: 'chapter',
					targetId: null,
					targetPath: copyPath,
					targetName: '第一章',
					sourceProjectId: ZH.id,
					sourceId: chapterOne.path,
					sourcePath: chapterOne.path,
					sourceHash: 'a',
					copyHash: 'b',
					importedAt: 1,
				},
			]) ?? emptyImportProvenanceDocument();
		const inspection = inspect(source(), target({ chapters: [{ path: copyPath, title: '第一章' }] }), { provenance: held });
		expect(inspection.standing.get(KEYS.chapterOne)?.kind).toBe('unchanged');
		const { plan, mapping } = planImport(inspection, { parts: new Set([KEYS.chapterOne, KEYS.revisionOne]), clashPolicy: 'skip' }, hooks());
		expect(entryOf(plan, KEYS.chapterOne)).toMatchObject({ action: 'skip', reason: 'unchanged', targetPath: copyPath });
		expect(entryOf(plan, KEYS.revisionOne)).toMatchObject({ action: 'create' });
		expect(mapping.paths.get(importPathKey(chapterOne.path))).toBe(copyPath);
	});

	it('fills an empty step text, and treats a written one as a namesake', () => {
		const empty = inspect(source(), target());
		expect(entryOf(planImport(empty, { parts: new Set([KEYS.step]), clashPolicy: 'skip' }, hooks()).plan, KEYS.step).action).toBe('create');
		const written = inspect(source(), target({ steps: [{ step: 1, path: 'Book 2/step1.md', sections: { genre: 'Fantasy' } }] }));
		expect(entryOf(planImport(written, { parts: new Set([KEYS.step]), clashPolicy: 'skip' }, hooks()).plan, KEYS.step)).toMatchObject({
			action: 'skip',
			reason: 'name-taken',
		});
		expect(entryOf(planImport(written, { parts: new Set([KEYS.step]), clashPolicy: 'replace' }, hooks()).plan, KEYS.step)).toMatchObject({
			action: 'replace',
			targetPath: 'Book 2/step1.md',
		});
	});

	it('frees the name of a view, a timeline or a beat sheet, and keeps a template by the policy', () => {
		const inspection = inspect(
			source(),
			target({
				freeformViews: [{ ...view, id: 'freeform-view-en', placements: [], edges: [] }],
				timelines: [{ ...timeline, id: 'timeline-en', binding: null, times: [] }],
				beatSheets: [{ ...sheet, id: 'beat-sheet-en', acts: [] }],
				beatSheetTemplates: [{ name: '三幕', description: '', structure: { acts: [] } }],
			}),
		);
		const { plan } = planImport(inspection, { parts: new Set([KEYS.view, KEYS.timeline, KEYS.sheet, KEYS.sheetTemplate]), clashPolicy: 'skip' }, hooks());
		expect(entryOf(plan, KEYS.view).targetName).toBe('构思 2');
		expect(entryOf(plan, KEYS.timeline).targetName).toBe('主线 2');
		expect(entryOf(plan, KEYS.sheet).targetName).toBe('三幕 2');
		expect(entryOf(plan, KEYS.sheetTemplate)).toMatchObject({ action: 'skip', reason: 'name-taken' });
		const replaced = planImport(inspection, { parts: new Set([KEYS.sheetTemplate]), clashPolicy: 'replace' }, hooks());
		expect(entryOf(replaced.plan, KEYS.sheetTemplate).action).toBe('replace');
		// A template this source brought is known by its name, the one thing a template is kept by.
		const remembered = inspect(source(), target({ beatSheetTemplates: [{ name: '三幕', description: '', structure: { acts: [] } }] }), {
			provenance:
				recordImports(emptyImportProvenanceDocument(), [
					{
						kind: 'beat-sheet-template',
						targetId: null,
						targetPath: null,
						targetName: '三幕',
						sourceProjectId: ZH.id,
						sourceId: '三幕',
						sourcePath: null,
						sourceHash: 'h',
						copyHash: 'h',
						importedAt: 1,
					},
				]) ?? emptyImportProvenanceDocument(),
		});
		expect(remembered.standing.get(KEYS.sheetTemplate)?.kind).toBe('unchanged');
		expect(entryOf(planImport(remembered, { parts: new Set([KEYS.sheetTemplate]), clashPolicy: 'replace' }, hooks()).plan, KEYS.sheetTemplate)).toMatchObject({
			action: 'skip',
			reason: 'unchanged',
		});
	});
});

// ---- Rewriting -------------------------------------------------------------------------

const planned = (
	keys: string[],
	targetContents: ImportProjectContents = target(),
	options: { provenance?: ImportProvenanceDocument } = {},
): { inspection: ImportInspection; mapping: ImportMapping } => {
	const inspection = inspect(source(), targetContents, options);
	const { mapping } = planImport(inspection, { parts: new Set(keys), clashPolicy: 'skip' }, hooks());
	return { inspection, mapping };
};
const landedPicture = `${galleryOf(EN, 'character')}/portrait.png`;
const ALI_PATH = 'Snowflake Projects/Book 2/30_Character/阿丽';
const BOB_PATH = 'Snowflake Projects/Book 2/30_Character/鲍勃';

describe('rewriting members', () => {
	it('says a character in the target\'s paths and words', () => {
		const { inspection, mapping } = planned([KEYS.ali, KEYS.bob]);
		mapping.paths.set(importPathKey(picture.path), landedPicture);
		const context = importRewriteContext(inspection.source, inspection.target, mapping);
		const { value, dropped } = characterInputOf(ali, context);
		expect(dropped).toEqual([]);
		expect(value.type).toBe('major');
		expect(value.categoryPaths).toEqual(['家族/史塔克']);
		expect(value.worldStatus).toEqual([
			{
				label: { path: `${rootOf(EN, 'character', 'world-status')}/Injured/Injured`, display: 'Injured' },
				value: '战时',
				clauses: [{ kind: 'with', term: { kind: 'link', path: BOB_PATH, name: '鲍勃' } }],
			},
		]);
		expect(value.gallery).toEqual([`[[${landedPicture}]]`]);
		expect(value.galleryMain).toBe(`[[${landedPicture}]]`);
		expect(value.oneParagraphStoryline).toBe(`她和[[${BOB_PATH}|鲍勃]]同行，[[鲍勃]]也在。`);
		expect(value.goal).toBe('回家');
		expect(value.color).toBeNull();
	});

	it('reduces a record term to its name where the note it named is not coming, and keeps a link out of the project', () => {
		const { inspection, mapping } = planned([KEYS.ali]);
		const context = importRewriteContext(inspection.source, inspection.target, mapping);
		const { value, dropped } = characterInputOf(ali, context);
		expect(value.worldStatus[0]?.clauses).toEqual([{ kind: 'with', term: { kind: 'text', text: '鲍勃' } }]);
		expect(dropped).toEqual([
			{ field: 'gallery', target: picture.path },
			{ field: 'record', target: importPathKey(bob.path) },
		]);
		expect(value.gallery).toEqual([]);
		expect(value.galleryMain).toBeNull();
		expect(value.oneParagraphStoryline).toBe(ali.oneParagraphStoryline);
		const outside: ImportCharacter = {
			...ali,
			worldStatus: [{ label: ali.worldStatus[0]?.label ?? labelOf(ZH, 'character', 'world-status', '受伤'), value: '', clauses: [{ kind: 'at', term: { kind: 'link', path: 'Lore/Winterfell', name: 'Winterfell' } }] }],
		};
		expect(characterInputOf(outside, context).value.worldStatus[0]?.clauses).toEqual([{ kind: 'at', term: { kind: 'link', path: 'Lore/Winterfell', name: 'Winterfell' } }]);
	});

	it('points a scene at the copies of its cast, time and chapter, and degrades what has no copy', () => {
		const whole = planned([KEYS.ali, KEYS.bob, KEYS.opening, KEYS.dawn, KEYS.chapterOne]);
		const context = importRewriteContext(whole.inspection.source, whole.inspection.target, whole.mapping);
		const { value, dropped } = sceneInputOf(opening, context);
		expect(dropped).toEqual([]);
		expect(value.title).toBe('开场');
		expect(value.povPath).toBe(`${ALI_PATH}.md`);
		expect(value.characters).toEqual([`${ALI_PATH}.md`, `${BOB_PATH}.md`]);
		expect(value.times).toEqual(['[[Snowflake Projects/Book 2/60_Worldbuilding/61_Time/黎明|黎明]]']);
		expect(value.locations).toEqual(['北方']);
		expect(value.linkedManuscript).toEqual([`[[${EN.draftFolder}/第一章#开头|第一章]]`]);
		expect(value.events).toBe(`[[${ALI_PATH}]] 到达。`);

		const alone = planned([KEYS.opening]);
		const bare = sceneInputOf(opening, importRewriteContext(alone.inspection.source, alone.inspection.target, alone.mapping));
		expect(bare.value.povPath).toBe('omniscient');
		expect(bare.value.characters).toEqual([]);
		expect(bare.value.times).toEqual(['黎明']);
		expect(bare.value.linkedManuscript).toEqual([]);
		expect(bare.value.events).toBe(opening.events);
		expect(bare.dropped.map((drop) => drop.field)).toEqual(['pov', 'cast', 'cast', 'linked-manuscript', 'time']);
		expect(sceneInputOf({ ...opening, povPath: 'multiple' }, importRewriteContext(alone.inspection.source, alone.inspection.target, alone.mapping)).value.povPath).toBe('multiple');
	});

	it('carries an entity\'s span across, and a bare span as it is', () => {
		const { inspection, mapping } = planned([KEYS.wolves, KEYS.dawn]);
		const context = importRewriteContext(inspection.source, inspection.target, mapping);
		const { value, dropped } = entityInputOf(wolves, context);
		expect(dropped).toEqual([]);
		expect(value.kind).toBe('势力');
		expect(value.timeStart).toBe('[[Snowflake Projects/Book 2/60_Worldbuilding/61_Time/黎明|黎明]]');
		expect(value.timeEnd).toBe('');
		expect(entityInputOf({ ...dawn, timeStart: '春' }, context).value.timeStart).toBe('春');
	});

	it('rewrites full-path links in prose with their heading and alias, and leaves bare and foreign ones', () => {
		const { mapping } = planned([KEYS.ali, KEYS.bob]);
		mapping.paths.set(importPathKey(picture.path), landedPicture);
		const text = [
			`[[${importPathKey(bob.path)}#生平|他]]`,
			`![[${picture.path}]]`,
			'[[鲍勃]]',
			'[[Lore/Winterfell|the castle]]',
			`[[${importPathKey(dawn.path)}]]`,
		].join(' ');
		expect(rewriteProseLinks(text, mapping)).toBe(
			[`[[${BOB_PATH}#生平|他]]`, `![[${landedPicture}]]`, '[[鲍勃]]', '[[Lore/Winterfell|the castle]]', `[[${importPathKey(dawn.path)}]]`].join(' '),
		);
		expect(rewriteProseLinks('no links here', mapping)).toBe('no links here');
	});
});

describe('remapping tool records', () => {
	const whole = (): ImportMapping =>
		planned([KEYS.ali, KEYS.bob, KEYS.opening, KEYS.dawn, KEYS.chapterOne, KEYS.task, KEYS.thread, KEYS.revisionOne]).mapping;

	it('points a reference at the copy, by the copy\'s name', () => {
		const mapping = whole();
		expect(remapEntityRef(ref(ali, 'character'), mapping)).toEqual({ kind: 'character', id: 'character-1', name: '阿丽' });
		expect(remapEntityRef({ kind: 'time', id: 'entity-gone', name: '黄昏' }, mapping)).toBeNull();
		expect(remapTask(task, 'task-9', mapping)).toEqual({
			value: { ...task, id: 'task-9', related: [{ kind: 'character', id: 'character-1', name: '阿丽' }] },
			dropped: [],
		});
		expect(remapTask({ ...task, related: [{ kind: 'time', id: 'entity-gone', name: '黄昏' }] }, 'task-9', mapping)).toEqual({
			value: { ...task, id: 'task-9', related: [] },
			dropped: [{ field: 'related', target: 'entity-gone' }],
		});
	});

	it('moves occurrences and revisions to the chapters\' copies, dropping those whose chapter has none', () => {
		const mapping = whole();
		const { value, dropped } = remapForeshadowing(thread, 'foreshadowing-9', mapping);
		expect(value.id).toBe('foreshadowing-9');
		expect(value.occurrences).toEqual([{ ...thread.occurrences[0], path: `${EN.draftFolder}/第一章.md` }]);
		expect(dropped).toEqual([{ field: 'chapter', target: chapterTwo.path }]);
		expect(remapRevision(revisionOne, 'revision-9', mapping)).toEqual({ ...revisionOne, id: 'revision-9', path: `${EN.draftFolder}/第一章.md` });
		expect(remapRevision(revisionTwo, 'revision-9', mapping)).toBeNull();
	});

	it('remaps a timeline, dropping a time without a copy with its rows and a scene without one from its row', () => {
		const { value, dropped } = remapTimeline(timeline, '主线 2', whole());
		expect(value).toEqual({
			name: '主线 2',
			binding: { kind: 'character', id: 'character-1', name: '阿丽' },
			times: [{ timeId: 'entity-1', rows: [{ id: 'row-1', text: '', scenes: ['scene-1'] }] }],
			createdAt: 1,
			updatedAt: 1,
		});
		expect(dropped).toEqual([
			{ field: 'scene', target: 'scene-gone' },
			{ field: 'time', target: 'entity-gone' },
		]);
		const unbound = remapTimeline({ ...timeline, binding: { kind: 'character', id: 'character-gone', name: '某人' } }, '主线', whole());
		expect(unbound.value.binding).toBeNull();
		expect(unbound.dropped[unbound.dropped.length - 1]).toEqual({ field: 'binding', target: 'character-gone' });
	});

	it('remaps a beat sheet\'s rows and keeps its ids', () => {
		const { value, dropped } = remapBeatSheet(sheet, '三幕 2', whole());
		expect(dropped).toEqual([]);
		expect(value.name).toBe('三幕 2');
		expect(value.acts[0]?.beats[0]?.rows).toEqual([{ id: 'row-1', text: '', scenes: ['scene-1'] }]);
		expect(value.acts[0]?.id).toBe('act-1');
	});

	it('remaps a view: entities by copy, records dropped with their edges where absent, files by copy, viewport afresh', () => {
		const mapping = whole();
		const { value, dropped } = remapFreeformView(view, '构思 2', mapping);
		expect(dropped).toEqual([]);
		expect(value.name).toBe('构思 2');
		expect(value.placements.map((candidate) => candidate.resource)).toEqual([
			{ type: 'entity', kind: 'character', id: 'character-1', name: '阿丽' },
			{ type: 'task', id: 'task-1', name: '改开头' },
			{ type: 'file', path: '50_Manuscript/第一章.md' },
			{ type: 'text', text: '随想' },
			{ type: 'entity', kind: 'character', id: 'character-2', name: '鲍勃' },
		]);
		expect(value.edges.map((candidate) => candidate.id)).toEqual(['edge-1', 'edge-2']);
		expect(value.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
		expect(value.strays).toEqual({ placements: [], frames: [], edges: [] });

		const sparse = planned([KEYS.ali]).mapping;
		const thin = remapFreeformView(view, '构思', sparse);
		expect(thin.value.placements.map((candidate) => candidate.id)).toEqual(['placement-1', 'placement-3', 'placement-4', 'placement-5']);
		expect(thin.value.placements[1]?.resource).toEqual({ type: 'file', path: '50_正文/第一章.md' });
		expect(thin.value.placements[3]?.resource).toEqual({ type: 'entity', kind: 'character', id: bob.id, name: '鲍勃' });
		expect(thin.value.edges.map((candidate) => candidate.id)).toEqual(['edge-2']);
		expect(thin.dropped).toEqual([
			{ field: 'record', target: task.id },
			{ field: 'file', target: '50_正文/第一章.md' },
			{ field: 'placement', target: bob.id },
		]);
	});
});
