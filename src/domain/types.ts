export const SCHEMA_VERSION = 2 as const;

/**
 * Oldest schema this build still reads and writes. Schema 1 notes keep their
 * legacy keys (character type, sectioned conflict) and every reader falls back
 * to them, so nothing forces an upgrade; the migration action is what moves a
 * project forward deliberately.
 */
export const MIN_SUPPORTED_SCHEMA_VERSION = 1 as const;

export function isWritableSchemaVersion(version: number | null): boolean {
	return (
		version !== null &&
		Number.isInteger(version) &&
		version >= MIN_SUPPORTED_SCHEMA_VERSION &&
		version <= SCHEMA_VERSION
	);
}

export const STEP_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export type StepId = (typeof STEP_IDS)[number];

export const STEP_STATUSES = [
	'not-started',
	'in-progress',
	'in-revision',
	'complete',
	'skipped',
] as const;

export type StepStatus = (typeof STEP_STATUSES)[number];

export type StepStatusMap = { [K in StepId]: StepStatus };
export type StepFingerprintMap = Partial<Record<StepId, string>>;

export const DOCUMENT_TYPES = [
	'project-metadata',
	'one-sentence-summary',
	'one-paragraph-summary',
	'plot-synopsis',
	'long-synopsis',
	'character',
	'scene',
	'worldbuilding',
	// The `_self.md` a definition node folder holds: not an entity, so it
	// never joins a kind's listing, but managed enough to carry the stamp
	// that says which project's vocabulary it belongs to.
	'definition',
	'draft',
	'material',
	'archive',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type ProjectLanguage = 'en' | 'zh-CN';
export type CharacterType = 'major' | 'supporting' | 'minor';

/**
 * Per-entity progress, the step vocabulary minus `skipped`: skipping is a
 * decision about the optional step 9, not a state an individual note can be in.
 */
export const PROGRESS_STATUSES = [
	'not-started',
	'in-progress',
	'in-revision',
	'complete',
] as const;

export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];

export const DEFAULT_PROGRESS_STATUS: ProgressStatus = 'not-started';

export const TIME_KINDS = ['point', 'period'] as const;

export type TimeKind = (typeof TIME_KINDS)[number];

/**
 * Frontmatter keys written by every managed document. Declared here rather than
 * in the service layer so template modules can reference the schema without
 * importing services, which import templates in turn.
 */
export const FRONTMATTER_KEYS = {
	schema: 'snowflake-schema',
	document: 'snowflake-document',
	projectId: 'snowflake-project-id',
	projectName: 'snowflake-project-name',
	projectLanguage: 'snowflake-project-language',
	stepStatuses: 'snowflake-step-status',
	reviewedFingerprints: 'snowflake-reviewed-fingerprints',
	draft: 'snowflake-draft',
	manuscriptSequence: 'snowflake-manuscript-sequence',
	characterId: 'snowflake-character-id',
	characterName: 'snowflake-character-name',
	characterType: 'snowflake-character-type',
	oneSentenceStoryline: 'snowflake-one-sentence-storyline',
	motivation: 'snowflake-motivation',
	goal: 'snowflake-goal',
	conflict: 'snowflake-conflict',
	growth: 'snowflake-growth',
	sceneId: 'snowflake-scene-id',
	sceneTitle: 'snowflake-scene-title',
	rank: 'snowflake-rank',
	pov: 'snowflake-pov',
	sceneTime: 'snowflake-scene-time',
	sceneLocation: 'snowflake-scene-location',
	sceneCharacters: 'snowflake-scene-characters',
	entityId: 'snowflake-entity-id',
	definitionId: 'snowflake-definition-id',
	name: 'snowflake-name',
	description: 'snowflake-description',
	// "progress" so the key can never be mistaken for the body-stored World
	// Status records, which describe the entity inside the story.
	progressStatus: 'snowflake-progress-status',
	category: 'snowflake-category',
	worldbuildingKind: 'snowflake-worldbuilding-kind',
	timeKind: 'snowflake-time-kind',
	timeStart: 'snowflake-time-start',
	timeEnd: 'snowflake-time-end',
} as const;

/**
 * Obsidian's own aliases key. Written as-is rather than under a snowflake
 * prefix because the point is what Obsidian does with it: link autocomplete
 * finds an entity by any alias.
 */
export const ALIASES_KEY = 'aliases' as const;

export interface BaseDocumentData {
	schemaVersion: typeof SCHEMA_VERSION;
	documentType: DocumentType;
	projectId: string;
}

export interface ProjectData extends BaseDocumentData {
	documentType: 'project-metadata';
	title: string;
	language: ProjectLanguage;
	stepStatuses: StepStatusMap;
	lastReviewedFingerprints: StepFingerprintMap;
	draftLink: string | null;
}

export interface CharacterData extends BaseDocumentData {
	documentType: 'character';
	characterId: string;
	name: string;
	type: CharacterType;
	oneSentenceStoryline: string;
	motivation: string;
	goal: string;
	conflict: string;
	growth: string;
	viewpointSynopsis?: string;
	profile?: string;
}

export interface SceneData extends BaseDocumentData {
	documentType: 'scene';
	sceneId: string;
	title: string;
	rank: number;
	povLink: string | null;
	time: string;
	location: string;
	characterLinks: string[];
	conflict: string;
	events: string;
	planning?: string;
}

export interface ContentDocumentData extends BaseDocumentData {
	documentType: Exclude<
		DocumentType,
		'project-metadata' | 'character' | 'scene' | 'worldbuilding'
	>;
	title: string;
	content?: string;
}

export type SnowflakeDocumentData =
	| ProjectData
	| CharacterData
	| SceneData
	| ContentDocumentData;

export function isStepId(value: unknown): value is StepId {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= 1 &&
		value <= 10
	);
}

export function isStepStatus(value: unknown): value is StepStatus {
	return (
		typeof value === 'string' &&
		(STEP_STATUSES as readonly string[]).includes(value)
	);
}

export function isDocumentType(value: unknown): value is DocumentType {
	return (
		typeof value === 'string' &&
		(DOCUMENT_TYPES as readonly string[]).includes(value)
	);
}

export function isProjectLanguage(value: unknown): value is ProjectLanguage {
	return value === 'en' || value === 'zh-CN';
}

export function isCharacterType(
	value: unknown,
): value is CharacterType {
	return value === 'major' || value === 'supporting' || value === 'minor';
}

export function isProgressStatus(value: unknown): value is ProgressStatus {
	return (
		typeof value === 'string' &&
		(PROGRESS_STATUSES as readonly string[]).includes(value)
	);
}

export function isTimeKind(value: unknown): value is TimeKind {
	return (
		typeof value === 'string' &&
		(TIME_KINDS as readonly string[]).includes(value)
	);
}
