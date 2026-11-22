import { writeUnderWay } from '../src/repository/writes-under-way';
import { ApiError, mapError, problemOf, readProblems, type ProblemEntry } from './errors';
import type { JsonValue } from './json';
import type { ApiContext, OperationHandler, OperationResult } from './operations/context';
import type { OperationQueue } from './queue';
import { checkCall } from './schema/coerce';
import { allows, type OperationSpec } from './spec/operations';

/** A call as a door hands it over: which operation, and what it carries. */
export interface DispatchCall {
	readonly operationId: string;
	/** The address's and the query's values as they came: text from an address, or typed from JSON. */
	readonly params: Readonly<Record<string, unknown>>;
	/** The body, or undefined where the call has none. */
	readonly body: unknown;
	/** The version the caller means to change, without its quotes, or null. */
	readonly ifMatch: string | null;
	/** Whether the door found the caller to be who the author let in. */
	readonly authenticated: boolean;
}

/** The answer, for the door to send in its own way. */
export interface DispatchReply {
	readonly status: number;
	/** A failure, whose body is the problem document. */
	readonly failed: boolean;
	readonly operationId: string;
	readonly body: JsonValue | undefined;
	readonly etag: string | null;
	readonly location: string | null;
}

/** The frames of a stack with the line that carries the message taken off. */
const framesOf = (error: unknown): string =>
	error instanceof Error && typeof error.stack === 'string'
		? error.stack
				.split('\n')
				.filter((line) => /^\s+at /u.test(line))
				.slice(0, 6)
				.join('\n')
		: '';

/**
 * The one way in. Both doors hand their calls here, and here it is decided,
 * in this order, whether there is such an operation, whether this build
 * answers it, whether the caller may ask it, and whether the call is what
 * the contract describes. Only then does a handler see it.
 *
 * Everything but the three operations the API answers about itself then
 * waits until projects can be listed and takes its turn in the queue. A
 * change is noted as a write on its way for as long as its handler runs,
 * which is what makes a closing window wait for it, and runs as the
 * plugin's own work, so none of it is put down to the author's hand.
 */
export class Dispatcher {
	private readonly byId = new Map<string, OperationSpec>();
	private readonly problems: ReadonlyMap<string, ProblemEntry>;

	constructor(
		private readonly context: ApiContext,
		private readonly handlers: ReadonlyMap<string, OperationHandler>,
		private readonly queue: OperationQueue,
	) {
		for (const operation of context.operations) this.byId.set(operation.id, operation);
		this.problems = readProblems(context.document);
	}

	/** The operation of that name, where the contract has one. */
	operation(id: string): OperationSpec | null {
		return this.byId.get(id) ?? null;
	}

	async dispatch(call: DispatchCall): Promise<DispatchReply> {
		try {
			return this.answered(call.operationId, await this.run(call));
		} catch (error) {
			return this.refused(call.operationId, error);
		}
	}

	/**
	 * The reply for a refusal, the doors' own among them: a door that turns
	 * a caller away before there is a call says so through the same list of
	 * problems, in the same shape.
	 */
	refused(operationId: string, error: unknown): DispatchReply {
		const known = mapError(error);
		if (!(error instanceof ApiError) && known.code === 'internal-error') {
			// Said by its kind and where it was raised. Its message stays
			// unsaid: it may carry a path or a title, which are the author's.
			console.error(
				`Snowflake API: ${operationId} failed with ${error instanceof Error ? error.name : typeof error}\n${framesOf(error)}`,
			);
		}
		const problem = problemOf(this.problems, known);
		return { status: problem.status, failed: true, operationId, body: problem.body, etag: null, location: null };
	}

	private answered(operationId: string, result: OperationResult): DispatchReply {
		return {
			status: result.status,
			failed: false,
			operationId,
			body: result.body,
			etag: result.etag ?? null,
			location: result.location ?? null,
		};
	}

	private async run(call: DispatchCall): Promise<OperationResult> {
		const operation = this.byId.get(call.operationId);
		if (operation === undefined) throw new ApiError('unknown-operation', `There is no operation named ${call.operationId}.`);
		const handler = this.handlers.get(operation.id);
		if (!operation.available || handler === undefined) {
			throw new ApiError('planned-operation', `${operation.id} is planned for a later version and not answered by this one.`);
		}
		if (!operation.open && !call.authenticated) {
			throw new ApiError('unauthorized', "Send the access token from the plugin's settings as a bearer token.");
		}
		const host = this.context.host;
		const level = host.access();
		if (!allows(level, operation.access)) {
			throw new ApiError(
				'access-denied',
				`${operation.id} needs the ${operation.access} level, and the author has set ${level}.`,
				{ needs: operation.access, level },
			);
		}
		const checked = checkCall(this.context.document, operation, { params: call.params, body: call.body });
		if (checked.issues.length > 0) {
			throw new ApiError('invalid-request', 'The call does not match what the operation takes.', {
				errors: checked.issues.map((issue) => ({ pointer: issue.pointer, detail: issue.detail })),
			});
		}
		if (operation.precondition === 'required' && call.ifMatch === null) {
			throw new ApiError(
				'precondition-required',
				'Say which version of the note the change is made against: send the etag you read in If-Match.',
			);
		}
		const handle = async (): Promise<OperationResult> =>
			handler(
				{
					operation,
					params: checked.params,
					body: checked.body,
					ifMatch: operation.precondition === 'none' ? null : call.ifMatch,
					authenticated: call.authenticated,
				},
				this.context,
			);
		if (operation.direct) return handle();

		const leaving = (): ApiError => new ApiError('leaving', 'Obsidian is closing, or the plugin is being switched off.');
		if (host.leaving()) throw leaving();
		await host.ready();
		return this.queue.run(() => {
			// Asked again at its turn: the window may have begun to go while it waited.
			if (host.leaving()) throw leaving();
			if (operation.access === 'read') return handle();
			// Noted before the handler takes its first step, not once it has
			// taken it: the step is put off by one turn so the note comes first.
			return writeUnderWay(Promise.resolve().then(() => host.asPlugin(handle)));
		});
	}
}
