import {
	STEP_SECTION_IDS,
	areStepPrerequisitesComplete,
	canSetStepStatus,
	getStepDefinition,
	isStepHandled,
	type EditableStepId,
	type StepId,
	type StepStatus,
} from '../../src/domain';
import { isEditableStep, stepOf, stepTextOf, stepsOf } from '../dto/project';
import { ApiError } from '../errors';
import { NOT_THE_AUTHOR, bodyOf, numberParam, revisionOf, textParam, type OperationCall, type OperationGroup } from './context';

/** The step a call names. The contract holds it to 1 through 10 before a handler sees it. */
const stepParam = (call: OperationCall): StepId => numberParam(call, 'step') as StepId;

/** The step a call names, where it is one that is written in a note of its own. */
function editableStepParam(call: OperationCall): EditableStepId {
	const step = stepParam(call);
	if (!isEditableStep(step)) {
		throw new ApiError(
			'not-found',
			`Step ${String(step)} is not written in a note of its own. Steps 1, 2, 4 and 6 are. Read characters for 3, 5 and 7, scenes for 8 and 9, and the manuscript for 10.`,
		);
	}
	return step;
}

const noteMissing = (step: StepId): ApiError =>
	new ApiError(
		'not-found',
		`The note of step ${String(step)} is missing from the project. getProjectHealth says what is wrong, and repairProject puts it back.`,
	);

/**
 * The ten steps, read and changed. A step's status is told as the project keeps it.
 * The dashboard, when it is opened, takes a finished step back into
 * revision where the steps before it have changed. A reading through the
 * API changes nothing, so it tells the same thing in `needsReview` and
 * leaves the status as the author set it.
 */
export const stepOperations: OperationGroup = {
	listSteps: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		return { status: 200, body: { items: stepsOf(project) } };
	},

	getStep: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		return { status: 200, body: stepOf(project, stepParam(call)) };
	},

	getStepText: async (call, context) => {
		const step = editableStepParam(call);
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const text = stepTextOf(project, step);
		if (text === null) throw noteMissing(step);
		const etag = text['etag'];
		return { status: 200, body: text, ...(typeof etag === 'string' ? { etag } : {}) };
	},

	setStepStatus: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const step = stepParam(call);
		const status = bodyOf(call)['status'] as StepStatus;
		if (!canSetStepStatus(step, status)) {
			throw new ApiError(
				'invalid-step-status',
				step === 10 ? 'Step 10 is either not started or complete.' : 'Only step 9 can be skipped.',
			);
		}
		// The plugin's own screens never offer this. The service would take it and leave the step not started without a word.
		if (isStepHandled(step, status) && !areStepPrerequisitesComplete({ ...project.steps, [step]: status }, step)) {
			const waiting = getStepDefinition(step).dependencies.filter((before) => !isStepHandled(before, project.steps[before]));
			throw new ApiError('step-prerequisites-incomplete', `Step ${String(step)} rests on steps that are not complete yet.`, {
				steps: [...waiting],
			});
		}
		await context.host.projects.updateStepStatus(project, step, status);
		const { project: after } = await context.loadProject(projectId);
		return { status: 200, body: { items: stepsOf(after) } };
	},

	updateStepText: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const step = editableStepParam(call);
		const project = await context.writableProject(projectId);
		const artifact = project.artifacts[step];
		if (artifact === undefined) throw noteMissing(step);
		const sections = bodyOf(call)['sections'] as Readonly<Record<string, string>>;
		const known: readonly string[] = STEP_SECTION_IDS[step];
		const strangers = Object.keys(sections).filter((id) => !known.includes(id));
		if (strangers.length > 0) {
			throw new ApiError('invalid-request', 'The call does not match what the operation takes.', {
				errors: strangers.map((id) => ({
					pointer: `/sections/${id}`,
					detail: `Step ${String(step)} has no section of that name. It has ${known.join(', ')}.`,
				})),
			});
		}
		if (Object.keys(sections).length > 0) {
			await context.host.projects.updateSections(artifact.path, sections, revisionOf(call, artifact.revision), NOT_THE_AUTHOR);
		}
		const { project: after } = await context.loadProject(projectId);
		const text = stepTextOf(after, step);
		if (text === null) throw noteMissing(step);
		const etag = text['etag'];
		return { status: 200, body: text, ...(typeof etag === 'string' ? { etag } : {}) };
	},
};
