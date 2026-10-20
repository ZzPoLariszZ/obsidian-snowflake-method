import type { Menu } from 'obsidian';

import type { ProjectSeries } from '../services';
import { groupBySeries } from './series';

/** What the switcher needs of a project to list it. */
export interface SwitcherProject {
	path: string;
	title: string;
	series: ProjectSeries | null;
	hasStructureIssues: boolean;
	hasMarkerIssues: boolean;
}

export interface ProjectSwitcherMenuConfig {
	projects: readonly SwitcherProject[];
	/** The project the dashboard shows, which the menu marks. */
	currentPath: string | null;
	t: (key: string, vars?: Record<string, string | number>) => string;
	onSelect: (path: string) => void;
	onManage: () => void;
	/** Opens the import dialog on the project shown; the row is left out when absent. */
	onImport?: () => void;
	/** Opens the update dialog on the project shown; given only while a sibling has been imported from. */
	onUpdate?: () => void;
	/** False while the project shown cannot be written to, which greys the rows. */
	canImport?: boolean;
}

/**
 * Fills the switcher: the projects put with their series, each series under
 * a label of its own, then the projects in none, then the manager. Every
 * row carries an icon, because a menu the app draws itself shows nothing in
 * a row without one on Windows, and a row with a problem carries the
 * warning in the icon's place.
 */
export function fillProjectSwitcherMenu(
	menu: Menu,
	config: ProjectSwitcherMenuConfig,
): void {
	const grouping = groupBySeries(config.projects);
	let first = true;
	const divide = (): void => {
		if (!first) menu.addSeparator();
		first = false;
	};
	for (const group of grouping.series) {
		divide();
		menu.addItem((item) =>
			item.setTitle(group.name).setIcon('book-copy').setIsLabel(true),
		);
		for (const project of group.books) addProject(menu, project, config);
	}
	if (grouping.loose.length > 0) {
		divide();
		for (const project of grouping.loose) addProject(menu, project, config);
	}
	menu.addSeparator();
	const onImport = config.onImport;
	if (onImport !== undefined) {
		menu.addItem((item) =>
			item
				.setTitle(config.t('actions.importFromProject'))
				.setIcon('import')
				.setDisabled(config.canImport === false)
				.onClick(() => {
					onImport();
				}),
		);
	}
	const onUpdate = config.onUpdate;
	if (onUpdate !== undefined) {
		menu.addItem((item) =>
			item
				.setTitle(config.t('actions.updateFromSeries'))
				.setIcon('refresh-cw')
				.setDisabled(config.canImport === false)
				.onClick(() => {
					onUpdate();
				}),
		);
	}
	menu.addItem((item) =>
		item
			.setTitle(config.t('dashboard.manageProjects'))
			.setIcon('library')
			.onClick(() => {
				config.onManage();
			}),
	);
}

function addProject(
	menu: Menu,
	project: SwitcherProject,
	config: ProjectSwitcherMenuConfig,
): void {
	menu.addItem((item) =>
		item
			.setTitle(project.title)
			.setIcon(
				project.hasStructureIssues || project.hasMarkerIssues
					? 'triangle-alert'
					: 'book',
			)
			.setChecked(project.path === config.currentPath)
			.onClick(() => {
				config.onSelect(project.path);
			}),
	);
}
