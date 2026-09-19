import {
	addBeat,
	addBeatRow,
	addBeatSheetAct,
	beatSheetFromStructure,
	beatSheetStructureOf,
	createBeatSheet,
	deleteBeat,
	deleteBeatRow,
	deleteBeatSheet,
	deleteBeatSheetAct,
	deleteBeatSheetTemplate,
	editBeat,
	editBeatRow,
	findBeat,
	findBeatRow,
	findBeatSheet,
	findBeatSheetAct,
	findBeatSheetTemplate,
	moveBeat,
	moveBeatRow,
	moveBeatSheetAct,
	placeBeatScene,
	pruneMissingFromBeatSheets,
	relabelBeatSheetAct,
	removeBeatScene,
	renameBeatSheet,
	saveBeatSheetTemplate,
	setBeatSheetPresentation,
	setBeatSheetReversed,
	setBeatSheetSubDescriptions,
	setLastBeatSheet,
	type BeatSheet,
	type BeatSheetDocument,
	type BeatSheetStructure,
	type ScenePresentation,
} from "../domain";
import type { VaultRepository } from "../repository";
import { BeatSheetStore } from "./beat-sheet-store";
import type { ProjectRef } from "./types";

/** What a write came to: the document now says what was asked, or why not. */
export type BeatSheetWrite = "written" | "absent" | "refused";
/** What a deletion came to. */
export type BeatSheetDeletion = "deleted" | "absent" | "refused";

/** The prefixes the ids minted here wear, one per kind of thing. */
export type BeatSheetIdPrefix =
	| "beat-sheet"
	| "beat-sheet-act"
	| "beat"
	| "beat-sheet-row"
	| "beat-sheet-template";

/** What a new sheet starts from: a structure handed over whole, or one of the project's own templates by id. */
export type BeatSheetSource =
	| { structure: BeatSheetStructure }
	| { templateId: string };

/**
 * The beat sheets of one project, as the workspace asks about them: a
 * document to read and mutations that land in the file at once, as the
 * timeline's do. Each mutation is a pure change from `domain/beat-sheet.ts`
 * worked out against the file as it is when the write runs, not as the
 * workspace last painted it; a change that would change nothing writes
 * nothing, and answers as written all the same, since the file says what was
 * asked.
 */
export class BeatSheetService {
	private readonly store: BeatSheetStore;
	private readonly now: () => number;
	private readonly mintId: (prefix: BeatSheetIdPrefix) => string;

	constructor(
		repository: VaultRepository,
		deps: {
			now: () => number;
			mintId: (prefix: BeatSheetIdPrefix) => string;
			onCorrupt?: (path: string) => void;
			onForeign?: (path: string, version: number) => void;
		},
	) {
		this.now = deps.now;
		this.mintId = deps.mintId;
		this.store = new BeatSheetStore({
			repository,
			now: deps.now,
			...(deps.onCorrupt === undefined ? {} : { onCorrupt: deps.onCorrupt }),
			...(deps.onForeign === undefined ? {} : { onForeign: deps.onForeign }),
		});
	}

	beatSheetPath(project: ProjectRef): string {
		return this.store.beatSheetPath(project);
	}

	read(project: ProjectRef): Promise<BeatSheetDocument> {
		return this.store.readDocument(project);
	}

	/**
	 * A new sheet from what it starts with, made the one opened last; its id,
	 * or null where the store refused or the template it names has gone. A
	 * template is read from the file as it stands when the write runs, and
	 * every act and beat is minted an id of its own.
	 */
	async createSheet(
		project: ProjectRef,
		draft: { name: string; source: BeatSheetSource },
	): Promise<string | null> {
		const id = this.mintId("beat-sheet");
		const wrote = await this.store.updateDocument(project, (held) => {
			const structure =
				"structure" in draft.source
					? draft.source.structure
					: findBeatSheetTemplate(held, draft.source.templateId);
			if (structure === undefined) return null;
			return createBeatSheet(
				held,
				beatSheetFromStructure(
					{ id, name: draft.name, structure, now: this.now() },
					(kind) => this.mintId(kind === "act" ? "beat-sheet-act" : "beat"),
				),
			);
		});
		return wrote ? id : null;
	}

	renameSheet(project: ProjectRef, id: string, name: string): Promise<BeatSheetWrite> {
		return this.reviseSheet(project, id, (held) => renameBeatSheet(held, id, name, this.now()));
	}

	async deleteSheet(project: ProjectRef, id: string): Promise<BeatSheetDeletion> {
		const wrote = await this.reviseSheet(project, id, (held) => deleteBeatSheet(held, id));
		return wrote === "written" ? "deleted" : wrote;
	}

	/** Remembers the sheet opened last, or none; absent when the id names no sheet. */
	setLastSheet(project: ProjectRef, id: string | null): Promise<BeatSheetWrite> {
		return this.revise(
			project,
			(held) => id === null || findBeatSheet(held, id) !== undefined,
			(held) => setLastBeatSheet(held, id),
		);
	}

	setPresentation(
		project: ProjectRef,
		sheetId: string,
		presentation: ScenePresentation | null,
	): Promise<BeatSheetWrite> {
		return this.reviseSheet(project, sheetId, (held) =>
			setBeatSheetPresentation(held, sheetId, presentation, this.now()),
		);
	}

	setSubDescriptions(project: ProjectRef, sheetId: string, shown: boolean): Promise<BeatSheetWrite> {
		return this.reviseSheet(project, sheetId, (held) =>
			setBeatSheetSubDescriptions(held, sheetId, shown, this.now()),
		);
	}

	/** Shows a sheet from its end or from its beginning; the order it keeps its acts and beats in is not touched. */
	setReversed(project: ProjectRef, sheetId: string, reversed: boolean): Promise<BeatSheetWrite> {
		return this.reviseSheet(project, sheetId, (held) =>
			setBeatSheetReversed(held, sheetId, reversed, this.now()),
		);
	}

	/** A new act with no beats, before another or at the end; its id, or null where the sheet is not there or the store refused. */
	async addAct(
		project: ProjectRef,
		sheetId: string,
		label: string,
		beforeActId: string | null,
	): Promise<string | null> {
		const id = this.mintId("beat-sheet-act");
		const wrote = await this.reviseSheet(project, sheetId, (held) =>
			addBeatSheetAct(held, sheetId, { id, label }, beforeActId, this.now()),
		);
		return wrote === "written" ? id : null;
	}

	relabelAct(project: ProjectRef, sheetId: string, actId: string, label: string): Promise<BeatSheetWrite> {
		return this.reviseAct(project, sheetId, actId, (held) =>
			relabelBeatSheetAct(held, sheetId, actId, label, this.now()),
		);
	}

	moveAct(
		project: ProjectRef,
		sheetId: string,
		actId: string,
		beforeActId: string | null,
	): Promise<BeatSheetWrite> {
		return this.reviseAct(project, sheetId, actId, (held) =>
			moveBeatSheetAct(held, sheetId, actId, beforeActId, this.now()),
		);
	}

	/** Takes an act out with all under it; an act already gone is what was asked. */
	deleteAct(project: ProjectRef, sheetId: string, actId: string): Promise<BeatSheetWrite> {
		return this.reviseSheet(project, sheetId, (held) =>
			deleteBeatSheetAct(held, sheetId, actId, this.now()),
		);
	}

	/** A new beat in an act, before another of its beats or at the end; its id, or null where the act has gone or the store refused. */
	async addBeat(
		project: ProjectRef,
		sheetId: string,
		actId: string,
		draft: { name: string; description: string },
		beforeBeatId: string | null,
	): Promise<string | null> {
		const id = this.mintId("beat");
		const wrote = await this.reviseAct(project, sheetId, actId, (held) =>
			addBeat(held, sheetId, actId, { id, ...draft }, beforeBeatId, this.now()),
		);
		return wrote === "written" ? id : null;
	}

	/** A beat's words, for a beat that must be there: absent where it has gone, since the file would not then say them. */
	editBeat(
		project: ProjectRef,
		sheetId: string,
		beatId: string,
		change: { name?: string; description?: string },
	): Promise<BeatSheetWrite> {
		return this.reviseBeat(project, sheetId, beatId, (held) =>
			editBeat(held, sheetId, beatId, change, this.now()),
		);
	}

	/** A beat moved into an act, before another of its beats or to its end; absent where the beat or the act has gone. */
	moveBeat(
		project: ProjectRef,
		sheetId: string,
		beatId: string,
		toActId: string,
		beforeBeatId: string | null,
	): Promise<BeatSheetWrite> {
		return this.revise(
			project,
			(held) => {
				const sheet = findBeatSheet(held, sheetId);
				return sheet !== undefined && findBeat(sheet, beatId) !== null && findBeatSheetAct(sheet, toActId) !== undefined;
			},
			(held) => moveBeat(held, sheetId, beatId, toActId, beforeBeatId, this.now()),
		);
	}

	deleteBeat(project: ProjectRef, sheetId: string, beatId: string): Promise<BeatSheetWrite> {
		return this.reviseSheet(project, sheetId, (held) => deleteBeat(held, sheetId, beatId, this.now()));
	}

	/** A new row under a beat, before a neighbour or at the end; its id, or null where the beat has gone or the store refused. */
	async addRow(
		project: ProjectRef,
		sheetId: string,
		beatId: string,
		text: string,
		beforeRowId: string | null,
		scenes: readonly string[] = [],
	): Promise<string | null> {
		const id = this.mintId("beat-sheet-row");
		const wrote = await this.reviseBeat(project, sheetId, beatId, (held) =>
			addBeatRow(held, sheetId, beatId, { id, text, scenes }, beforeRowId, this.now()),
		);
		return wrote === "written" ? id : null;
	}

	/** Words for a row that must be there: absent where the row has gone, since the file would not then say them. */
	editRow(project: ProjectRef, sheetId: string, rowId: string, text: string): Promise<BeatSheetWrite> {
		return this.reviseRow(project, sheetId, rowId, (held) =>
			editBeatRow(held, sheetId, rowId, text, this.now()),
		);
	}

	/** A row moved under a beat; absent where the row or the beat has gone. */
	moveRow(
		project: ProjectRef,
		sheetId: string,
		rowId: string,
		toBeatId: string,
		beforeRowId: string | null,
	): Promise<BeatSheetWrite> {
		return this.revise(
			project,
			(held) => {
				const sheet = findBeatSheet(held, sheetId);
				return sheet !== undefined && findBeatRow(sheet, rowId) !== null && findBeat(sheet, toBeatId) !== null;
			},
			(held) => moveBeatRow(held, sheetId, rowId, toBeatId, beforeRowId, this.now()),
		);
	}

	deleteRow(project: ProjectRef, sheetId: string, rowId: string): Promise<BeatSheetWrite> {
		return this.reviseSheet(project, sheetId, (held) => deleteBeatRow(held, sheetId, rowId, this.now()));
	}

	placeScene(
		project: ProjectRef,
		sheetId: string,
		sceneId: string,
		rowId: string,
		beforeSceneId: string | null,
	): Promise<BeatSheetWrite> {
		return this.reviseRow(project, sheetId, rowId, (held) =>
			placeBeatScene(held, sheetId, sceneId, rowId, beforeSceneId, this.now()),
		);
	}

	removeScene(project: ProjectRef, sheetId: string, sceneId: string): Promise<BeatSheetWrite> {
		return this.reviseSheet(project, sheetId, (held) =>
			removeBeatScene(held, sheetId, sceneId, this.now()),
		);
	}

	/** Takes out what points at scenes the project no longer has; never absent. */
	pruneMissing(
		project: ProjectRef,
		known: { sceneIds?: ReadonlySet<string> },
	): Promise<BeatSheetWrite> {
		return this.revise(
			project,
			() => true,
			(held) => pruneMissingFromBeatSheets(held, known, this.now()),
		);
	}

	/**
	 * A sheet's acts and beats kept under a name as one of the project's
	 * templates, read from the sheet as the file has it when the write runs. A
	 * namesake is replaced. Refused for a blank name before the store is asked,
	 * absent where the sheet has gone.
	 */
	saveTemplate(
		project: ProjectRef,
		sheetId: string,
		draft: { name: string; description: string },
	): Promise<BeatSheetWrite> {
		if (draft.name.trim().length === 0) return Promise.resolve("refused");
		const id = this.mintId("beat-sheet-template");
		return this.reviseSheet(project, sheetId, (held) => {
			const sheet = findBeatSheet(held, sheetId) as BeatSheet;
			return saveBeatSheetTemplate(
				held,
				{ id, name: draft.name, description: draft.description, structure: beatSheetStructureOf(sheet) },
				this.now(),
			);
		});
	}

	async deleteTemplate(project: ProjectRef, templateId: string): Promise<BeatSheetDeletion> {
		const wrote = await this.revise(
			project,
			(held) => findBeatSheetTemplate(held, templateId) !== undefined,
			(held) => deleteBeatSheetTemplate(held, templateId),
		);
		return wrote === "written" ? "deleted" : wrote;
	}

	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.store.evict(rootPath);
	}

	private reviseSheet(
		project: ProjectRef,
		sheetId: string,
		change: (held: BeatSheetDocument) => BeatSheetDocument | null,
	): Promise<BeatSheetWrite> {
		return this.revise(project, (held) => findBeatSheet(held, sheetId) !== undefined, change);
	}

	/** For what names an act of a sheet: an act that has gone is absent, and the change is not a no-op. */
	private reviseAct(
		project: ProjectRef,
		sheetId: string,
		actId: string,
		change: (held: BeatSheetDocument) => BeatSheetDocument | null,
	): Promise<BeatSheetWrite> {
		return this.revise(
			project,
			(held) => {
				const sheet = findBeatSheet(held, sheetId);
				return sheet !== undefined && findBeatSheetAct(sheet, actId) !== undefined;
			},
			change,
		);
	}

	private reviseBeat(
		project: ProjectRef,
		sheetId: string,
		beatId: string,
		change: (held: BeatSheetDocument) => BeatSheetDocument | null,
	): Promise<BeatSheetWrite> {
		return this.revise(
			project,
			(held) => {
				const sheet = findBeatSheet(held, sheetId);
				return sheet !== undefined && findBeat(sheet, beatId) !== null;
			},
			change,
		);
	}

	private reviseRow(
		project: ProjectRef,
		sheetId: string,
		rowId: string,
		change: (held: BeatSheetDocument) => BeatSheetDocument | null,
	): Promise<BeatSheetWrite> {
		return this.revise(
			project,
			(held) => {
				const sheet = findBeatSheet(held, sheetId);
				return sheet !== undefined && findBeatRow(sheet, rowId) !== null;
			},
			change,
		);
	}

	/**
	 * One change worked out against the file as it is: refused where the
	 * store would not take a write, absent where what it names is not
	 * there, written otherwise -- also where nothing needed changing, since
	 * the file then already says what was asked.
	 */
	private async revise(
		project: ProjectRef,
		found: (held: BeatSheetDocument) => boolean,
		change: (held: BeatSheetDocument) => BeatSheetDocument | null,
	): Promise<BeatSheetWrite> {
		let asked = false;
		let present = false;
		await this.store.updateDocument(project, (held) => {
			asked = true;
			if (!found(held)) return null;
			present = true;
			return change(held);
		});
		if (!asked) return "refused";
		return present ? "written" : "absent";
	}
}
