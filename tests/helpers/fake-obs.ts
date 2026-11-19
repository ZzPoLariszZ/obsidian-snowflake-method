import type { SocketLike } from '../../src/services/obs-socket';

/**
 * An OBS that lives in memory and answers the plugin as the real one does,
 * as far as the plugin asks: profile settings, the size it writes at, its
 * scenes and their sources, the sound it hears, and one recording. Every
 * request is kept in order, and a test can make the next one of a kind
 * fail, drop the conversation, or have OBS say something unasked.
 */

/** The password a scripted OBS asks, and the proof of it for the salt and challenge below. */
export const FAKE_OBS_PASSWORD = 'supersecretpassword';
const SALT = 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=';
const CHALLENGE = '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=';
const PROOF = '1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=';

interface FakeScene {
	name: string;
	/**
	 * A source in the scene, the last made on top. One put there by hand is
	 * shown and in its place. `place` is the part of the canvas it was last
	 * fitted to.
	 */
	items: {
		id: number;
		source: string;
		enabled?: boolean;
		fitted?: boolean;
		place?: { x: number; y: number; width: number; height: number };
	}[];
}

/** The most pixels a side the real OBS takes for its canvas or its picture when asked from outside, and the fewest. */
const SIDE_LIMIT = 4096;
const SIDE_FLOOR = 8;

export interface FakeObsCall {
	type: string;
	data: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** A small bitmap as OBS returns one, flat or with one bright corner. */
function bitmapUrl(blank: boolean): string {
	const width = 32;
	const height = 18;
	const row = width * 3;
	const bytes = new Uint8Array(54 + row * height);
	const view = new DataView(bytes.buffer);
	bytes[0] = 0x42;
	bytes[1] = 0x4d;
	view.setUint32(10, 54, true);
	view.setInt32(18, width, true);
	view.setInt32(22, height, true);
	view.setUint16(28, 24, true);
	if (!blank) bytes[54] = 200;
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `data:image/bmp;base64,${btoa(binary)}`;
}

class FakeSocket implements SocketLike {
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: ((event: { code: number }) => void) | null = null;
	onerror: (() => void) | null = null;
	alive = true;
	identified = false;

	constructor(private readonly obs: FakeObs) {}

	send(text: string): void {
		if (!this.alive) throw new Error('The socket is closed.');
		this.obs.sent.push(text);
		this.obs.receive(this, text);
	}

	close(): void {
		this.alive = false;
	}

	/** What OBS says to this conversation, a turn later as a real socket would deliver it. */
	deliver(message: unknown): void {
		void Promise.resolve().then(() => {
			if (this.alive) this.onmessage?.({ data: JSON.stringify(message) });
		});
	}

	end(code: number): void {
		if (!this.alive) return;
		this.alive = false;
		void Promise.resolve().then(() => {
			this.onclose?.({ code });
		});
	}
}

export class FakeObs {
	/** The password OBS asks for, or null where it asks none. */
	password: string | null = null;
	/** Nothing listens on the port: every conversation is refused. */
	closed = false;
	/** How many more times OBS says it is not ready yet. */
	notReady = 0;
	version = '33.0.1';
	kinds = ['scene', 'screen_capture', 'coreaudio_input_capture'];
	formats = ['bmp', 'jpg', 'png'];
	/** The picture OBS takes of a scene is one flat color. */
	blank = false;
	/** OBS says yes to a start and records nothing, as it does into a folder that is not there. */
	startsNothing = false;
	/** How many more looks at the recording find it still running after a stop was asked. */
	stopsLate = 0;
	/** Another output of OBS runs, so it will not change the size it writes at. */
	outputBusy = false;
	recordPath = '/Users/ada/Proof/2026-11-19 14.30.05.mov';
	bytes = 0;
	duration = 0;
	lists: Record<string, unknown[]> = {};
	/**
	 * How OBS compressed when it started. It builds its recorder around
	 * this, so a start after the setting was changed through the profile is
	 * answered and records nothing, as the real one's is.
	 */
	readonly builtQuality = 'Stream';
	/**
	 * OBS has fallen over. The real one does when its macOS capture source is
	 * asked for its list of screens: the list's values are empty on the newer
	 * systems, and its WebSocket server reads them as text all the same.
	 */
	crashed = false;

	profile = 'Untitled';
	parameters: Record<string, string | null> = {
		'Output/Mode': 'Simple',
		'Output/FilenameFormatting': '%CCYY-%MM-%DD %hh-%mm-%ss',
		'SimpleOutput/FilePath': '/Users/ada/Movies',
		'SimpleOutput/RecQuality': 'Stream',
		'AdvOut/RecFilePath': '/Users/ada/Movies',
		'AdvOut/RecType': 'Standard',
	};
	video = { baseWidth: 1920, baseHeight: 1080, outputWidth: 1280, outputHeight: 720 };
	/**
	 * How large OBS says a source is, by what the source shows: a screen by
	 * the system's identifier for it, a window by its number. Anything else
	 * is as large as `sourceSize`.
	 */
	sourceSizes: Record<string, { width: number; height: number }> = {};
	sourceSize = { width: 2560, height: 1440 };
	/** How many more times a source is asked its size before it has one: the real one has none until its first picture. */
	sizesLate = 0;
	scenes: FakeScene[] = [{ name: 'Scene', items: [] }];
	program = 'Scene';
	/**
	 * A source made in a scene. `muted` is there only for a kind that
	 * carries sound. `knows` is there for a Mac's window source: the windows
	 * that stood on the desk when it was made, which are all it can ever show.
	 */
	inputs: Record<string, { kind: string; settings: Record<string, unknown>; muted?: boolean; knows?: unknown[] }> = {};
	/**
	 * The windows on the Mac's desk now, by their numbers. The real OBS's
	 * source for a window reads them once, when it is made: set afterwards to
	 * the number of a window opened since, it shows nothing, for good.
	 */
	desk: unknown[] = [4321, 4399];
	/**
	 * How many times OBS refuses a source's name after the source by that
	 * name was removed. The real one keeps the name a moment longer than the
	 * source.
	 */
	lingers = 0;
	/** The sources whose sound got into a recording: shown while a recording ran, and not muted. */
	readonly heard: string[] = [];
	/** The sources shown in a recording before they were put in their place on the canvas. */
	readonly misplaced: string[] = [];
	/** The kinds of source that bring sound with their picture, as macOS's screen capture does. */
	loudKinds: string[] = ['screen_capture'];
	mutes: Record<string, boolean> = { 'Mic/Aux': false, 'Desktop Audio': true };
	special: Record<string, string | null> = {
		desktop1: 'Desktop Audio',
		desktop2: null,
		mic1: 'Mic/Aux',
		mic2: null,
		mic3: null,
		mic4: null,
	};
	recording = false;

	/** Every request, in the order OBS got them. */
	readonly calls: FakeObsCall[] = [];
	/** Every frame the plugin sent, as written. */
	readonly sent: string[] = [];
	private readonly failures = new Map<string, number[]>();
	private readonly lingering = new Map<string, number>();
	private readonly sockets: FakeSocket[] = [];
	private nextItem = 1;
	private stopAsked = false;

	/** The socket factory to hand the plugin. */
	readonly open = (_url: string): SocketLike => {
		const socket = new FakeSocket(this);
		this.sockets.push(socket);
		if (this.closed) {
			socket.end(1006);
			return socket;
		}
		void Promise.resolve().then(() => {
			socket.onopen?.();
		});
		socket.deliver({
			op: 0,
			d: {
				obsWebSocketVersion: '5.6.3',
				rpcVersion: 1,
				...(this.password === null ? {} : { authentication: { challenge: CHALLENGE, salt: SALT } }),
			},
		});
		return socket;
	};

	/** How many conversations were opened in all. */
	get conversations(): number {
		return this.sockets.length;
	}

	/** The kinds of request OBS got, in order. */
	types(): string[] {
		return this.calls.map((call) => call.type);
	}

	/** The requests that change something in OBS, in order. */
	writes(): string[] {
		return this.types().filter(
			(type) =>
				type.startsWith('Set') ||
				type.startsWith('Create') ||
				type.startsWith('Remove') ||
				type === 'StartRecord' ||
				type === 'StopRecord',
		);
	}

	/** The capture sources that are in OBS now. Each one captures for as long as it is there, on air or not. */
	capturing(): string[] {
		return Object.entries(this.inputs)
			.filter(([, input]) => this.loudKinds.includes(input.kind) || /capture|input/u.test(input.kind))
			.map(([name]) => name);
	}

	/**
	 * What the scene on air shows, the top first: each source that is shown
	 * and has a picture, with the window it shows where it shows one. A Mac's
	 * window source set to a window it does not know, or to one that has
	 * closed, has no picture and is not among them.
	 */
	onAir(): { source: string; window?: unknown }[] {
		const scene = this.scenes.find((entry) => entry.name === this.program);
		return [...(scene?.items ?? [])].reverse().flatMap((item) => {
			const input = this.inputs[item.source];
			if (item.enabled === false || input === undefined) return [];
			if (input.knows === undefined) {
				return [{ source: item.source, ...('window' in input.settings ? { window: input.settings.window } : {}) }];
			}
			const shown = input.settings.window;
			return input.knows.includes(shown) && this.desk.includes(shown) ? [{ source: item.source, window: shown }] : [];
		});
	}

	/** Notes a source that a recording now takes in: its sound where it is not muted, its picture where it is not in place. */
	private watchOnAir(scene: FakeScene, item: FakeScene['items'][number]): void {
		if (!this.recording || scene.name !== this.program || item.enabled === false) return;
		if (this.inputs[item.source]?.muted === false) this.heard.push(item.source);
		if (item.fitted === false) this.misplaced.push(item.source);
	}

	/** Makes the next request of a kind fail with a code. Several calls queue up. */
	failNext(type: string, code = 500): void {
		this.failures.set(type, [...(this.failures.get(type) ?? []), code]);
	}

	/** OBS says something to every open conversation. */
	emit(type: string, data: Record<string, unknown> = {}): void {
		for (const socket of this.sockets) {
			if (socket.alive && socket.identified) socket.deliver({ op: 5, d: { eventType: type, eventData: data } });
		}
	}

	/** OBS drops every conversation, as when it crashes or quits. */
	drop(code = 1006): void {
		for (const socket of this.sockets) socket.end(code);
	}

	/** What the plugin may change and must put back, as one value to compare. */
	borrowable(): unknown {
		return JSON.parse(
			JSON.stringify({
				parameters: this.parameters,
				video: this.video,
				program: this.program,
				mutes: this.mutes,
			}),
		);
	}

	/** The recording was stopped in OBS itself. */
	stopFromInside(): void {
		this.recording = false;
		this.emit('RecordStateChanged', {
			outputActive: false,
			outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED',
			outputPath: this.recordPath,
		});
	}

	receive(socket: FakeSocket, textFrame: string): void {
		const message: unknown = JSON.parse(textFrame);
		if (!isRecord(message) || !isRecord(message.d)) return;
		if (message.op === 1) {
			if (this.password !== null && message.d.authentication !== (this.password === FAKE_OBS_PASSWORD ? PROOF : null)) {
				socket.end(4009);
				return;
			}
			socket.identified = true;
			socket.deliver({ op: 2, d: { negotiatedRpcVersion: 1 } });
			return;
		}
		if (message.op !== 6 || !socket.identified) return;
		const type = String(message.d.requestType);
		const id = String(message.d.requestId);
		const data = isRecord(message.d.requestData) ? message.d.requestData : {};
		this.calls.push({ type, data });
		if (
			type === 'GetInputPropertiesListPropertyItems' &&
			this.inputs[String(data.inputName)]?.kind.startsWith('screen_capture') === true &&
			['display_uuid', 'application'].includes(String(data.propertyName))
		) {
			this.crashed = true;
			this.closed = true;
			this.recording = false;
			this.drop();
			return;
		}
		const queued = this.failures.get(type) ?? [];
		const forced = queued.shift();
		const outcome = forced === undefined ? this.answer(type, data) : { code: forced };
		socket.deliver({
			op: 7,
			d: {
				requestType: type,
				requestId: id,
				requestStatus: 'code' in outcome ? { result: false, code: outcome.code } : { result: true, code: 100 },
				...('code' in outcome ? {} : { responseData: outcome.data }),
			},
		});
	}

	private scene(name: unknown): FakeScene | undefined {
		return this.scenes.find((scene) => scene.name === name);
	}

	private answer(type: string, data: Record<string, unknown>): { data: Record<string, unknown> } | { code: number } {
		const ok = (answered: Record<string, unknown> = {}): { data: Record<string, unknown> } => ({ data: answered });
		switch (type) {
			case 'GetVersion':
				if (this.notReady > 0) {
					this.notReady -= 1;
					return { code: 207 };
				}
				return ok({ obsVersion: this.version, supportedImageFormats: this.formats, platform: 'macos' });
			case 'GetRecordStatus': {
				let active = this.recording;
				if (this.stopAsked && this.stopsLate > 0) {
					this.stopsLate -= 1;
					active = true;
				}
				return ok({ outputActive: active, outputDuration: this.duration, outputBytes: this.bytes });
			}
			case 'GetProfileList':
				return ok({ currentProfileName: this.profile, profiles: [this.profile] });
			case 'GetProfileParameter':
				return ok({
					parameterValue:
						this.parameters[`${String(data.parameterCategory)}/${String(data.parameterName)}`] ?? null,
				});
			case 'SetProfileParameter': {
				const value = data.parameterValue;
				this.parameters[`${String(data.parameterCategory)}/${String(data.parameterName)}`] =
					typeof value === 'string' ? value : null;
				return ok();
			}
			case 'GetRecordDirectory':
				return ok({
					recordDirectory:
						this.parameters['Output/Mode'] === 'Advanced'
							? this.parameters['AdvOut/RecFilePath']
							: this.parameters['SimpleOutput/FilePath'],
				});
			case 'GetVideoSettings':
				return ok({ ...this.video, fpsNumerator: 30, fpsDenominator: 1 });
			case 'SetVideoSettings': {
				if (this.recording || this.outputBusy) return { code: 500 };
				const sides = [data.baseWidth, data.baseHeight, data.outputWidth, data.outputHeight].filter(
					(side): side is number => typeof side === 'number',
				);
				// A side out of range is refused, and nothing of the request is taken.
				if (sides.some((side) => side > SIDE_LIMIT || side < SIDE_FLOOR)) return { code: 402 };
				if (typeof data.baseWidth === 'number' && typeof data.baseHeight === 'number') {
					this.video = { ...this.video, baseWidth: data.baseWidth, baseHeight: data.baseHeight };
				}
				if (typeof data.outputWidth === 'number' && typeof data.outputHeight === 'number') {
					// OBS writes a width in fours and a height in twos, and keeps the size so cut.
					this.video = {
						...this.video,
						outputWidth: Math.floor(data.outputWidth / 4) * 4,
						outputHeight: Math.floor(data.outputHeight / 2) * 2,
					};
				}
				return ok();
			}
			case 'GetSceneItemTransform': {
				const item = this.scene(data.sceneName)?.items.find((entry) => entry.id === data.sceneItemId);
				const input = item === undefined ? undefined : this.inputs[item.source];
				if (item === undefined || input === undefined) return { code: 600 };
				let size = { width: 0, height: 0 };
				if (this.sizesLate > 0) this.sizesLate -= 1;
				else {
					const shows = input.settings.display_uuid ?? input.settings.window ?? input.settings.monitor_id;
					size = this.sourceSizes[String(shows)] ?? this.sourceSize;
				}
				return ok({
					sceneItemTransform: {
						sourceWidth: size.width,
						sourceHeight: size.height,
						positionX: item.place?.x ?? 0,
						positionY: item.place?.y ?? 0,
						boundsWidth: item.place?.width ?? 0,
						boundsHeight: item.place?.height ?? 0,
					},
				});
			}
			case 'GetSceneList':
				return ok({
					currentProgramSceneName: this.program,
					scenes: this.scenes.map((scene) => ({ sceneName: scene.name })),
				});
			case 'CreateScene':
				if (this.scene(data.sceneName) !== undefined) return { code: 601 };
				this.scenes.push({ name: String(data.sceneName), items: [] });
				return ok();
			case 'SetCurrentProgramScene':
				if (this.scene(data.sceneName) === undefined) return { code: 600 };
				this.program = String(data.sceneName);
				return ok();
			case 'GetSceneItemList': {
				const scene = this.scene(data.sceneName);
				if (scene === undefined) return { code: 600 };
				return ok({ sceneItems: scene.items.map((item) => ({ sceneItemId: item.id, sourceName: item.source })) });
			}
			case 'GetSceneItemId': {
				const item = this.scene(data.sceneName)?.items.find((entry) => entry.source === data.sourceName);
				return item === undefined ? { code: 600 } : ok({ sceneItemId: item.id });
			}
			case 'GetInputKindList':
				return ok({ inputKinds: this.kinds });
			case 'CreateInput': {
				const scene = this.scene(data.sceneName);
				const name = String(data.inputName);
				if (scene === undefined) return { code: 600 };
				if (!this.kinds.includes(String(data.inputKind))) return { code: 400 };
				if (this.inputs[name] !== undefined) return { code: 601 };
				const lingering = this.lingering.get(name) ?? 0;
				if (lingering > 0) {
					this.lingering.set(name, lingering - 1);
					return { code: 601 };
				}
				const settings = isRecord(data.inputSettings) ? { ...data.inputSettings } : {};
				this.inputs[name] = {
					kind: String(data.inputKind),
					settings,
					...(this.loudKinds.includes(String(data.inputKind)) ? { muted: false } : {}),
					...(String(data.inputKind).startsWith('screen_capture') && settings.type === 1 ? { knows: [...this.desk] } : {}),
				};
				const id = this.nextItem;
				this.nextItem += 1;
				const item = { id, source: name, enabled: data.sceneItemEnabled !== false, fitted: false };
				scene.items.push(item);
				this.watchOnAir(scene, item);
				return ok({ sceneItemId: id });
			}
			case 'SetSceneItemEnabled': {
				const scene = this.scene(data.sceneName);
				const item = scene?.items.find((entry) => entry.id === data.sceneItemId);
				if (scene === undefined || item === undefined) return { code: 600 };
				item.enabled = data.sceneItemEnabled === true;
				this.watchOnAir(scene, item);
				return ok();
			}
			case 'CreateSceneItem': {
				const scene = this.scene(data.sceneName);
				if (scene === undefined || this.inputs[String(data.sourceName)] === undefined) return { code: 600 };
				const id = this.nextItem;
				this.nextItem += 1;
				scene.items.push({ id, source: String(data.sourceName) });
				return ok({ sceneItemId: id });
			}
			case 'GetInputPropertiesListPropertyItems':
				return ok({ propertyItems: this.lists[String(data.propertyName)] ?? [] });
			case 'RemoveInput': {
				const name = String(data.inputName);
				if (this.inputs[name] === undefined) return { code: 600 };
				this.inputs = Object.fromEntries(Object.entries(this.inputs).filter(([key]) => key !== name));
				for (const scene of this.scenes) scene.items = scene.items.filter((item) => item.source !== name);
				if (this.lingers > 0) this.lingering.set(name, this.lingers);
				return ok();
			}
			case 'RemoveScene': {
				const gone = this.scene(data.sceneName);
				if (gone === undefined) return { code: 600 };
				// OBS never parts with its last scene.
				if (this.scenes.length < 2) return { code: 703 };
				this.scenes = this.scenes.filter((scene) => scene !== gone);
				// A source no scene holds any more goes with the scene.
				const held = new Set(this.scenes.flatMap((scene) => scene.items.map((item) => item.source)));
				this.inputs = Object.fromEntries(
					Object.entries(this.inputs).filter(([name]) => held.has(name) || !gone.items.some((item) => item.source === name)),
				);
				if (this.program === gone.name) this.program = this.scenes[0]?.name ?? '';
				return ok();
			}
			case 'SetInputSettings': {
				const input = this.inputs[String(data.inputName)];
				if (input === undefined) return { code: 600 };
				input.settings = { ...input.settings, ...(isRecord(data.inputSettings) ? data.inputSettings : {}) };
				return ok();
			}
			case 'SetSceneItemTransform': {
				const item = this.scene(data.sceneName)?.items.find((entry) => entry.id === data.sceneItemId);
				const asked = isRecord(data.sceneItemTransform) ? data.sceneItemTransform : {};
				if (item !== undefined) {
					item.fitted = true;
					item.place = {
						x: Number(asked.positionX ?? 0),
						y: Number(asked.positionY ?? 0),
						width: Number(asked.boundsWidth ?? 0),
						height: Number(asked.boundsHeight ?? 0),
					};
				}
				return ok();
			}
			case 'GetSpecialInputs':
				return ok({ ...this.special });
			case 'GetInputMute': {
				const name = String(data.inputName);
				const made = this.inputs[name];
				// A source with no sound says so, as OBS does.
				if (made !== undefined) return made.muted === undefined ? { code: 604 } : ok({ inputMuted: made.muted });
				const muted = this.mutes[name];
				return muted === undefined ? { code: 600 } : ok({ inputMuted: muted });
			}
			case 'SetInputMute': {
				const name = String(data.inputName);
				const made = this.inputs[name];
				if (made !== undefined) {
					if (made.muted === undefined) return { code: 604 };
					made.muted = data.inputMuted === true;
					return ok();
				}
				if (this.mutes[name] === undefined) return { code: 600 };
				this.mutes[name] = data.inputMuted === true;
				return ok();
			}
			case 'GetSourceScreenshot':
				return ok({
					imageData:
						data.imageFormat === 'bmp'
							? bitmapUrl(this.blank || (this.scene(data.sourceName)?.items.length ?? 0) === 0)
							: `data:image/${String(data.imageFormat)};base64,AAAA`,
				});
			case 'StartRecord':
				if (this.recording) return { code: 500 };
				if (this.startsNothing) return ok();
				// Its recorder was built for another compression: it says yes and records nothing.
				if (this.parameters['SimpleOutput/RecQuality'] !== this.builtQuality) return ok();
				this.recording = true;
				this.stopAsked = false;
				this.emit('RecordStateChanged', {
					outputActive: true,
					outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED',
					outputPath: this.recordPath,
				});
				return ok();
			case 'StopRecord':
				if (!this.recording) return { code: 501 };
				this.recording = false;
				this.stopAsked = true;
				if (this.stopsLate === 0) {
					this.emit('RecordStateChanged', {
						outputActive: false,
						outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED',
						outputPath: this.recordPath,
					});
				}
				return ok({ outputPath: this.recordPath });
			default:
				return { code: 204 };
		}
	}
}
