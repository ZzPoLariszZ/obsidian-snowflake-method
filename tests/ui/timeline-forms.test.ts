import { describe, expect, it, vi } from 'vitest';

const { notices } = vi.hoisted(() => ({ notices: vi.fn() }));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		modalEl = { addClass: (): void => undefined };
		setTitle(): void {}
	}
	return {
		...runtime,
		Modal,
		FuzzySuggestModal: class extends Modal {},
		SuggestModal: class extends Modal {},
		Notice: class {
			constructor(message: string) { notices(message); }
		},
	};
});

import type { App } from 'obsidian';

import type { Timeline } from '../../src/domain';
import {
	AddTimelineModal,
	TimelineViewFormModal,
	renameTimelineForm,
	renameTimelineViewForm,
} from '../../src/ui/timeline-forms';

const app = {} as App;
const t = (key: string): string => key;
const timeline = (id: string): Timeline => ({
	id, name: `Timeline ${id}`, binding: null, times: [], createdAt: 1, updatedAt: 1,
});
const collect = <T>(form: unknown): T | null =>
	(form as { collectValue(): T | null }).collectValue();
const set = (form: unknown, fields: Record<string, unknown>): void => {
	Object.assign(form as object, fields);
};

describe('the timeline forms', () => {
	it('refuses an empty timeline name and one another timeline answers to', () => {
		const form = renameTimelineForm(app, t, 'Alice', ['Bob'], () => Promise.resolve());
		set(form, { value: '   ' });
		expect(collect(form)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('timeline.timeline.nameRequired');
		set(form, { value: 'bob' });
		expect(collect(form)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('timeline.timeline.nameTaken');
		set(form, { value: 'Alice' });
		expect(collect(form)).toBe('Alice');
		set(form, { value: ' Alice again ' });
		expect(collect(form)).toBe('Alice again');
	});

	it('names a view with the view\'s own words', () => {
		const form = renameTimelineViewForm(app, t, 'Main', ['World'], () => Promise.resolve());
		set(form, { value: '' });
		expect(collect(form)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('timeline.view.nameRequired');
		set(form, { value: 'World' });
		expect(collect(form)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('timeline.view.nameTaken');
	});

	it('hands back a new timeline with its binding, joining the view by default', () => {
		const form = new AddTimelineModal(app, t, {
			takenNames: ['Main'],
			pickBinding: () => Promise.resolve(null),
			offerView: true,
		}, () => Promise.resolve());
		expect(collect(form)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('timeline.timeline.nameRequired');
		set(form, { value: { name: ' Alice ', binding: { kind: 'character', id: 'c-1', name: 'Alice' }, addToView: true } });
		expect(collect(form)).toEqual({
			name: 'Alice',
			binding: { kind: 'character', id: 'c-1', name: 'Alice' },
			addToView: true,
		});
		const alone = new AddTimelineModal(app, t, {
			takenNames: [],
			pickBinding: () => Promise.resolve(null),
			offerView: false,
		}, () => Promise.resolve());
		set(alone, { value: { name: 'Bob', binding: null, addToView: false } });
		expect(collect(alone)).toEqual({ name: 'Bob', binding: null, addToView: false });
	});

	it('hands back a view over the timelines checked, in the list\'s order', () => {
		const timelines = [timeline('a'), timeline('b'), timeline('c')];
		const form = new TimelineViewFormModal(app, t, {
			mode: 'manage',
			takenNames: ['World'],
			initial: { name: 'Main', timelines: ['c', 'a'] },
			timelines: () => timelines,
			addTimeline: () => Promise.resolve(null),
		}, () => Promise.resolve());
		expect(collect(form)).toEqual({ name: 'Main', timelines: ['c', 'a'] });
		set(form, { nameValue: 'World' });
		expect(collect(form)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('timeline.view.nameTaken');
		set(form, { nameValue: 'Main', order: ['b', 'c', 'a'], checked: new Set(['a', 'b']) });
		expect(collect(form)).toEqual({ name: 'Main', timelines: ['b', 'a'] });
		const fresh = new TimelineViewFormModal(app, t, {
			mode: 'add',
			takenNames: [],
			initial: { name: '', timelines: ['a'] },
			timelines: () => timelines,
			addTimeline: () => Promise.resolve(null),
		}, () => Promise.resolve());
		expect(collect(fresh)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('timeline.view.nameRequired');
		set(fresh, { nameValue: 'All' });
		expect(collect(fresh)).toEqual({ name: 'All', timelines: ['a'] });
	});
});
