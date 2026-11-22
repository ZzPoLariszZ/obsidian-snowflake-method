import { describe, expect, it } from 'vitest';

import { Router } from '../../api/http/router';
import type { JsonObject } from '../../api/json';
import { readDocument } from '../../api/spec/document';
import { readOperations } from '../../api/spec/operations';

const operation = (id: string): JsonObject => ({
	operationId: id,
	'x-snowflake-access': 'read',
	'x-snowflake-availability': { status: 'available', round: 1 },
	responses: { '200': { description: 'Done.' } },
});
const projectId = { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } };
const taskId = { name: 'taskId', in: 'path', required: true, schema: { type: 'string' } };
const notePath = { name: 'notePath', in: 'path', required: true, schema: { type: 'string' } };

const sample = readDocument({
	openapi: '3.1.0',
	info: { title: 'Sample', version: '1.0.0' },
	servers: [{ url: 'http://127.0.0.1:{port}/v1' }],
	paths: {
		'/': { get: operation('describe') },
		'/projects': { get: operation('listProjects'), post: operation('createProject') },
		'/projects/{projectId}': { parameters: [projectId], get: operation('getProject'), patch: operation('updateProject') },
		'/projects/{projectId}/tasks/{taskId}': { parameters: [projectId, taskId], get: operation('getTask') },
		'/projects/{projectId}/tasks/purge-archived': { parameters: [projectId], post: operation('purgeArchivedTasks') },
		'/projects/{projectId}/manuscript/notes/{notePath}': { parameters: [projectId, notePath], get: operation('getNote') },
		'/projects/{projectId}/manuscript/notes/{notePath}/body': { parameters: [projectId, notePath], put: operation('writeNoteBody') },
	},
});
const router = new Router(readOperations(sample), sample.basePath);

const found = (method: string, target: string): [string, Record<string, string>] | string => {
	const route = router.route(method, target);
	return route.kind === 'found' ? [route.operation.id, route.params] : route.kind;
};

describe('an address led to its operation', () => {
	it('finds the root with or without its closing slash', () => {
		expect(found('GET', '/v1')).toEqual(['describe', {}]);
		expect(found('GET', '/v1/')).toEqual(['describe', {}]);
		expect(found('GET', '/v1?')).toEqual(['describe', {}]);
	});

	it('knows nothing outside its base path', () => {
		expect(found('GET', '/')).toBe('none');
		expect(found('GET', '/v10')).toBe('none');
		expect(found('GET', '/v2/projects')).toBe('none');
		expect(found('GET', '/projects')).toBe('none');
	});

	it('reads the values an address leaves room for', () => {
		expect(found('GET', '/v1/projects')).toEqual(['listProjects', {}]);
		expect(found('GET', '/v1/projects/project-1')).toEqual(['getProject', { projectId: 'project-1' }]);
		expect(found('GET', '/v1/projects/project-1/tasks/task-9')).toEqual(['getTask', { projectId: 'project-1', taskId: 'task-9' }]);
	});

	it('cuts an address at its slashes before it reads the steps back, so one step can carry a path', () => {
		expect(found('GET', '/v1/projects/p/manuscript/notes/50_Manuscript%2FPart%201%2FChapter%201.md')).toEqual([
			'getNote',
			{ projectId: 'p', notePath: '50_Manuscript/Part 1/Chapter 1.md' },
		]);
		expect(found('PUT', '/v1/projects/p/manuscript/notes/%E6%AD%A3%E6%96%87%2F%E7%AC%AC%E4%B8%80%E7%AB%A0.md/body')).toEqual([
			'writeNoteBody',
			{ projectId: 'p', notePath: '正文/第一章.md' },
		]);
		// Left unencoded, the same path is other steps and leads nowhere.
		expect(found('GET', '/v1/projects/p/manuscript/notes/50_Manuscript/Chapter 1.md')).toBe('none');
	});

	it('takes a word that must stand in a place before a value that may', () => {
		expect(found('POST', '/v1/projects/p/tasks/purge-archived')).toEqual(['purgeArchivedTasks', { projectId: 'p' }]);
		expect(found('GET', '/v1/projects/p/tasks/purge-archived')).toEqual(['getTask', { projectId: 'p', taskId: 'purge-archived' }]);
	});

	it('reads the query, a name said twice as a list', () => {
		expect(found('GET', '/v1/projects?state=archived&limit=5')).toEqual(['listProjects', { state: 'archived', limit: '5' }]);
		expect(found('GET', '/v1/projects?include=counts&include=usage')).toEqual(['listProjects', { include: 'counts,usage' }]);
		expect(found('GET', '/v1/projects?q=a%20b+c%26d')).toEqual(['listProjects', { q: 'a b c&d' }]);
	});

	it('takes a name every object answers to as the name it is', () => {
		const route = router.route('GET', '/v1/projects?constructor=a&toString=b&toString=c&__proto__=d&limit=5');
		if (route.kind !== 'found') throw new Error('The address is one.');
		expect(Object.keys(route.params).sort()).toEqual(['__proto__', 'constructor', 'limit', 'toString']);
		expect(Object.entries(route.params).sort()).toEqual([
			['__proto__', 'd'],
			['constructor', 'a'],
			['limit', '5'],
			['toString', 'b,c'],
		]);
	});

	it('lets the address speak for itself over a query that names the same thing', () => {
		expect(found('GET', '/v1/projects/project-1?projectId=other')).toEqual(['getProject', { projectId: 'project-1' }]);
	});

	it('says which methods an address takes when the one used is not among them', () => {
		expect(router.route('DELETE', '/v1/projects/project-1')).toEqual({ kind: 'wrong-method', allow: ['GET', 'PATCH'] });
		expect(router.route('OPTIONS', '/v1/projects')).toEqual({ kind: 'wrong-method', allow: ['GET', 'POST'] });
		expect(router.route('HEAD', '/v1')).toEqual({ kind: 'wrong-method', allow: ['GET'] });
	});

	it('finds nothing at an address that is not one', () => {
		expect(found('GET', '/v1/projects//tasks')).toBe('none');
		expect(found('GET', '/v1/projects/%E0%A4%A')).toBe('none');
		expect(found('GET', '/v1/nonsense')).toBe('none');
		expect(found('GET', '/v1/projects/a/b/c/d/e/f/g')).toBe('none');
	});
});
