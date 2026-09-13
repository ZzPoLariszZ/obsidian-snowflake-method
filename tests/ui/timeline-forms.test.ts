import { describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

const { notices } = vi.hoisted(() => ({ notices: vi.fn() }));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		modalEl = { addClass: (): void => undefined };
		contentEl = new CorkboardDom().container;
		setTitle(): void {}
		onClose(): void {}
		close(): void { this.onClose(); }
	}
	class Setting extends runtime.Setting {
		settingEl: CorkboardElement;
		infoEl: CorkboardElement;
		controlEl: CorkboardElement;
		constructor(container: CorkboardElement) {
			super();
			this.settingEl = container.createDiv();
			this.infoEl = this.settingEl.createDiv();
			this.controlEl = this.settingEl.createDiv();
		}
		addText(build: (text: { inputEl: CorkboardElement; setValue(value: string): { onChange(handler: (value: string) => void): void } }) => void): this {
			const inputEl = this.controlEl.createEl('input');
			build({ inputEl, setValue: (value) => {
				inputEl.value = value;
				return { onChange: (handler) => { inputEl.addEventListener('input', () => handler(inputEl.value)); } };
			} });
			return this;
		}
	}
	return {
		...runtime,
		Modal,
		Setting,
		FuzzySuggestModal: class extends Modal { setPlaceholder(): void {} },
		SuggestModal: class extends Modal {},
		Notice: class {
			constructor(message: string) { notices(message); }
		},
	};
});

import { FuzzySuggestModal, type App, type Modal } from 'obsidian';

import type { Timeline } from '../../src/domain';
import {
	AddTimelineModal,
	TimelineViewFormModal,
	confirmTimelineAction,
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
	it('settles a kept confirmation as false when its owner closes it', async () => {
		const kept: Modal[] = [];
		const pending = confirmTimelineAction(app, t, { title: 'Delete', lines: [], label: 'Delete' }, (modal) => {
			kept.push(modal);
			return modal;
		});
		expect(kept).toHaveLength(1);
		kept[0]!.close();
		await expect(pending).resolves.toBe(false);
	});

	it('closes the existing-timeline picker with its form and ignores a creation that finishes later', async () => {
		let finish!: (id: string | null) => void;
		const made = new Promise<string | null>((resolve) => { finish = resolve; });
		const form = new TimelineViewFormModal(app, t, {
			mode: 'add', takenNames: [], initial: { name: 'Main', timelines: [] },
			timelines: () => [timeline('a'), timeline('new')], addTimeline: () => made,
		}, () => Promise.resolve());
		const pickers: FuzzySuggestModal<Timeline>[] = [];
		const open = vi.spyOn(FuzzySuggestModal.prototype, 'open').mockImplementation(function (this: FuzzySuggestModal<Timeline>) {
			pickers.push(this);
		});
		try {
			(form as unknown as { buildForm(): void }).buildForm();
			const content = form.contentEl as unknown as CorkboardElement;
			content.querySelector('.snowflake-method-timeline-view-make')!.dispatch('click');
			content.querySelector('.snowflake-method-record-pick')!.dispatch('click');
			expect(pickers).toHaveLength(1);
			const picker = pickers[0]!;
			const close = vi.spyOn(picker, 'close');
			form.close();
			expect(close).toHaveBeenCalledOnce();
			picker.onChooseItem(timeline('a'), {} as MouseEvent);
			finish('new');
			await made;
			await Promise.resolve();
			expect(collect(form)).toEqual({ name: 'Main', timelines: [] });
		} finally {
			open.mockRestore();
		}
	});

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
			roster: () => [],
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
			roster: () => [],
			offerView: false,
		}, () => Promise.resolve());
		set(alone, { value: { name: 'Bob', binding: null, addToView: false } });
		expect(collect(alone)).toEqual({ name: 'Bob', binding: null, addToView: false });
	});

	it('hands back a view over the timelines shown, in the lines\' order', () => {
		const timelines = [timeline('a'), timeline('b'), timeline('c')];
		const form = new TimelineViewFormModal(app, t, {
			mode: 'edit',
			takenNames: ['World'],
			initial: { name: 'Main', timelines: ['c', 'a'] },
			timelines: () => timelines,
			addTimeline: () => Promise.resolve(null),
		}, () => Promise.resolve());
		expect(collect(form)).toEqual({ name: 'Main', timelines: ['c', 'a'] });
		set(form, { nameValue: 'World' });
		expect(collect(form)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('timeline.view.nameTaken');
		set(form, { nameValue: 'Main', timelines: ['b', 'a'] });
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

	it('puts a dragged line in the place of the one it lands on', () => {
		const timelines = [timeline('a'), timeline('b'), timeline('c')];
		const form = new TimelineViewFormModal(app, t, {
			mode: 'edit',
			takenNames: [],
			initial: { name: 'Main', timelines: ['a', 'b', 'c'] },
			timelines: () => timelines,
			addTimeline: () => Promise.resolve(null),
		}, () => Promise.resolve());
		const move = (id: string, target: string): void => {
			(form as unknown as { moveLine(id: string, target: string): void }).moveLine(id, target);
		};
		move('a', 'c');
		expect(collect(form)).toEqual({ name: 'Main', timelines: ['b', 'c', 'a'] });
		move('a', 'b');
		expect(collect(form)).toEqual({ name: 'Main', timelines: ['a', 'b', 'c'] });
		move('c', 'c');
		expect(collect(form)).toEqual({ name: 'Main', timelines: ['a', 'b', 'c'] });
		move('c', 'gone');
		expect(collect(form)).toEqual({ name: 'Main', timelines: ['a', 'b', 'c'] });
	});
});
