/**
 * Long-form notes belong beside the dashboard, inside a single companion pane
 * that the plugin owns. Splitting on every request stacked one more column per
 * opening, so routing picks the cheapest destination instead: the tab that
 * already shows the note, the companion pane, or -- only when that pane is
 * gone -- a fresh split next to the dashboard.
 *
 * The rules stay free of Obsidian types so they can be exercised without a live
 * workspace. `main.ts` collects leaf snapshots and performs the chosen action.
 */

/** A leaf of the main editor area, reduced to what routing needs. */
export interface NotePaneLeaf<TLeaf, TPane> {
	readonly leaf: TLeaf;
	/** Tab group holding the leaf. Panes are compared by identity. */
	readonly pane: TPane;
	readonly viewType: string;
	/** File shown by the leaf, or null for views that carry no file. */
	readonly filePath: string | null;
	/** Project the shown file belongs to, when it is a Snowflake note. */
	readonly projectId: string | null;
}

export interface NotePaneRouteRequest<TLeaf, TPane> {
	readonly targetPath: string;
	/** Project of the note being opened, used to recover a pane after reload. */
	readonly targetProjectId: string | null;
	readonly dashboardViewType: string;
	/** Leaves of the main editor area; sidebars and popout windows are excluded. */
	readonly leaves: readonly NotePaneLeaf<TLeaf, TPane>[];
	/** Companion pane remembered from an earlier opening, if any. */
	readonly notePane: TPane | null;
	readonly activeLeaf: TLeaf | null;
	/** The "open long-form notes in a split" setting. */
	readonly preferSplit: boolean;
	/** False on mobile and on windows too narrow to hold two panes. */
	readonly canSplit: boolean;
}

export type NotePaneRoute<TLeaf, TPane> =
	/** The note is already open: switch to that tab. */
	| { readonly kind: 'reveal'; readonly leaf: TLeaf }
	/** Add a tab to the companion pane, anchored on one of its leaves. */
	| { readonly kind: 'pane'; readonly pane: TPane; readonly anchor: TLeaf }
	/** Create the companion pane by splitting the dashboard leaf. */
	| { readonly kind: 'split'; readonly source: TLeaf }
	/** No pane to sit beside: fall back to a standard tab. */
	| { readonly kind: 'tab' };

export function routeNotePane<TLeaf, TPane>(
	request: NotePaneRouteRequest<TLeaf, TPane>,
): NotePaneRoute<TLeaf, TPane> {
	const open = openLeafFor(request);
	if (open !== undefined) return { kind: 'reveal', leaf: open.leaf };

	if (!request.preferSplit || !request.canSplit) return { kind: 'tab' };

	const companion = companionPaneFor(request) ?? projectPaneFor(request);
	if (companion !== undefined) {
		return { kind: 'pane', pane: companion.pane, anchor: companion.leaf };
	}

	const dashboard = dashboardLeafFor(request);
	return dashboard === undefined
		? { kind: 'tab' }
		: { kind: 'split', source: dashboard.leaf };
}

function openLeafFor<TLeaf, TPane>(
	request: NotePaneRouteRequest<TLeaf, TPane>,
): NotePaneLeaf<TLeaf, TPane> | undefined {
	const open = request.leaves.filter(
		(candidate) => candidate.filePath === request.targetPath,
	);
	return (
		open.find((candidate) => candidate.pane === request.notePane) ??
		open.find((candidate) => candidate.leaf === request.activeLeaf) ??
		open[0]
	);
}

function companionPaneFor<TLeaf, TPane>(
	request: NotePaneRouteRequest<TLeaf, TPane>,
): NotePaneLeaf<TLeaf, TPane> | undefined {
	const pane = request.notePane;
	if (pane === null || hostsDashboard(request, pane)) return undefined;
	return request.leaves.find((candidate) => candidate.pane === pane);
}

/**
 * A reload drops the remembered pane while the workspace layout survives, and
 * so would split a third column next to the restored note. Adopt the pane that
 * already holds a note of the same project instead: it is the companion pane
 * from the previous session, and a pane showing the project the author is
 * working in is never an unrelated workspace.
 */
function projectPaneFor<TLeaf, TPane>(
	request: NotePaneRouteRequest<TLeaf, TPane>,
): NotePaneLeaf<TLeaf, TPane> | undefined {
	if (request.targetProjectId === null) return undefined;
	return request.leaves.find(
		(candidate) =>
			candidate.projectId === request.targetProjectId &&
			candidate.viewType !== request.dashboardViewType &&
			!hostsDashboard(request, candidate.pane),
	);
}

function dashboardLeafFor<TLeaf, TPane>(
	request: NotePaneRouteRequest<TLeaf, TPane>,
): NotePaneLeaf<TLeaf, TPane> | undefined {
	const dashboards = request.leaves.filter(
		(candidate) => candidate.viewType === request.dashboardViewType,
	);
	return (
		dashboards.find((candidate) => candidate.leaf === request.activeLeaf) ??
		dashboards[0]
	);
}

/**
 * A pane that took in the dashboard is no longer a place to drop notes: opening
 * there would bury the workspace the note was opened from.
 */
function hostsDashboard<TLeaf, TPane>(
	request: NotePaneRouteRequest<TLeaf, TPane>,
	pane: TPane,
): boolean {
	return request.leaves.some(
		(candidate) =>
			candidate.pane === pane &&
			candidate.viewType === request.dashboardViewType,
	);
}
