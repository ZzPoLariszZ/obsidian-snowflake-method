/** Filtered lists must not offer adjacent moves across invisible rows. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceLeaf } from 'obsidian';

interface MenuAction {
	title: string;
	disabled: boolean;
	run: () => void;
}

const ui = vi.hoisted(() => ({ menus: [] as MenuAction[][] }));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		ItemView: class {
			app: unknown;
			constructor(public leaf: { app: unknown }) { this.app = leaf.app; }
		},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
		SearchComponent: class extends runtime.SearchComponent {
			setValue(): this { return this; }
		},
		Menu: class {
			private items: MenuAction[] = [];
			addItem(build: (item: unknown) => void): this {
				const action: MenuAction = { title: '', disabled: false, run: () => undefined };
				const item = {
					setTitle: (title: string) => { action.title = title; return item; },
					setIcon: () => item,
					setWarning: () => item,
					setDisabled: (disabled: boolean) => { action.disabled = disabled; return item; },
					onClick: (run: () => void) => { action.run = run; return item; },
				};
				build(item);
				this.items.push(action);
				return this;
			}
			addSeparator(): this { return this; }
			setParentElement(): this { return this; }
			showAtMouseEvent(): this { ui.menus.push(this.items); return this; }
		},
	};
});


import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import type { DashboardHost, ProjectDashboardModel, CharacterViewModel, WorldbuildingEntityViewModel } from '../../src/ui/view-model';
import { CorkboardDom } from '../helpers/corkboard-dom';

interface Internals {
  characterEntries(model: ProjectDashboardModel): { character: CharacterViewModel; index: number }[];
  entityEntries(model: ProjectDashboardModel, kind: 'location'): { entity: WorldbuildingEntityViewModel; index: number }[];
  renderCharacterRow(body: HTMLElement, character: CharacterViewModel, index: number, model: ProjectDashboardModel, step: 3, readOnly: boolean, dragLocked: boolean): void;
  renderEntityRow(body: HTMLElement, model: ProjectDashboardModel, kind: 'location', entity: WorldbuildingEntityViewModel, index: number, readOnly: boolean, dragLocked: boolean): void;
}

beforeEach(() => { ui.menus.length = 0; });

describe('Claude finding 5: filtered member menus', () => {
  it.each(['character', 'location'] as const)('%s menu disables moving across a hidden neighbour', async (kind) => {
    const dom = new CorkboardDom();
    const move = vi.fn(() => Promise.resolve());
    const view = new SnowflakeDashboardView({ app: {} } as unknown as WorkspaceLeaf, {
      getRecentStep: () => 3,
      isFreeformModeEnabled: () => true,
      showsTableActionsColumn: () => false,
      showsTableProgressStatus: () => false,
      translateForProject: (_locale: string, key: string) => key,
      reorderCharacter: move,
      reorderEntity: move,
    } as unknown as DashboardHost);
    Object.assign(view, {
      characterQuery: 'Keep', entityQueries: new Map([['location', 'Keep']]),
      refresh: vi.fn(() => Promise.resolve()),
      revealCharacter: vi.fn(), revealEntity: vi.fn(),
    });
    const members = ['Keep A', 'Hidden', 'Keep C'].map((name, rank) => ({
      id: name, path: `${name}.md`, name, rank, kind: 'location',
      aliases: [], categoryPaths: [], progressStatus: null,
      healthIssues: [], readOnly: false, oneSentenceStoryline: '', description: '',
    }));
    const model = { readOnly: false, structureIssues: [], characters: members,
      worldbuilding: { location: members },
    } as unknown as ProjectDashboardModel;
    const internal = view as unknown as Internals;
    let indexes: number[];
    if (kind === 'character') {
      const entries = internal.characterEntries(model);
      indexes = entries.map(e => e.index);
      entries.forEach(e => internal.renderCharacterRow(dom.container as unknown as HTMLElement, e.character, e.index, model, 3, false, true));
    } else {
      const entries = internal.entityEntries(model, 'location');
      indexes = entries.map(e => e.index);
      entries.forEach(e => internal.renderEntityRow(dom.container as unknown as HTMLElement, model, 'location', e.entity, e.index, false, true));
    }
    expect(indexes).toEqual([0, 2]);
    const rows = dom.container.querySelectorAll('tr');
    expect(rows).toHaveLength(2);
    expect(rows[1]!.getAttribute('draggable')).toBe('false');
    rows[1]!.querySelector('.snowflake-method-table-more')!.dispatch('click');
    const up = ui.menus[ui.menus.length - 1]!.find(item => item.title === 'actions.moveUp')!;
    expect(up.disabled).toBe(true);
    up.run();
    await Promise.resolve();
    expect(move).not.toHaveBeenCalled();
  });
});
