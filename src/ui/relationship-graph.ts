/**
 * The relationship graph workspace: the fifth tab of the Visualization
 * workspace, with two views of one project's relationships. The entities
 * view draws the project's characters, scenes and worldbuilding notes as
 * nodes and every relationship record line as a labelled line between
 * holder and target, on a stage of its own. The scenes-and-manuscript view
 * opens Obsidian's own graph in a tab of its own, set to the project, and
 * this tab stands in for it with a pane that says what was set.
 *
 * The toolbar rides the strip's row as the timeline's does: the view at its
 * start, the search in the middle, the symbols at the end. What the tab
 * shows and whether the controls stand open are the layout's to keep; the
 * words searched for and where the nodes stand last the session.
 */

import { Notice } from 'obsidian';

import { buildOptionField, type OptionPicker } from './option-picker';
import type {
	RelationshipGraphControls,
	RelationshipGraphHandle,
	RelationshipGraphReading,
} from './relationship-graph-bridge';
import { renderSceneManuscriptPane } from './scene-manuscript-pane';
import {
	RELATIONSHIP_GRAPH_VIEWS,
	isRelationshipGraphView,
	type RelationshipGraphView,
} from './story-structure-state';
import {
	balanceToolbar,
	createSearchField,
	toolbarEnd,
	toolbarIconButton,
} from './workspace-frame';

/** The word each view goes by in the field. */
const VIEW_WORDS: Record<RelationshipGraphView, string> = {
	entities: 'relationshipGraph.view.entities',
	'scene-manuscript': 'relationshipGraph.view.sceneManuscript',
};

export function renderRelationshipGraph(
	container: HTMLElement,
	controls: RelationshipGraphControls,
): RelationshipGraphHandle {
	const { app, t, memory } = controls;
	const notice = (error: unknown): void => {
		new Notice(error instanceof Error ? error.message : t('errors.unknown'));
	};
	let disposed = false;
	let reading: RelationshipGraphReading | null = null;

	const root = container.createDiv({ cls: 'snowflake-method-relationship-graph' });

	// -- The toolbar ---------------------------------------------------------

	const toolbar = root.createDiv({
		cls: 'snowflake-method-relationship-graph-toolbar snowflake-method-balanced-toolbar',
		attr: { role: 'toolbar', 'aria-label': t('relationshipGraph.toolbar') },
	});
	const viewHost = toolbar.createDiv({
		cls: 'snowflake-method-toolbar-start snowflake-method-relationship-graph-view-select',
	});
	// The search narrows the entities view to the nodes whose names answer it;
	// the other view has nothing of its own to search, so the field is put
	// away with the symbols while that view is shown.
	const searchField = createSearchField(toolbar, {
		placeholder: t('relationshipGraph.search'),
		query: (words) => {
			memory.query = words;
			paintStage();
		},
		step: () => undefined,
		leave: () => undefined,
	});
	const end = toolbarEnd(toolbar);
	const iconButton = (cls: string, icon: string, label: string): HTMLButtonElement =>
		toolbarIconButton(end, cls, icon, label);
	// The controls panel folds open and shut from one symbol, which says what
	// stands now; the fold is the layout's, like the view.
	const controlsButton = iconButton(
		'snowflake-method-relationship-graph-controls',
		'sliders-horizontal',
		t('relationshipGraph.controls'),
	);
	controlsButton.setAttribute('aria-pressed', memory.controlsOpen ? 'true' : 'false');
	controlsButton.addEventListener('click', () => {
		memory.controlsOpen = !memory.controlsOpen;
		controlsButton.setAttribute('aria-pressed', memory.controlsOpen ? 'true' : 'false');
		controls.remember();
		paintStage();
	});
	const refreshButton = iconButton('snowflake-method-relationship-graph-refresh', 'refresh-cw', t('corkboard.refresh'));
	refreshButton.addEventListener('click', () => {
		void controls.refresh().then(() => reload()).catch(notice);
	});
	const stopBalance = balanceToolbar(toolbar, { start: viewHost, end });

	// -- The stage -------------------------------------------------------------

	const stage = root.createDiv({ cls: 'snowflake-method-relationship-graph-stage' });

	// Choosing the native view opens the graph tab once, there and then; a
	// repaint, or a tab restored on this view, only shows the pane, whose
	// button opens the graph again.
	const openSceneManuscript = (): void => {
		void controls
			.bridge()
			.openSceneManuscriptGraph()
			.then((opening) => {
				if (opening === 'disabled') new Notice(t('relationshipGraph.sceneManuscript.disabled'));
				if (opening === 'unavailable') new Notice(t('relationshipGraph.sceneManuscript.unavailable'));
			})
			.catch(notice);
	};
	const resetSceneManuscript = (): void => {
		void controls
			.bridge()
			.resetSceneManuscriptGraph()
			.then((wrote) => {
				if (wrote === 'written') new Notice(t('relationshipGraph.sceneManuscript.resetDone'));
			})
			.catch(notice);
	};
	const chooseView = (chosen: string): void => {
		if (!isRelationshipGraphView(chosen) || chosen === memory.view) return;
		memory.view = chosen;
		controls.remember();
		paintAll();
		if (chosen === 'scene-manuscript') openSceneManuscript();
	};
	const viewField: OptionPicker = buildOptionField(app, viewHost, {
		options: () => RELATIONSHIP_GRAPH_VIEWS.map((view) => ({ value: view, label: t(VIEW_WORDS[view]) })),
		label: t('relationshipGraph.view'),
		placeholder: t('relationshipGraph.view'),
		emptyPlaceholder: t('relationshipGraph.view'),
		value: () => memory.view,
		choose: chooseView,
	});

	/** The stage drawn afresh for the view shown and the document read. */
	const paintStage = (): void => {
		stage.empty();
		root.toggleClass('is-entities', memory.view === 'entities');
		root.toggleClass('is-scene-manuscript', memory.view === 'scene-manuscript');
		root.toggleClass('is-read-only', reading?.readOnly === true);
		root.toggleClass('is-controls-open', memory.controlsOpen);
		if (memory.view === 'entities') {
			stage.createEl('p', { cls: 'snowflake-method-tab-planned', text: t('relationshipGraph.empty') });
		} else if (reading !== null) {
			renderSceneManuscriptPane(stage, {
				t,
				standing: controls.bridge().sceneManuscript(),
				stored: reading.held.sceneManuscript !== null,
				readOnly: reading.readOnly,
				open: openSceneManuscript,
				reset: resetSceneManuscript,
			});
		}
	};
	const paintAll = (): void => {
		viewField.refresh();
		paintStage();
	};
	const reload = async (): Promise<void> => {
		const next = await controls.bridge().read();
		if (disposed) return;
		reading = next;
		paintAll();
	};
	const unsubscribe = controls.bridge().subscribe(() => {
		void reload().catch(notice);
	});
	void reload().catch(notice);

	return {
		refresh: () => {
			void reload().catch(notice);
		},
		reveal: () => undefined,
		remeasure: () => undefined,
		saveFocusedBody: () => false,
		dispose: () => {
			disposed = true;
			unsubscribe();
			stopBalance();
			searchField.dispose();
			viewField.destroy();
			root.remove();
		},
	};
}
