import type { StepId } from '../../src/domain';
import { isEditableStep, stepOf, stepTextOf, stepsOf } from '../dto/project';
import { ApiError } from '../errors';
import { numberParam, textParam, type OperationCall, type OperationGroup } from './context';

/** The step a call names. The contract holds it to 1 through 10 before a handler sees it. */
const stepParam = (call: OperationCall): StepId => numberParam(call, 'step') as StepId;

/**
 * The ten steps, read. A step's status is told as the project keeps it.
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
		const step = stepParam(call);
		if (!isEditableStep(step)) {
			throw new ApiError(
				'not-found',
				`Step ${String(step)} is not written in a note of its own. Steps 1, 2, 4 and 6 are. Read characters for 3, 5 and 7, scenes for 8 and 9, and the manuscript for 10.`,
			);
		}
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const text = stepTextOf(project, step);
		if (text === null) {
			throw new ApiError(
				'not-found',
				`The note of step ${String(step)} is missing from the project. getProjectHealth says what is wrong, and repairProject puts it back.`,
			);
		}
		const etag = text['etag'];
		return { status: 200, body: text, ...(typeof etag === 'string' ? { etag } : {}) };
	},
};
