import {
	OBS_NOT_READY,
	OBS_SCENES,
	OBS_WINDOW_SPARE_INPUT,
	carryObsLoan,
	dataUrlBytes,
	isBlankBitmap,
	obsAllScreensPlan,
	obsCanvasPlan,
	obsCapturePlan,
	OBS_FILE_NAME_FORMAT,
	obsFolderKey,
	obsLoanIsReal,
	obsLoanKey,
	obsLoanProfile,
	obsLoanStands,
	obsListedScreens,
	obsMacWindowSettings,
	obsNativeSize,
	obsOutputSize,
	obsScreenInputName,
	obsScreenLayout,
	pickObsListItem,
	pickObsWindow,
	readObsJournal,
	type ObsCapturePlan,
	type ObsJournal,
	type ObsLoan,
	type DesktopFrame,
	type DesktopWindow,
	type ObsMacTarget,
	type ObsMeasuredItem,
	type ObsScreenPiece,
	type ObsSize,
	type RecordingErrorCode,
	type RecordingQuality,
	type RecordingScope,
	type RecordingSystem,
} from '../domain';
import {
	OBS_ANSWER_ENDED,
	OBS_ANSWER_SILENT,
	type ObsAnswer,
	type ObsConnection,
	type ObsEvent,
	type ObsSocket,
} from './obs-socket';
import {
	waitOn,
	type RecorderHooks,
	type RecorderStart,
	type RecorderStop,
	type RecordingTimers,
} from './recording-driver';

/**
 * OBS Studio as a recorder. The plugin asks an OBS on this computer to
 * record, follows the recording, and asks it to stop.
 *
 * For the length of one recording it borrows a few things of OBS's: the
 * folder OBS records into and the name it gives the file, the scene on air,
 * the size it writes at, and whether its microphone and desktop sound are
 * heard. How hard OBS compresses is never among them: OBS builds its
 * recorder around that setting when it starts, and one changed behind its
 * back leaves it answering a start and recording nothing. Each is written to a ledger on the device
 * before it is changed, and given back when the recording has stopped. A
 * value the author changed in OBS meanwhile is theirs and is left. A ledger
 * a crash left behind is settled at the next conversation.
 *
 * The plugin's own scene and source are made for one recording and taken
 * out of OBS when it ends. OBS's capture source goes on capturing for as
 * long as it is there, on air or not, and the system shows the author as
 * much. One the system has cut off keeps its last picture for good, since
 * OBS does not start a source again for settings it already has. So none
 * is ever kept, and every recording begins with a source made for it.
 *
 * A window source shows one window. Obsidian may have several: the main
 * one, and each a tab was moved out into. So a recording of Obsidian alone
 * begins on the window in use and follows the author from window to
 * window, and a window that closed hands over to the one in use, since a
 * source left on a window that is gone shows nothing.
 *
 * On a Mac the source is made anew for each window it follows to. OBS's
 * source there knows the windows that stood on the desk when it was made
 * and no others: set to the number of one opened since, it shows nothing
 * at all, however long it is left. A new source knows them all. It is made
 * hidden, muted and fitted, then shown, and the old one goes a moment
 * later, so the recording gets neither its sound, nor a picture out of
 * place, nor a gap between the two.
 *
 * OBS says it will record before it knows it can, and says it has stopped
 * before the file is closed, so a start is believed only once OBS reports
 * the recording running, and nothing is given back until it reports it
 * stopped.
 */

export interface ObsRecorderDeps {
	/** A conversation not yet opened. */
	socket(): ObsSocket;
	system(): RecordingSystem;
	/** The ledger's place on the device. */
	journal: { load(): unknown; save(journal: ObsJournal | null): void };
	timers: RecordingTimers;
	now(): number;
	/** Starts OBS where it can be started. False where it could not. */
	openObs(): Promise<boolean>;
	/** The top left corner of the screen Obsidian's window stands on, where the desktop says. */
	screenOrigin(): { x: number; y: number } | null;
	/**
	 * On a Mac, what the system itself calls the screen Obsidian is on, or
	 * every screen. Null where the system would not say.
	 */
	macTarget(scope: 'screen' | 'all'): Promise<ObsMacTarget | null>;
	/** The window of Obsidian's to show now: the one in use, or the main one. Null where there is none to name. */
	obsidianWindow(): DesktopWindow | null;
}

export interface ObsStart {
	port: number;
	password: string | null;
	/** The folder OBS is to record into. It must be there already: OBS makes none. */
	folder: string;
	scope: RecordingScope;
	quality: RecordingQuality;
	/** OBS may be opened where it does not answer. */
	mayOpen: boolean;
}

/** What a look at OBS found, with no recording made. */
export type ObsProbe =
	| {
			ok: true;
			version: string;
			/** What OBS would record, as a picture the settings can show, where OBS gave one. */
			picture: string | null;
			/** What stands in the way of a recording, where something does. */
			problem: RecordingErrorCode | null;
	  }
	| { ok: false; code: RecordingErrorCode };

/** OBS's answer codes the recorder reads. */
const OUTPUT_RUNNING = 500;
const NOT_FOUND = 600;
const ALREADY_EXISTS = 601;

const OPEN_WAIT_MS = 30_000;
const OPEN_RETRY_MS = 1500;
const READY_TRIES = 20;
const READY_WAIT_MS = 1000;
const START_SECONDS = 10;
const STOP_SECONDS = 60;
/** How long a quitting Obsidian waits for OBS to close the file. */
const SETTLE_SECONDS = 3;
const HEARTBEAT_MS = 5000;
const RECONNECTS = 5;
const RECONNECT_MS = 3000;
const BLANK_TRIES = 6;
const BLANK_WAIT_MS = 500;
/** A source new in OBS has no size until its first picture comes: it is asked again for a while. */
const SIZE_TRIES = 10;
const SIZE_WAIT_MS = 300;
const PICTURE_WIDTH = 480;
/** How long a move between Obsidian's windows is left to settle before the source follows. */
export const FOLLOW_WAIT_MS = 150;
/** A window OBS does not list yet is asked for again: one just opened has no title of its own at first. */
const FOLLOW_TRIES = 3;
const FOLLOW_RETRY_MS = 1000;
/** How long a source made anew is given to find its first picture before the one it replaces goes. */
export const SWAP_SETTLE_MS = 200;
/** OBS keeps a source's name a moment after the source has gone: the name is asked for again. */
const SWAP_TRIES = 10;
const SWAP_WAIT_MS = 100;

const SPECIAL_INPUTS = ['desktop1', 'desktop2', 'mic1', 'mic2', 'mic3', 'mic4'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null =>
	typeof value === 'string' && value.length > 0 ? value : null;
const figure = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? value : null;
const strings = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const sizeOf = (width: unknown, height: unknown): ObsSize | null => {
	const w = figure(width);
	const h = figure(height);
	return w === null || h === null ? null : { width: w, height: h };
};

/** Whether the conversation, and not OBS, failed to answer. */
const unanswered = (answer: ObsAnswer): boolean =>
	!answer.ok && (answer.code === OBS_ANSWER_ENDED || answer.code === OBS_ANSWER_SILENT);

function connectionError(reason: Exclude<ObsConnection, { ok: true }>['reason']): RecordingErrorCode {
	if (reason === 'password-needed' || reason === 'password-wrong') return 'obs-password';
	return reason === 'old' ? 'obs-old' : 'obs-closed';
}

/** Two folders as OBS and the plugin may each write the same one. */
function sameFolder(left: string | null, right: string): boolean {
	const trim = (path: string): string => path.replace(/[\\/]+$/u, '');
	return left !== null && trim(left) === trim(right);
}

export class ObsRecorder {
	private socket: ObsSocket | null = null;
	private releases: (() => void)[] = [];
	private readonly loans: ObsLoan[];
	private hooks: RecorderHooks | null = null;
	private working = false;
	private recording = false;
	private stopping = false;
	private sawStarted = false;
	private sawStopped = false;
	private path: string | null = null;
	private heartbeat: unknown = null;
	private port = 0;
	private password: string | null = null;
	private formats: string[] = [];
	private run = 0;
	/** This conversation reached the point where a scene of the plugin's may be in OBS. */
	private staged = false;
	/** How many screens the scene of every screen was given a source for in this conversation. */
	private screens = 0;
	/**
	 * The plugin's source for Obsidian's window, while there is one: its
	 * scene, its name now, how it is pointed, the part of the canvas it is
	 * fitted to where the canvas's size is known, and the window it shows.
	 */
	private aimed: {
		scene: string;
		input: string;
		plan: Extract<ObsCapturePlan, { kind: 'ready' }>;
		region: DesktopFrame | null;
		window: object;
	} | null = null;
	/**
	 * The plugin's scene of this conversation: its sources by their places
	 * in the scene, each with where its screen stands on the desk where it
	 * is one of several.
	 */
	private shown: { scene: string; items: { item: number; frame: DesktopFrame | null }[] } | null = null;
	/** The window the author moved to and the source has yet to follow. */
	private wanted: DesktopWindow | null = null;
	private followTimer: unknown = null;
	/** The run whose source is being pointed anew, while it is. */
	private turning: number | null = null;

	constructor(private readonly deps: ObsRecorderDeps) {
		this.loans = readObsJournal(deps.journal.load())?.loans ?? [];
	}

	/** True while something borrowed from OBS has not been given back. */
	get owes(): boolean {
		return this.loans.length > 0;
	}

	async start(request: ObsStart, hooks: RecorderHooks): Promise<RecorderStart> {
		if (this.working || this.recording) return { ok: false, code: 'obs-recording', detail: null };
		this.working = true;
		this.run += 1;
		this.hooks = hooks;
		this.stopping = false;
		try {
			return await this.begin(request, hooks);
		} finally {
			this.working = false;
		}
	}

	/** Stops the recording, waits for OBS to close the file, and gives back what was borrowed. */
	async stop(): Promise<RecorderStop> {
		return this.end(STOP_SECONDS);
	}

	/** The same for an Obsidian that is quitting and cannot wait long: what is not given back stays in the ledger. */
	async settle(): Promise<RecorderStop> {
		return this.end(SETTLE_SECONDS);
	}

	/**
	 * The plugin is going away this instant: OBS is asked to stop and not
	 * waited for. What was borrowed stays in the ledger for the next
	 * conversation.
	 */
	abandon(): void {
		if (this.recording) {
			void this.ask('StopRecord');
			// Its scene goes too, unwaited for, or its source would capture on with nobody to end it.
			void this.tidy();
		}
		this.finish();
	}

	/**
	 * The author moved to another of Obsidian's windows, or the window the
	 * recording shows closed: the plugin's source follows to the window
	 * given. A burst of moves settles first, and only the last is followed.
	 * Nothing happens where no recording of Obsidian alone runs.
	 */
	follow(window: DesktopWindow): void {
		if (!this.recording || this.stopping || this.aimed === null) return;
		this.wanted = window;
		this.deps.timers.clear(this.followTimer);
		this.followTimer = this.deps.timers.set(() => {
			void this.turn();
		}, FOLLOW_WAIT_MS);
	}

	/**
	 * Looks at OBS without recording: whether it answers, which version it
	 * is, and what it would record. For a scene of the plugin's own that
	 * scene is put on air for the moment of the look and taken off again.
	 * An OBS that is closed is opened first where it may be, as a start
	 * opens it, and `onOpening` is told: a look that failed because the
	 * author had not opened OBS by hand would say nothing of a recording,
	 * which never asks that of them. OBS is left open after the look.
	 */
	async probe(
		request: { port: number; password: string | null; scope: RecordingScope; mayOpen: boolean },
		onOpening: () => void = () => {},
	): Promise<ObsProbe> {
		if (this.working || this.recording) return { ok: false, code: 'obs-recording' };
		this.working = true;
		try {
			const link = await this.reach(request.port, request.password, request.mayOpen, {
				opening: onOpening,
				cancelled: () => false,
			});
			if (!link.ok) return { ok: false, code: link.reason === 'cancelled' ? 'obs-closed' : connectionError(link.reason) };
			const greeted = await this.greet();
			if (!greeted.ok) {
				this.hangUp();
				return { ok: false, code: greeted.code };
			}
			let problem: RecordingErrorCode | null = null;
			let picture: string | null = null;
			const status = await this.ask('GetRecordStatus');
			if (status.ok && status.data.outputActive === true) {
				// Something records already: OBS is looked at as it stands and nothing in it is moved.
				problem = this.loans.length === 0 ? 'obs-recording' : null;
				picture = await this.picture(await this.programScene());
			} else {
				await this.giveBack();
				await this.tidy();
				let scene = await this.programScene();
				if (request.scope !== 'obs') {
					const made = await this.prepareScene(request.scope);
					if (made.ok) scene = made.scene;
					else problem = made.code;
				} else if (scene !== null && (await this.sceneIsEmpty(scene))) {
					problem = 'obs-empty';
				}
				if (problem === null && scene !== null && (await this.blank(scene))) problem = 'obs-blank';
				picture = problem === null || problem === 'obs-blank' ? await this.picture(scene) : null;
				await this.giveBack();
				await this.tidy();
			}
			this.hangUp();
			return { ok: true, version: greeted.version, picture, problem };
		} finally {
			this.working = false;
		}
	}

	// ---- A start ----

	/**
	 * Opens the conversation, and OBS itself first where nothing answers
	 * and OBS may be opened. OBS takes some seconds to come up: it is asked
	 * again until it answers or half a minute has gone. Where it could not
	 * be opened at all, the answer is the one the closed OBS gave.
	 */
	private async reach(
		port: number,
		password: string | null,
		mayOpen: boolean,
		on: { opening(): void; cancelled(): boolean },
	): Promise<ObsConnection | { ok: false; reason: 'cancelled' }> {
		let link = await this.converse(port, password);
		const closed = (): boolean => !link.ok && (link.reason === 'refused' || link.reason === 'silent');
		if (!closed() || !mayOpen) return link;
		on.opening();
		if (!(await this.deps.openObs())) return link;
		const until = this.deps.now() + OPEN_WAIT_MS;
		while (closed() && this.deps.now() < until) {
			await waitOn(this.deps.timers, OPEN_RETRY_MS);
			if (on.cancelled()) return { ok: false, reason: 'cancelled' };
			link = await this.converse(port, password);
		}
		return link;
	}

	private async begin(request: ObsStart, hooks: RecorderHooks): Promise<RecorderStart> {
		const link = await this.reach(request.port, request.password, request.mayOpen, {
			opening: () => {
				hooks.phase('opening');
			},
			cancelled: () => hooks.cancelled(),
		});
		if (!link.ok) return this.giveUp(link.reason === 'cancelled' ? 'cancelled' : connectionError(link.reason), null);
		this.port = request.port;
		this.password = request.password;
		hooks.phase('starting');
		const greeted = await this.greet();
		if (!greeted.ok) return this.giveUp(greeted.code, null);

		const status = await this.ask('GetRecordStatus');
		if (!status.ok) return this.giveUp('obs-refused', 'GetRecordStatus');
		if (status.data.outputActive === true) {
			if (this.loans.length === 0) return this.giveUp('obs-recording', null);
			// OBS is still making the recording an earlier run of the plugin
			// asked for: it is taken up where it was left, and stopping it
			// gives back what that run borrowed.
			this.staged = true;
			this.recording = true;
			this.beat();
			return {
				ok: true,
				startedAt: this.deps.now() - (figure(status.data.outputDuration) ?? 0),
				path: null,
			};
		}
		// Nothing records: whatever an earlier run left borrowed goes back
		// first, and whatever it left of its own in OBS is taken away.
		await this.giveBack();
		this.staged = true;
		await this.tidy();

		const profile = await this.profile();
		if (profile === null) return this.giveUp('obs-refused', 'GetProfileList');
		const mode = await this.parameter('Output', 'Mode');
		const recordType = mode.value === 'Advanced' ? (await this.parameter('AdvOut', 'RecType')).value : null;
		const folderKey = obsFolderKey(mode.value, recordType);
		if (!(await this.borrowParameter(profile, folderKey.category, folderKey.name, request.folder))) {
			return this.giveUp('obs-refused', 'folder');
		}
		const directory = await this.ask('GetRecordDirectory');
		if (directory.ok && !sameFolder(text(directory.data.recordDirectory), request.folder)) {
			return this.giveUp('obs-refused', 'folder');
		}
		if (!(await this.borrowParameter(profile, 'Output', 'FilenameFormatting', OBS_FILE_NAME_FORMAT))) {
			return this.giveUp('obs-refused', 'name');
		}
		if (hooks.cancelled()) return this.giveUp('cancelled', null);

		let scene: string | null;
		if (request.scope === 'obs') {
			scene = await this.programScene();
			if (scene === null) return this.giveUp('obs-refused', 'scene');
			if (await this.sceneIsEmpty(scene)) return this.giveUp('obs-empty', null);
		} else {
			const made = await this.prepareScene(request.scope);
			if (!made.ok) return this.giveUp(made.code, null);
			scene = made.scene;
			if (!(await this.silence())) return this.giveUp('obs-refused', 'mute');
		}

		if (request.quality !== 'original') {
			await this.borrowQuality(profile, request.quality, hooks);
		}

		if (await this.blank(scene)) return this.giveUp('obs-blank', null);
		if (hooks.cancelled()) return this.giveUp('cancelled', null);
		// Everything is ready. The author is counted in, and may still give the start up.
		if (!(await hooks.hold())) return this.giveUp('cancelled', null);

		this.sawStarted = false;
		this.sawStopped = false;
		this.path = null;
		const asked = await this.ask('StartRecord');
		if (!asked.ok) {
			return this.giveUp(asked.code === OUTPUT_RUNNING ? 'obs-recording' : 'obs-refused', asked.comment);
		}
		if (!(await this.confirmStarted())) return this.giveUp('obs-refused', 'StartRecord');
		this.recording = true;
		this.beat();
		return { ok: true, startedAt: this.deps.now(), path: this.path };
	}

	/** A start that came to nothing: what it borrowed goes back and the conversation ends. */
	private async giveUp(code: RecordingErrorCode | 'cancelled', detail: string | null): Promise<RecorderStart> {
		await this.giveBack();
		// An OBS that never got as far as a scene of the plugin's is asked for nothing more:
		// one that records something of the author's own least of all.
		if (this.staged) await this.tidy();
		this.finish();
		return { ok: false, code, detail };
	}

	/**
	 * OBS's version, asked until its window is ready: a freshly opened OBS
	 * answers the socket before it can do anything, and says so.
	 */
	private async greet(): Promise<{ ok: true; version: string } | { ok: false; code: RecordingErrorCode }> {
		for (let attempt = 0; attempt < READY_TRIES; attempt += 1) {
			const answer = await this.ask('GetVersion');
			if (answer.ok) {
				this.formats = strings(answer.data.supportedImageFormats);
				return { ok: true, version: text(answer.data.obsVersion) ?? '' };
			}
			if (answer.code !== OBS_NOT_READY) return { ok: false, code: unanswered(answer) ? 'obs-closed' : 'obs-old' };
			await waitOn(this.deps.timers, READY_WAIT_MS);
		}
		return { ok: false, code: 'obs-closed' };
	}

	private async confirmStarted(): Promise<boolean> {
		for (let second = 0; second < START_SECONDS; second += 1) {
			if (this.sawStarted) return true;
			const status = await this.ask('GetRecordStatus');
			if (status.ok && status.data.outputActive === true) return true;
			if (unanswered(status) && this.socket === null) return false;
			await waitOn(this.deps.timers, READY_WAIT_MS);
		}
		return this.sawStarted;
	}

	// ---- The scene ----

	/**
	 * Takes the plugin's own scenes and sources out of OBS, whichever are
	 * there. What is not there answers that it is not, and that is all.
	 * OBS will not part with its last scene: one of the plugin's that is the
	 * only scene left stays. All of it is asked for at once, in order, so a
	 * plugin that goes this instant has still asked.
	 */
	private async tidy(): Promise<void> {
		this.aimed = null;
		this.shown = null;
		// The sources of the scene of every screen go by their numbers, then the scene, which takes with it any an earlier run left.
		const screens = Array.from({ length: this.screens }, (_unused, index) =>
			this.ask('RemoveInput', { inputName: obsScreenInputName(index) }),
		);
		this.screens = 0;
		await Promise.all([
			...screens,
			...Object.values(OBS_SCENES).flatMap((names) => [
				this.ask('RemoveInput', { inputName: names.input }),
				this.ask('RemoveScene', { sceneName: names.scene }),
			]),
			// The source for Obsidian's window may stand under its second name.
			this.ask('RemoveInput', { inputName: OBS_WINDOW_SPARE_INPUT }),
		]);
	}

	/**
	 * Makes the plugin's scene for a scope in OBS, with its source pointed
	 * at the right thing, muted and fitted to the canvas, and puts it on
	 * air. Every screen at once is a source for each screen, laid out on the
	 * canvas as the screens stand on the desk. All of it is made anew for
	 * each recording. Where something could not be taken away beforehand, it
	 * is used as it stands rather than made twice.
	 */
	private async prepareScene(
		scope: Exclude<RecordingScope, 'obs'>,
	): Promise<{ ok: true; scene: string } | { ok: false; code: RecordingErrorCode }> {
		const names = OBS_SCENES[scope];
		const refused = { ok: false, code: 'obs-refused' } as const;
		const impossible = { ok: false, code: 'obs-scene' } as const;
		const list = await this.ask('GetSceneList');
		if (!list.ok) return refused;
		const current = text(list.data.currentProgramSceneName);
		const scenes = Array.isArray(list.data.scenes) ? (list.data.scenes as unknown[]) : [];
		const answered = await this.ask('GetInputKindList');
		if (!answered.ok) return refused;
		const kinds = strings(answered.data.inputKinds);
		const system = this.deps.system();
		// Obsidian alone is the window in use: a tab moved out into a window of its own is Obsidian too.
		const window = scope === 'obsidian' ? this.deps.obsidianWindow() : null;
		let mac: ObsMacTarget | null = null;
		if (system === 'mac') {
			if (scope !== 'obsidian') mac = await this.deps.macTarget(scope);
			else if (window !== null && window.id !== null) mac = { windowId: window.id };
		}
		const single = scope === 'all' ? null : obsCapturePlan(system, scope, kinds, mac);
		const several = scope === 'all' ? obsAllScreensPlan(system, kinds, mac) : null;
		if (single?.kind === 'none' || several?.kind === 'none') return impossible;
		if (!scenes.some((entry) => isRecord(entry) && entry.sceneName === names.scene)) {
			const created = await this.ask('CreateScene', { sceneName: names.scene });
			if (!created.ok && created.code !== ALREADY_EXISTS) return impossible;
		}
		const video = await this.ask('GetVideoSettings');
		const base = video.ok ? sizeOf(video.data.baseWidth, video.data.baseHeight) : null;

		if (single !== null && single.kind === 'ready') {
			const item = await this.input(names.scene, names.input, single.inputKind, single.settings);
			if (item === null) return impossible;
			const settings: Record<string, unknown> = { ...single.settings };
			if (single.pick !== null) {
				// The value is one of those OBS itself lists: none is ever made up.
				const listed = await this.ask('GetInputPropertiesListPropertyItems', {
					inputName: names.input,
					propertyName: single.pick.property,
				});
				const picked =
					listed.ok && Array.isArray(listed.data.propertyItems)
						? pickObsListItem(
								listed.data.propertyItems as unknown[],
								single.pick.rule,
								this.deps.screenOrigin(),
								window?.title ?? null,
							)
						: null;
				if (picked === null) return impossible;
				settings[single.pick.property] = picked;
			}
			const set = await this.ask('SetInputSettings', { inputName: names.input, inputSettings: settings, overlay: true });
			if (!set.ok) return impossible;
			if (!(await this.hush(names.input))) return refused;
			const region = base === null ? null : { x: 0, y: 0, width: base.width, height: base.height };
			if (region !== null) await this.fit(names.scene, item, region);
			this.shown = { scene: names.scene, items: [{ item, frame: null }] };
			if (window !== null) {
				this.aimed = { scene: names.scene, input: names.input, plan: single, region, window: window.key };
			}
		}

		if (several !== null) {
			let pieces: ObsScreenPiece[] | null;
			if (several.kind === 'pieces') pieces = several.pieces;
			else {
				// OBS is asked for its screens through a first source, which then becomes the first screen's.
				const first = obsScreenInputName(0);
				this.screens = 1;
				if ((await this.input(names.scene, first, several.inputKind, several.settings)) === null) return impossible;
				const listed = await this.ask('GetInputPropertiesListPropertyItems', {
					inputName: first,
					propertyName: several.property,
				});
				pieces =
					listed.ok && Array.isArray(listed.data.propertyItems)
						? obsListedScreens(listed.data.propertyItems as unknown[], several.property, several.settings)
						: null;
			}
			// Without the canvas's size, or a screen's, nothing can be put in its place.
			const layout = pieces === null || base === null ? null : obsScreenLayout(pieces.map((piece) => piece.frame), base);
			if (pieces === null || layout === null) return impossible;
			this.screens = pieces.length;
			const placed: { item: number; frame: DesktopFrame | null }[] = [];
			for (const [index, piece] of pieces.entries()) {
				const name = obsScreenInputName(index);
				const item = await this.input(names.scene, name, several.inputKind, piece.settings);
				if (item === null) return impossible;
				const set = await this.ask('SetInputSettings', { inputName: name, inputSettings: piece.settings, overlay: true });
				if (!set.ok) return impossible;
				if (!(await this.hush(name))) return refused;
				const region = layout[index];
				if (region !== undefined) await this.fit(names.scene, item, region);
				placed.push({ item, frame: piece.frame });
			}
			this.shown = { scene: names.scene, items: placed };
		}

		if (current !== names.scene) {
			const onAir = await this.borrow(
				{ kind: 'scene', before: current ?? names.scene, after: names.scene },
				() => this.ask('SetCurrentProgramScene', { sceneName: names.scene }),
			);
			if (!onAir) return impossible;
		}
		return { ok: true, scene: names.scene };
	}

	/** A source in a scene of the plugin's, made, or found where it could not be taken away before. Its place in the scene, or null. */
	private async input(
		scene: string,
		name: string,
		kind: string,
		settings: Record<string, unknown>,
	): Promise<number | null> {
		const there = await this.sceneItem(scene, name);
		if (there !== null) return there;
		const made = await this.ask('CreateInput', {
			sceneName: scene,
			inputName: name,
			inputKind: kind,
			inputSettings: settings,
			sceneItemEnabled: true,
		});
		if (made.ok) return figure(made.data.sceneItemId);
		if (made.code !== ALREADY_EXISTS) return null;
		// The source outlived its scene: it is put back into the scene rather than made twice.
		const placed = await this.ask('CreateSceneItem', { sceneName: scene, sourceName: name });
		return placed.ok ? figure(placed.data.sceneItemId) : null;
	}

	/** Puts a source into a part of the canvas, whole and unstretched. */
	private async fit(scene: string, item: number, region: DesktopFrame): Promise<void> {
		await this.ask('SetSceneItemTransform', {
			sceneName: scene,
			sceneItemId: item,
			sceneItemTransform: {
				positionX: region.x,
				positionY: region.y,
				alignment: 5,
				boundsType: 'OBS_BOUNDS_SCALE_INNER',
				boundsAlignment: 0,
				boundsWidth: region.width,
				boundsHeight: region.height,
			},
		});
	}

	private async sceneItem(scene: string, source: string): Promise<number | null> {
		const found = await this.ask('GetSceneItemId', { sceneName: scene, sourceName: source });
		return found.ok ? figure(found.data.sceneItemId) : null;
	}

	private async sceneIsEmpty(scene: string): Promise<boolean> {
		const items = await this.ask('GetSceneItemList', { sceneName: scene });
		return items.ok && Array.isArray(items.data.sceneItems) && items.data.sceneItems.length === 0;
	}

	private async programScene(): Promise<string | null> {
		const list = await this.ask('GetSceneList');
		return list.ok ? text(list.data.currentProgramSceneName) : null;
	}

	/**
	 * The plugin's own source can carry sound of its own: macOS's screen
	 * capture brings the computer's sound with the picture. The source is
	 * the plugin's, so it is muted and stays muted, with nothing to give
	 * back. A source with no sound answers that it has none. False where a
	 * source that is heard could not be muted.
	 */
	private async hush(input: string): Promise<boolean> {
		const state = await this.ask('GetInputMute', { inputName: input });
		if (!state.ok || state.data.inputMuted !== false) return true;
		return (await this.ask('SetInputMute', { inputName: input, inputMuted: true })).ok;
	}

	/**
	 * OBS mixes its microphone and desktop sound into every recording,
	 * whatever the scene shows. A recording of the writing carries no sound,
	 * so each one that is heard is muted for its length. False where one
	 * that is heard could not be muted: the recording is then not made.
	 */
	private async silence(): Promise<boolean> {
		const special = await this.ask('GetSpecialInputs');
		if (!special.ok) return false;
		for (const key of SPECIAL_INPUTS) {
			const input = text(special.data[key]);
			if (input === null) continue;
			const state = await this.ask('GetInputMute', { inputName: input });
			if (!state.ok || state.data.inputMuted !== false) continue;
			const muted = await this.borrow({ kind: 'mute', input, before: false, after: true }, () =>
				this.ask('SetInputMute', { inputName: input, inputMuted: true }),
			);
			if (!muted) return false;
		}
		return true;
	}

	/**
	 * Sets how large the picture is written. For a scene of the plugin's
	 * own the canvas is borrowed too and made the size of what the scene
	 * shows: everything is then drawn pixel for pixel, and only OBS's own
	 * scaler, which is made for it, ever makes the picture smaller. For the
	 * author's scene the canvas is theirs to lay out and stays, and only
	 * the size OBS writes at is touched. OBS refuses either while another
	 * output of its runs: the recording then goes ahead at OBS's own size,
	 * and the author is told.
	 */
	private async borrowQuality(
		profile: string,
		quality: Exclude<RecordingQuality, 'original'>,
		hooks: RecorderHooks,
	): Promise<void> {
		const video = await this.ask('GetVideoSettings');
		let base = video.ok ? sizeOf(video.data.baseWidth, video.data.baseHeight) : null;
		const output = video.ok ? sizeOf(video.data.outputWidth, video.data.outputHeight) : null;
		if (base === null || output === null) return;
		const shown = this.shown;
		const measured = shown === null ? null : await this.measure(shown);
		const native = measured === null ? null : obsNativeSize(measured);
		const plan = native === null ? null : obsCanvasPlan(native);
		if (shown !== null && plan !== null) {
			const canvas = plan.canvas;
			const widened = await this.borrow({ kind: 'canvas', profile, before: base, after: canvas }, () =>
				this.ask('SetVideoSettings', { baseWidth: canvas.width, baseHeight: canvas.height }),
			);
			if (!widened) {
				hooks.notice('quality-kept');
				return;
			}
			base = canvas;
			await this.arrange(shown, plan.area);
		}
		const target = obsOutputSize(base, quality);
		if (target === null) return;
		const sized = await this.borrow({ kind: 'output-size', profile, before: output, after: target }, () =>
			this.ask('SetVideoSettings', { outputWidth: target.width, outputHeight: target.height }),
		);
		if (!sized) hooks.notice('quality-kept');
	}

	/**
	 * How large each source of the scene is, as OBS measures it. A source
	 * just made has no size until its first picture comes, so OBS is asked
	 * again for a while. Null where a source never said: the canvas then
	 * stays as it is.
	 */
	private async measure(shown: {
		scene: string;
		items: { item: number; frame: DesktopFrame | null }[];
	}): Promise<ObsMeasuredItem[] | null> {
		for (let attempt = 0; attempt < SIZE_TRIES; attempt += 1) {
			const measured: ObsMeasuredItem[] = [];
			for (const entry of shown.items) {
				const answer = await this.ask('GetSceneItemTransform', { sceneName: shown.scene, sceneItemId: entry.item });
				if (!answer.ok) return null;
				const transform = isRecord(answer.data.sceneItemTransform) ? answer.data.sceneItemTransform : null;
				const source = transform === null ? null : sizeOf(transform.sourceWidth, transform.sourceHeight);
				if (source === null || !(source.width > 0) || !(source.height > 0)) break;
				measured.push({ source, frame: entry.frame });
			}
			if (measured.length === shown.items.length) return measured;
			await waitOn(this.deps.timers, SIZE_WAIT_MS);
		}
		return null;
	}

	/**
	 * Puts the scene's sources in their places again on a canvas made
	 * anew: one source over the whole of the part the picture takes, several
	 * screens as they stand on the desk. A window's source that follows the
	 * author later is fitted to the same part.
	 */
	private async arrange(
		shown: { scene: string; items: { item: number; frame: DesktopFrame | null }[] },
		area: ObsSize,
	): Promise<void> {
		const whole = { x: 0, y: 0, width: area.width, height: area.height };
		const desk = shown.items.flatMap((entry) => (entry.frame === null ? [] : [entry.frame]));
		const layout = desk.length > 0 && desk.length === shown.items.length ? obsScreenLayout(desk, area) : null;
		for (const [index, entry] of shown.items.entries()) {
			await this.fit(shown.scene, entry.item, layout?.[index] ?? whole);
		}
		if (this.aimed !== null) this.aimed = { ...this.aimed, region: whole };
	}

	/** Whether the scene's picture is one flat color, asked a few times while a source new on air finds its first frame. */
	private async blank(scene: string): Promise<boolean> {
		if (!this.formats.includes('bmp')) return false;
		for (let attempt = 0; attempt < BLANK_TRIES; attempt += 1) {
			const shot = await this.ask('GetSourceScreenshot', {
				sourceName: scene,
				imageFormat: 'bmp',
				imageWidth: 32,
				imageHeight: 18,
			});
			if (!shot.ok) return false;
			const bytes = dataUrlBytes(text(shot.data.imageData) ?? '');
			if (bytes === null || isBlankBitmap(bytes) !== true) return false;
			await waitOn(this.deps.timers, BLANK_WAIT_MS);
		}
		return true;
	}

	private async picture(scene: string | null): Promise<string | null> {
		if (scene === null) return null;
		const format = ['jpg', 'png', 'bmp'].find((candidate) => this.formats.includes(candidate));
		if (format === undefined) return null;
		const shot = await this.ask('GetSourceScreenshot', {
			sourceName: scene,
			imageFormat: format,
			imageWidth: PICTURE_WIDTH,
		});
		const data = shot.ok ? text(shot.data.imageData) : null;
		return data !== null && data.startsWith('data:image/') ? data : null;
	}

	// ---- The ledger ----

	private saveLedger(): void {
		this.deps.journal.save(this.loans.length === 0 ? null : { version: 1, loans: [...this.loans] });
	}

	/**
	 * Borrows one thing: written down first, then changed. A loan whose
	 * value already stands as asked changes nothing and owes nothing. One
	 * an earlier ledger never got back keeps the value written down then.
	 */
	private async borrow(planned: ObsLoan, apply: () => Promise<ObsAnswer>): Promise<boolean> {
		const at = this.loans.findIndex((entry) => obsLoanKey(entry) === obsLoanKey(planned));
		const earlier = at === -1 ? null : (this.loans[at] ?? null);
		const loan = carryObsLoan(planned, this.loans);
		if (at !== -1) this.loans.splice(at, 1);
		if (obsLoanIsReal(loan)) this.loans.push(loan);
		this.saveLedger();
		if (!obsLoanIsReal(planned)) return true;
		const answer = await apply();
		if (answer.ok) return true;
		// Not changed after all: this run owes nothing for it, though an earlier one still may.
		const mine = this.loans.indexOf(loan);
		if (mine !== -1) this.loans.splice(mine, 1);
		if (earlier !== null) this.loans.push(earlier);
		this.saveLedger();
		return false;
	}

	private async borrowParameter(profile: string, category: string, name: string, value: string): Promise<boolean> {
		const current = await this.parameter(category, name);
		if (!current.known) return false;
		return this.borrow({ kind: 'parameter', profile, category, name, before: current.value, after: value }, () =>
			this.ask('SetProfileParameter', {
				parameterCategory: category,
				parameterName: name,
				parameterValue: value,
			}),
		);
	}

	private async parameter(category: string, name: string): Promise<{ known: boolean; value: string | null }> {
		const answer = await this.ask('GetProfileParameter', { parameterCategory: category, parameterName: name });
		if (!answer.ok) return { known: false, value: null };
		const value = answer.data.parameterValue;
		return { known: true, value: typeof value === 'string' ? value : null };
	}

	private async profile(): Promise<string | null> {
		const answer = await this.ask('GetProfileList');
		return answer.ok ? text(answer.data.currentProfileName) : null;
	}

	/** What OBS holds now where a loan was made, or that it could not be asked. */
	private async current(loan: ObsLoan): Promise<{ state: 'read'; value: unknown } | { state: 'gone' } | { state: 'unanswered' }> {
		let answer: ObsAnswer;
		let read: (data: Record<string, unknown>) => unknown;
		if (loan.kind === 'parameter') {
			answer = await this.ask('GetProfileParameter', {
				parameterCategory: loan.category,
				parameterName: loan.name,
			});
			read = (data) => (typeof data.parameterValue === 'string' ? data.parameterValue : null);
		} else if (loan.kind === 'output-size') {
			answer = await this.ask('GetVideoSettings');
			read = (data) => sizeOf(data.outputWidth, data.outputHeight);
		} else if (loan.kind === 'canvas') {
			answer = await this.ask('GetVideoSettings');
			read = (data) => sizeOf(data.baseWidth, data.baseHeight);
		} else if (loan.kind === 'mute') {
			answer = await this.ask('GetInputMute', { inputName: loan.input });
			read = (data) => data.inputMuted;
		} else {
			answer = await this.ask('GetSceneList');
			read = (data) => text(data.currentProgramSceneName);
		}
		if (answer.ok) return { state: 'read', value: read(answer.data) };
		// OBS answered and has no such thing any more: there is nothing to give back to.
		return unanswered(answer) ? { state: 'unanswered' } : { state: 'gone' };
	}

	private returnLoan(loan: ObsLoan): Promise<ObsAnswer> {
		if (loan.kind === 'parameter') {
			return this.ask('SetProfileParameter', {
				parameterCategory: loan.category,
				parameterName: loan.name,
				parameterValue: loan.before,
			});
		}
		if (loan.kind === 'output-size') {
			return this.ask('SetVideoSettings', { outputWidth: loan.before.width, outputHeight: loan.before.height });
		}
		if (loan.kind === 'canvas') {
			return this.ask('SetVideoSettings', { baseWidth: loan.before.width, baseHeight: loan.before.height });
		}
		if (loan.kind === 'mute') {
			return this.ask('SetInputMute', { inputName: loan.input, inputMuted: loan.before });
		}
		return this.ask('SetCurrentProgramScene', { sceneName: loan.before });
	}

	/**
	 * Gives back what is on loan, the last borrowed first. A value OBS no
	 * longer holds as the plugin left it is the author's and is struck out
	 * unreturned. A setting of a profile not in use waits for that profile,
	 * and one OBS would not take back waits for the next conversation.
	 */
	private async giveBack(): Promise<void> {
		if (this.loans.length === 0) return;
		const profile = await this.profile();
		for (const loan of [...this.loans].reverse()) {
			const owner = obsLoanProfile(loan);
			if (owner !== null && owner !== profile) continue;
			const held = await this.current(loan);
			if (held.state === 'unanswered') continue;
			let settled = held.state === 'gone' || !obsLoanStands(loan, held.value);
			if (!settled) {
				const returned = await this.returnLoan(loan);
				// What OBS no longer has cannot be given back to: a scene the author deleted meanwhile.
				settled = returned.ok || returned.code === NOT_FOUND;
			}
			if (!settled) continue;
			const at = this.loans.indexOf(loan);
			if (at !== -1) this.loans.splice(at, 1);
			this.saveLedger();
		}
	}

	// ---- While it records ----

	/**
	 * Points the source at the window the author moved to, and at the next
	 * one if they moved again meanwhile. One run of this at a time: a second
	 * call while it works leaves its window to be picked up at the end.
	 */
	private async turn(): Promise<void> {
		const run = this.run;
		if (this.turning === run) return;
		this.turning = run;
		const live = (): boolean => run === this.run && this.recording && !this.stopping && this.aimed !== null;
		try {
			let tries = 0;
			while (this.wanted !== null && live()) {
				const next = this.wanted;
				this.wanted = null;
				if (this.aimed === null || next.key === this.aimed.window) {
					tries = 0;
					continue;
				}
				const settings = await this.windowSettings(this.aimed, next);
				if (!live() || this.aimed === null) return;
				if (settings !== null) {
					tries = 0;
					const moved = await this.point(this.aimed, settings, live);
					if (!live() || this.aimed === null) return;
					if (moved) this.aimed.window = next.key;
					continue;
				}
				// Not found in OBS: asked for again a few times, unless the author has moved on.
				tries += 1;
				if (tries >= FOLLOW_TRIES) {
					tries = 0;
					continue;
				}
				await waitOn(this.deps.timers, FOLLOW_RETRY_MS);
				if (!live()) return;
				if (this.wanted !== null) {
					tries = 0;
					continue;
				}
				// The same window, as it reads now: its title may have come meanwhile.
				const fresh = this.deps.obsidianWindow();
				this.wanted = fresh !== null && fresh.key === next.key ? fresh : next;
			}
		} finally {
			if (this.turning === run) this.turning = null;
		}
	}

	/**
	 * Shows another window. Off a Mac the source is set to it: OBS looks the
	 * window up afresh there. On a Mac a new source is made for it, under
	 * the other of the source's two names, and takes the old one's place.
	 * False where the window could not be shown: the old source then stays.
	 */
	private async point(
		aimed: NonNullable<ObsRecorder['aimed']>,
		settings: Record<string, unknown>,
		live: () => boolean,
	): Promise<boolean> {
		if (aimed.plan.pick !== null) {
			return (await this.ask('SetInputSettings', { inputName: aimed.input, inputSettings: settings, overlay: true })).ok;
		}
		const old = aimed.input;
		const name = old === OBS_SCENES.obsidian.input ? OBS_WINDOW_SPARE_INPUT : OBS_SCENES.obsidian.input;
		let item: number | null = null;
		for (let attempt = 0; attempt < SWAP_TRIES && item === null; attempt += 1) {
			// Hidden at first: a source shown as it is made is neither muted nor in its place yet.
			const made = await this.ask('CreateInput', {
				sceneName: aimed.scene,
				inputName: name,
				inputKind: aimed.plan.inputKind,
				inputSettings: settings,
				sceneItemEnabled: false,
			});
			if (made.ok) item = figure(made.data.sceneItemId);
			else if (made.code !== ALREADY_EXISTS) return false;
			else {
				await waitOn(this.deps.timers, SWAP_WAIT_MS);
				if (!live()) return false;
			}
		}
		if (item === null) return false;
		let shown = await this.hush(name);
		if (shown && aimed.region !== null) await this.fit(aimed.scene, item, aimed.region);
		shown =
			shown &&
			(await this.ask('SetSceneItemEnabled', { sceneName: aimed.scene, sceneItemId: item, sceneItemEnabled: true })).ok;
		if (!shown) {
			// It could not be muted or shown: it goes again, and the old one stays.
			await this.ask('RemoveInput', { inputName: name });
			return false;
		}
		aimed.input = name;
		// The old one stays under it until the new one has a picture, and then goes.
		// A recording that ended meanwhile has taken both away itself.
		await waitOn(this.deps.timers, SWAP_SETTLE_MS);
		if (live()) await this.ask('RemoveInput', { inputName: old });
		return true;
	}

	/**
	 * What the source is set to for one of Obsidian's windows. A Mac names
	 * the window by its number. Elsewhere the value is one OBS itself lists,
	 * found by the window's title. Null where the window cannot be named.
	 */
	private async windowSettings(
		aimed: { input: string; plan: Extract<ObsCapturePlan, { kind: 'ready' }> },
		window: DesktopWindow,
	): Promise<Record<string, unknown> | null> {
		const pick = aimed.plan.pick;
		if (pick === null) return window.id === null ? null : obsMacWindowSettings(window.id);
		if (pick.rule === 'display') return null;
		const listed = await this.ask('GetInputPropertiesListPropertyItems', {
			inputName: aimed.input,
			propertyName: pick.property,
		});
		if (!listed.ok || !Array.isArray(listed.data.propertyItems)) return null;
		const value = pickObsWindow(listed.data.propertyItems as unknown[], pick.rule, window.title);
		return value === null ? null : { [pick.property]: value };
	}

	private beat(): void {
		this.deps.timers.clear(this.heartbeat);
		this.heartbeat = this.deps.timers.set(() => {
			void this.pulse();
		}, HEARTBEAT_MS);
	}

	private async pulse(): Promise<void> {
		if (!this.recording || this.stopping) return;
		const status = await this.ask('GetRecordStatus');
		if (!this.recording || this.stopping) return;
		if (status.ok) {
			if (status.data.outputActive !== true) {
				await this.endedElsewhere();
				return;
			}
			const bytes = figure(status.data.outputBytes);
			if (bytes !== null) this.hooks?.bytes(bytes);
		}
		this.beat();
	}

	private hear(event: ObsEvent): void {
		if (event.type === 'RecordStateChanged') {
			const state = text(event.data.outputState);
			const path = text(event.data.outputPath);
			if (path !== null) this.path = path;
			if (state === 'OBS_WEBSOCKET_OUTPUT_STARTED') this.sawStarted = true;
			if (state === 'OBS_WEBSOCKET_OUTPUT_STOPPED') {
				this.sawStopped = true;
				if (this.recording && !this.stopping) void this.endedElsewhere();
			}
			return;
		}
		if (event.type === 'ExitStarted' && this.recording && !this.stopping) {
			// OBS is quitting and takes the recording with it. It will not
			// take anything back now: the ledger waits for it to return.
			const hooks = this.hooks;
			const path = this.path;
			this.finish();
			if (this.loans.length > 0) hooks?.notice('return-pending');
			hooks?.ended({ reason: 'external', path, error: null });
		}
	}

	/** The recording was stopped in OBS itself: what was borrowed goes back, and the service is told. */
	private async endedElsewhere(): Promise<void> {
		if (!this.recording || this.stopping) return;
		this.stopping = true;
		const hooks = this.hooks;
		await this.giveBack();
		await this.tidy();
		const path = this.path;
		this.finish();
		if (this.loans.length > 0) hooks?.notice('return-pending');
		hooks?.ended({ reason: 'external', path, error: null });
	}

	/** The conversation ended under a recording: OBS is asked again a few times before the recording is given up. */
	private async lost(): Promise<void> {
		if (!this.recording || this.stopping) return;
		const run = this.run;
		this.deps.timers.clear(this.heartbeat);
		for (let attempt = 0; attempt < RECONNECTS; attempt += 1) {
			await waitOn(this.deps.timers, RECONNECT_MS);
			if (run !== this.run || !this.recording || this.stopping) return;
			const link = await this.converse(this.port, this.password);
			if (run !== this.run || !this.recording || this.stopping) return;
			if (!link.ok) continue;
			const status = await this.ask('GetRecordStatus');
			if (status.ok && status.data.outputActive === true) {
				this.beat();
				return;
			}
			if (status.ok) {
				await this.endedElsewhere();
				return;
			}
		}
		const hooks = this.hooks;
		this.finish();
		hooks?.ended({ reason: 'lost', path: null, error: 'obs-lost' });
	}

	// ---- A stop ----

	private async end(seconds: number): Promise<RecorderStop> {
		if (!this.recording || this.stopping) return { path: null, error: null };
		this.stopping = true;
		this.deps.timers.clear(this.heartbeat);
		const hooks = this.hooks;
		if (this.socket === null || !this.socket.open) {
			// The conversation is down: one more try, since OBS may be there still.
			await this.converse(this.port, this.password);
		}
		const asked = await this.ask('StopRecord');
		let path = asked.ok ? text(asked.data.outputPath) : null;
		// OBS answers before the file is closed, and takes no size back
		// while it writes: nothing is given back until it has stopped.
		const stopped = await this.confirmStopped(seconds);
		path = this.path ?? path;
		if (stopped) await this.giveBack();
		// The recording was asked to end either way: its picture is of no use to anything now.
		await this.tidy();
		this.finish();
		if (this.loans.length > 0) hooks?.notice('return-pending');
		return { path, error: null };
	}

	private async confirmStopped(seconds: number): Promise<boolean> {
		for (let second = 0; second < seconds; second += 1) {
			if (this.sawStopped) return true;
			const status = await this.ask('GetRecordStatus');
			if (status.ok && status.data.outputActive !== true) return true;
			if (unanswered(status) && (this.socket === null || !this.socket.open)) return false;
			await waitOn(this.deps.timers, READY_WAIT_MS);
		}
		return this.sawStopped;
	}

	// ---- The conversation ----

	private ask(type: string, data?: Record<string, unknown>): Promise<ObsAnswer> {
		return this.socket === null
			? Promise.resolve({ ok: false, code: OBS_ANSWER_ENDED, comment: null })
			: this.socket.call(type, data);
	}

	private async converse(port: number, password: string | null): Promise<ObsConnection> {
		this.hangUp();
		const socket = this.deps.socket();
		const outcome = await socket.connect(port, password);
		if (!outcome.ok) return outcome;
		this.socket = socket;
		this.releases = [
			socket.listen((event) => {
				this.hear(event);
			}),
			socket.onEnded(() => {
				if (this.socket === socket) this.socket = null;
				void this.lost();
			}),
		];
		return outcome;
	}

	private hangUp(): void {
		for (const release of this.releases) release();
		this.releases = [];
		this.socket?.close();
		this.socket = null;
	}

	/** The run is over, however it ended: the clock stops and the conversation ends. */
	private finish(): void {
		this.run += 1;
		this.recording = false;
		this.stopping = false;
		this.staged = false;
		this.aimed = null;
		this.shown = null;
		this.wanted = null;
		this.deps.timers.clear(this.followTimer);
		this.followTimer = null;
		this.deps.timers.clear(this.heartbeat);
		this.heartbeat = null;
		this.hooks = null;
		this.hangUp();
	}
}
