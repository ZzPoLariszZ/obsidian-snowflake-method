import type { CharacterType, StepId, StepStatus } from '../domain';
import type { MarkerIssueCode } from '../templates';
import type { ProjectStructureIssueCode } from '../services';

import type {
	CreateCharacterRequest,
	CreateProjectRequest,
	CreateSceneRequest,
	Translate,
} from './modals';

export interface ProjectOption {
	path: string;
	rootPath: string;
	projectId: string;
	title: string;
	readOnly: boolean;
	hasStructureIssues: boolean;
	hasMarkerIssues: boolean;
}

export interface CreatedProject {
	path: string;
	projectId: string;
	title: string;
	locale: 'en' | 'zh-CN';
}

export interface StepViewModel {
	id: StepId;
	title: string;
	description: string;
	status: StepStatus;
	optional: boolean;
	artifactPath: string | null;
	contentReadOnly: boolean;
	healthIssues: ManagedSectionIssueViewModel[];
}

export interface ManagedSectionIssueViewModel {
	path: string;
	sectionId: string | null;
	sectionLabel: string;
	code: MarkerIssueCode | ProjectStructureIssueCode;
	message: string;
	blocking: boolean;
	kind: 'section' | 'structure';
	stepIds: StepId[];
	canOpen: boolean;
	repairable: boolean;
	repairField: string | null;
}

export interface CharacterViewModel {
	id: string;
	path: string;
	name: string;
	rank: number;
	type: CharacterType;
	oneSentenceStoryline: string;
	oneParagraphStoryline: string;
	motivation: string;
	goal: string;
	conflict: string;
	growth: string;
	revision: string;
	readOnly: boolean;
	healthIssues: ManagedSectionIssueViewModel[];
}

export interface SceneViewModel {
	id: string;
	path: string;
	title: string;
	rank: number;
	povPath: string;
	povName: string;
	time: string;
	location: string;
	characterPaths: string[];
	conflict: string;
	events: string;
	revision: string;
	readOnly: boolean;
	healthIssues: ManagedSectionIssueViewModel[];
}

export type StepFields = Record<string, string>;

export interface ProjectDashboardModel {
	path: string;
	projectId: string;
	title: string;
	locale: 'en' | 'zh-CN';
	readOnly: boolean;
	readOnlyReason: string | null;
	steps: StepViewModel[];
	stepFields: Partial<Record<StepId, StepFields>>;
	stepRevisions: Partial<Record<StepId, string>>;
	characters: CharacterViewModel[];
	scenes: SceneViewModel[];
	structureIssues: ManagedSectionIssueViewModel[];
}

export interface RepairReportEntryViewModel {
	path: string;
	sectionId: string | null;
	sectionLabel: string;
	status: 'unchanged' | 'conflict';
	message: string;
	canOpen: boolean;
	repairable: boolean;
	repairField: string | null;
}

export interface RepairReportViewModel {
	summary: string;
	entries: RepairReportEntryViewModel[];
}

export interface DashboardHost {
	t: Translate;
	translateForProject(
		locale: 'en' | 'zh-CN' | null,
		key: string,
		vars?: Record<string, string | number>,
	): string;
	getRecentStep(): StepId;
	isReduceMotionEnabled(): boolean;
	openProjectManager(
		projectLocale: 'en' | 'zh-CN' | null,
	): Promise<void>;
	getDefaultProjectLocale(): 'en' | 'zh-CN';
	syncCertificateCelebration(
		projectId: string,
		complete: boolean,
	): Promise<boolean>;
	listProjects(): Promise<ProjectOption[]>;
	loadDashboardModel(path?: string | null): Promise<ProjectDashboardModel | null>;
	selectProject(path: string): Promise<void>;
	activateProject(
		path: string,
		locale: 'en' | 'zh-CN',
		step: StepId,
	): void;
	selectStep(step: StepId): Promise<void>;
	createProject(request: CreateProjectRequest): Promise<CreatedProject>;
	createCharacter(request: CreateCharacterRequest): Promise<void>;
	updateCharacter(id: string, request: CreateCharacterRequest): Promise<void>;
	deleteCharacter(id: string, expectedRevision: string): Promise<void>;
	createScene(request: CreateSceneRequest): Promise<void>;
	createSceneCanvas(): Promise<void>;
	updateScene(id: string, request: CreateSceneRequest): Promise<void>;
	deleteScene(id: string, expectedRevision: string): Promise<void>;
	setStepStatus(step: StepId, status: StepStatus): Promise<void>;
	saveStepFields(
		step: 1 | 2,
		fields: StepFields,
		expectedRevision: string,
	): Promise<void>;
	reorderScene(sceneId: string, targetIndex: number): Promise<void>;
	reorderCharacter(characterId: string, targetIndex: number): Promise<void>;
	openManagedFile(
		path: string,
		sectionId?: string,
		highlightSectionIds?: readonly string[],
	): Promise<void>;
	openStep(step: StepId): Promise<void>;
	checkCurrentProject(): Promise<RepairReportViewModel>;
	repairMissingStructureItem(path: string, field?: string): Promise<void>;
}
