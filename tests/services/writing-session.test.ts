import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	SCHEMA_VERSION,
	type WritingSessionRecord,
	type WritingSessionScope,
	type WritingSessionSnapshot,
} from "../../src/domain";
import {
	SnowflakeProjectService,
	WritingSessionService,
	type NoteCountOptions,
	type ProjectSnapshot,
	type StartWritingSessionOptions,
	type WritingSessionEvent,
} from "../../src/services";
import { isPathAtOrBelow } from "../../src/project-root";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const T0 = Date.parse("2026-08-17T10:00:00.000Z");
const DRAFT = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
/** A note of the project that is not the manuscript's: in one scope, not both. */
const NOTES = "Snowflake Projects/Novel/80_Material/Notes.md";
/** A note nobody's project made, which is therefore nobody's word count. */
const LOOSE = "Snowflake Projects/Novel/Loose note.md";
const MONTH_FILE =
	"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/711_Writing_Session/2026/2026_08_device-a_writing_session.json";
const UNTIMED_FILE =
	"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/711_Writing_Session/2026/2026_08_device-a_untimed_writing.json";

const countOptions = { mode: "ms-word", headings: "count" } as const;

const options = (
	overrides: Partial<StartWritingSessionOptions> = {},
): StartWritingSessionOptions => ({
	type: "stopwatch",
	writingMode: "draft",
	startMode: "manual",
	timing: { idleThresholdSeconds: 60 },
	countOptions,
	...overrides,
});

/** A finished session another device might have written, started at `at`. */
const foreignRecord = (
	at: number,
	net: number,
	manuscriptNet = net,
): WritingSessionRecord => ({
	id: `session-foreign-${String(at)}`,
	schemaVersion: 1,
	startedAt: new Date(at).toISOString(),
	endedAt: new Date(at + 60_000).toISOString(),
	timezone: "UTC",
	sessionType: "stopwatch",
	startMode: "manual",
	writingMode: "draft",
	stopReason: "manual",
	activeIntervals: [
		{
			startedAt: new Date(at).toISOString(),
			endedAt: new Date(at + 60_000).toISOString(),
		},
	],
	idleIntervals: [],
	pausedIntervals: [],
	words: {
		project: { start: 0, end: net, added: net, deleted: 0, net },
		manuscript: {
			start: 0,
			end: manuscriptNet,
			added: manuscriptNet,
			deleted: 0,
			net: manuscriptNet,
		},
	},
	files: [],
	timing: { idleThresholdSeconds: 60 },
});

describe("WritingSessionService", () => {
	let fakeVault: FakeVault;
	let projects: SnowflakeProjectService;
	let project: ProjectSnapshot;
	let sessions: WritingSessionService;
	let clock: number;
	let lens: WritingSessionScope;
	let goalScope: WritingSessionScope;
	let events: WritingSessionEvent[];
	let store: { value: unknown };
	let untimedStore: { value: unknown };
	/** Paths "open in an editor", whose save echoes must not re-baseline. */
	let openNotes: Set<string>;
	/** Whether untimed tracking is on, the way the setting would say it. */
	let untimedOn: boolean;
	/** What projectAtPath resolves against, the way main's scan map would. */
	let projectRefs: ProjectSnapshot[];
	/** The convention in force, mutable the way the settings would be. */
	let activeCountOptions: NoteCountOptions;
	let timers: {
		handlers: Map<number, () => void>;
		/** Every delay a timer was asked for, in the order they were set. */
		delays: number[];
		flush: () => Promise<void>;
	};

	const settle = async (): Promise<void> => {
		for (let i = 0; i < 6; i += 1) {
			await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
		}
	};

	const buildService = (): WritingSessionService => {
		const service = new WritingSessionService({
			repository: projects.repository,
			writingCount: projects.writingCount,
			recovery: {
				load: () => store.value,
				save: (snapshot) => {
					store.value = snapshot;
				},
			},
			deviceId: () => "device-a",
			scope: () => lens,
			goalScope: () => goalScope,
			isNoteOpen: (path) => openNotes.has(path),
			trackUntimed: () => untimedOn,
			projectAtPath: (path) =>
				projectRefs.find((ref) => isPathAtOrBelow(path, ref.rootPath)) ??
				null,
			countOptions: () => activeCountOptions,
			untimedRecovery: {
				load: () => untimedStore.value,
				save: (snapshot) => {
					untimedStore.value = snapshot;
				},
			},
			now: () => clock,
			timezone: () => "UTC",
			uuid: () => `session-${String(clock)}`,
			timers: {
				set: (handler, ms) => {
					timers.delays.push(ms);
					// A zero-delay timer is the service asking for air mid-seed;
					// held timers would deadlock the start that awaits it.
					if (ms === 0) {
						handler();
						return 0;
					}
					const id = timers.handlers.size + 1;
					timers.handlers.set(id, handler);
					return id;
				},
				clear: (handle) => {
					timers.handlers.delete(handle as number);
				},
			},
		});
		service.subscribe((event) => events.push(event));
		// Wired the way main.ts wires it: the repository reports its own body
		// writes, which is how the plugin's saves are credited.
		projects.repository.onBodyWrite = (path, before, after, userInput) => {
			service.notePersistedByPlugin(path, before, after, userInput);
		};
		return service;
	};

	beforeEach(async () => {
		const environment = createFakeEnvironment();
		fakeVault = environment.fakeVault;
		projects = new SnowflakeProjectService(
			environment.vault,
			environment.fileManager,
			environment.metadataCache,
		);
		project = await projects.createProject({ title: "Novel", locale: "en" });
		clock = T0;
		lens = "project";
		goalScope = "project";
		events = [];
		store = { value: null };
		untimedStore = { value: null };
		openNotes = new Set();
		untimedOn = true;
		projectRefs = [project];
		activeCountOptions = countOptions;
		const handlers = new Map<number, () => void>();
		timers = {
			handlers,
			delays: [],
			flush: async () => {
				const pending = [...handlers.values()];
				handlers.clear();
				for (const handler of pending) handler();
				await settle();
			},
		};
		sessions = buildService();
		await seedNote(NOTES, "one two three");
		await fakeVault.seedFile(LOOSE, "loose words nobody claimed\n");
	});

	/**
	 * A note of the project, which is what a project's writing is counted
	 * from: a file under the folder proves nothing, and only what the note
	 * declares says whose writing it holds.
	 */
	const seedNote = async (
		path: string,
		body: string,
		documentType = "material",
	): Promise<void> => {
		await fakeVault.seedFile(
			path,
			[
				"---",
				`snowflake-schema: ${String(SCHEMA_VERSION)}`,
				`snowflake-document: ${documentType}`,
				`snowflake-project-id: ${project.id}`,
				"---",
				"",
				`${body}\n`,
			].join("\n"),
		);
	};

	/** The same note rewritten, as a text provider the way an editor hands one. */
	const written = (body: string, documentType = "material") =>
		(): string =>
			[
				"---",
				`snowflake-schema: ${String(SCHEMA_VERSION)}`,
				`snowflake-document: ${documentType}`,
				`snowflake-project-id: ${project.id}`,
				"---",
				"",
				`${body}\n`,
			].join("\n");

	const startSession = async (
		overrides: Partial<StartWritingSessionOptions> = {},
	): Promise<void> => {
		await sessions.start(project, options(overrides));
		// Past the discard rule, so a stop always leaves a record behind.
		clock += 20_000;
	};

	const monthFile = (): { sessions: WritingSessionRecord[] } | null => {
		const content = fakeVault.contents.get(MONTH_FILE);
		return content === undefined
			? null
			: (JSON.parse(content) as { sessions: WritingSessionRecord[] });
	};

	it("seeds the baselines to exactly the scope count at start", async () => {
		await startSession();
		const counted = await projects.writingCount.countProject(
			project,
			"project",
			countOptions,
		);
		expect(sessions.live()?.startWordCount).toBe(counted.total);
		expect(sessions.live()?.state).toBe("focus");
	});

	it("credits typing per note, added and deleted apart", async () => {
		await startSession();
		sessions.surfaceActivity(NOTES);
		sessions.noteChanged(NOTES, () => "one two three four five\n");
		await timers.flush();
		expect(sessions.live()?.added).toBe(2);
		sessions.noteChanged(NOTES, () => "one two four five\n");
		await timers.flush();
		expect(sessions.live()?.added).toBe(2);
		expect(sessions.live()?.deleted).toBe(1);
		expect(sessions.live()?.trackedNet).toBe(1);
		await sessions.stop();
		const written = monthFile();
		expect(written?.sessions).toHaveLength(1);
		expect(written?.sessions[0]?.files).toEqual([
			{ path: NOTES, added: 2, deleted: 1, net: 1, manuscript: false },
		]);
	});

	it("leaves a born note's words for its first editor event", async () => {
		await startSession();
		const path = "Snowflake Projects/Novel/80_Material/Fresh.md";
		await seedNote(path, "four new words here");
		// The create alone credits nothing: sync delivers new notes the same
		// way, content and all, and counting them here would credit another
		// device's writing to this one.
		sessions.noteCreated(path);
		await timers.flush();
		expect(sessions.live()?.added).toBe(0);
		// The first editor event reads the note against the empty baseline the
		// create left behind, so everything it was born with is credited then.
		sessions.noteChanged(path, written("four new words here again"));
		await timers.flush();
		expect(sessions.live()?.added).toBe(5);
	});

	it("re-baselines a sync-born note before the editor reaches it", async () => {
		await startSession();
		const path = "Snowflake Projects/Novel/80_Material/Arrived.md";
		await seedNote(path, "four synced words here");
		sessions.noteCreated(path);
		sessions.noteWrittenExternally(path);
		await timers.flush();
		expect(sessions.live()?.added).toBe(0);
		// The rebase measured the note as it arrived, so a later edit credits
		// only its own delta.
		sessions.noteChanged(path, written("four synced words here plus"));
		await timers.flush();
		expect(sessions.live()?.added).toBe(1);
	});

	it("ignores an external write and re-baselines the closed note instead", async () => {
		await startSession();
		fakeVault.write(NOTES, written("one two three four five six")());
		sessions.noteWrittenExternally(NOTES);
		await timers.flush();
		// Three words arrived from outside and none of them were credited.
		expect(sessions.live()?.added).toBe(0);
		// The next editor event is measured against the external state.
		sessions.noteChanged(NOTES, written("one two three four five six seven"));
		await timers.flush();
		expect(sessions.live()?.added).toBe(1);
	});

	it("leaves an open note's save echo to its own editor", async () => {
		await startSession();
		openNotes.add(NOTES);
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		expect(sessions.live()?.added).toBe(2);
		// The autosave's vault event lands while the disk still lags the
		// editor. Re-baselining from that stale disk would credit the lag
		// over again at the next keystroke.
		sessions.noteWrittenExternally(NOTES);
		sessions.noteChanged(NOTES, written("one two three four five six"));
		await timers.flush();
		expect(sessions.live()?.added).toBe(3);
	});

	it("moves a renamed note's tallies without inventing a delta", async () => {
		await startSession();
		sessions.noteChanged(NOTES, written("one two three four"));
		await timers.flush();
		expect(sessions.live()?.added).toBe(1);
		const moved = "Snowflake Projects/Novel/80_Material/Moved note.md";
		fakeVault.rename(NOTES, moved);
		sessions.notePathRenamed(NOTES, moved);
		sessions.noteChanged(moved, written("one two three four"));
		await timers.flush();
		expect(sessions.live()?.added).toBe(1);
		expect(sessions.live()?.deleted).toBe(0);
	});

	/**
	 * The rule the whole reading rests on: a note is read under the membership
	 * it has now, so what it wrote before the move moves with it. Nothing is
	 * typed between the two assertions.
	 */
	it("carries a note's whole tally across the manuscript's edge", async () => {
		await startSession();
		sessions.noteChanged(NOTES, written("one two three four five six"));
		await timers.flush();
		expect(sessions.live()?.added).toBe(3);
		lens = "manuscript";
		expect(sessions.live()?.added).toBe(0);
		// Into the manuscript, as one of its own: everything it wrote arrives
		// with it, and it never left the project's reading.
		const inside = "Snowflake Projects/Novel/50_Manuscript/Moved.md";
		await seedNote(inside, "one two three four five six", "draft");
		fakeVault.delete(NOTES);
		fakeVault.rename(inside, `${inside}.tmp`);
		fakeVault.rename(`${inside}.tmp`, inside);
		sessions.notePathRenamed(NOTES, inside);
		await timers.flush();
		expect(sessions.live()?.added).toBe(3);
		lens = "project";
		expect(sessions.live()?.added).toBe(3);
		// And back out again: the whole of it leaves the manuscript reading.
		const outside = "Snowflake Projects/Novel/80_Material/Moved.md";
		fakeVault.rename(inside, outside);
		sessions.notePathRenamed(inside, outside);
		await timers.flush();
		expect(sessions.live()?.added).toBe(3);
		lens = "manuscript";
		expect(sessions.live()?.added).toBe(0);
	});

	it("reads a rename out of the project as the words going", async () => {
		await projects.manuscript.writeSegment(
			DRAFT,
			"Seven words are in this draft body.",
		);
		await startSession();
		// Out of the project altogether: it really did lose those words, and
		// both readings say so, because the manuscript is inside the project.
		const parked = "Parked.md";
		fakeVault.rename(DRAFT, parked);
		sessions.notePathRenamed(DRAFT, parked);
		await timers.flush();
		expect(sessions.live()?.deleted).toBe(7);
		lens = "manuscript";
		expect(sessions.live()?.deleted).toBe(7);
	});

	it("leaves a rename inside one scope alone", async () => {
		await startSession();
		const elsewhere = "Snowflake Projects/Novel/80_Material/Elsewhere.md";
		fakeVault.rename(NOTES, elsewhere);
		sessions.notePathRenamed(NOTES, elsewhere);
		await timers.flush();
		expect(sessions.live()?.added).toBe(0);
		expect(sessions.live()?.deleted).toBe(0);
	});

	it("credits a deleted note's last count and keeps its tally", async () => {
		await startSession();
		fakeVault.delete(NOTES);
		sessions.noteDeleted(NOTES);
		await timers.flush();
		expect(sessions.live()?.deleted).toBe(3);
		expect(sessions.live()?.trackedNet).toBe(-3);
		await sessions.stop();
		// What happened in the note happened: the record still names it, and
		// says how it ended.
		expect(monthFile()?.sessions[0]?.files).toEqual([
			{ path: NOTES, added: 0, deleted: 3, net: -3, manuscript: false },
		]);
	});

	it("credits every note under a deleted folder", async () => {
		const folder = "Snowflake Projects/Novel/80_Material/Notebook";
		await seedNote(`${folder}/One.md`, "one two");
		await seedNote(`${folder}/Two.md`, "three four five");
		await startSession();
		fakeVault.delete(folder);
		sessions.noteDeleted(folder, { children: true });
		await timers.flush();
		expect(sessions.live()?.deleted).toBe(5);
	});

	it("credits every note a folder carries into the project", async () => {
		// Notes of this project, parked outside its folder: what they declare
		// is only half the answer, and until they are under the root they are
		// not the project's writing.
		const parked = "Parked";
		await seedNote(`${parked}/One.md`, "one two");
		await seedNote(`${parked}/Two.md`, "three four five", "draft");
		await startSession();
		expect(sessions.live()?.added).toBe(0);
		const arrived = "Snowflake Projects/Novel/50_Manuscript/Parked";
		fakeVault.rename(parked, arrived);
		sessions.notePathRenamed(parked, arrived);
		await timers.flush();
		// Nothing was known about either note out there, so both arrive whole
		// -- and only the one that calls itself a draft joins the manuscript.
		expect(sessions.live()?.added).toBe(5);
		expect(sessions.live()?.deleted).toBe(0);
		lens = "manuscript";
		expect(sessions.live()?.added).toBe(3);
	});

	/**
	 * A file under the project folder is not the project's writing. Only what
	 * a note declares says whose words it holds, and a note nobody's project
	 * made is asked once and then left alone -- including on its second save,
	 * which is where a wider gate would have started counting it.
	 */
	it("counts nothing for a note the project never made", async () => {
		await startSession();
		sessions.noteChanged(LOOSE, () => "loose words nobody claimed at all\n");
		await timers.flush();
		expect(sessions.live()?.added).toBe(0);
		sessions.noteChanged(LOOSE, () => "loose words nobody claimed at all again\n");
		await timers.flush();
		expect(sessions.live()?.added).toBe(0);
		expect(sessions.live()?.files).toBe(0);
	});

	it("credits no lifecycle event through a pause", async () => {
		const born = "Snowflake Projects/Novel/80_Material/Born.md";
		await startSession();
		sessions.pause();
		await seedNote(born, "four new words here");
		sessions.noteCreated(born);
		fakeVault.delete(NOTES);
		sessions.noteDeleted(NOTES);
		const parked = "Snowflake Projects/Novel/Parked.md";
		fakeVault.rename(DRAFT, parked);
		sessions.notePathRenamed(DRAFT, parked);
		await timers.flush();
		expect(sessions.live()?.added).toBe(0);
		expect(sessions.live()?.deleted).toBe(0);
		sessions.resume();
		await timers.flush();
		expect(sessions.live()?.added).toBe(0);
		expect(sessions.live()?.deleted).toBe(0);
	});

	it("freezes a pause completely and re-baselines what changed through it", async () => {
		await startSession();
		sessions.pause();
		const frozen = sessions.live()?.durations.totalMs;
		clock += 60_000;
		expect(sessions.live()?.durations.totalMs).toBe(frozen);
		sessions.noteChanged(NOTES, () => "one two three plus pause words\n");
		await timers.flush();
		expect(sessions.live()?.added).toBe(0);
		sessions.resume();
		await settle();
		// The same content again is no delta: the pause absorbed those words.
		sessions.noteChanged(NOTES, () => "one two three plus pause words\n");
		await timers.flush();
		expect(sessions.live()?.added).toBe(0);
		// Writing after the pause counts from the pause-typed text onward.
		sessions.noteChanged(NOTES, () => "one two three plus pause words more\n");
		await timers.flush();
		expect(sessions.live()?.added).toBe(1);
	});

	it("writes this device's monthly file and appends the next session", async () => {
		await startSession();
		await sessions.stop();
		expect(monthFile()?.sessions).toHaveLength(1);
		await startSession();
		await sessions.stop();
		const written = monthFile();
		expect(written?.sessions).toHaveLength(2);
		expect(written?.sessions[0]?.stopReason).toBe("manual");
	});

	it("sets a file that will not parse aside whole and starts fresh", async () => {
		await fakeVault.seedFile(MONTH_FILE, "{ not json");
		await startSession();
		await sessions.stop();
		const aside = [...fakeVault.contents.keys()].find((path) =>
			path.includes(".corrupted-"),
		);
		expect(aside).toBeDefined();
		expect(fakeVault.contents.get(aside as string)).toBe("{ not json");
		expect(monthFile()?.sessions).toHaveLength(1);
		expect(
			events.some((event) => event.kind === "corrupt-file-preserved"),
		).toBe(true);
	});

	it("discards a short empty session without writing anything", async () => {
		await sessions.start(project, options());
		clock += 5_000;
		await sessions.stop();
		expect(monthFile()).toBeNull();
		const stopped = events.find((event) => event.kind === "stopped");
		expect(stopped).toMatchObject({ record: null, reason: "manual" });
	});

	it("replaces a running session only after its record is written", async () => {
		await startSession();
		sessions.noteChanged(NOTES, () => "one two three four five six\n");
		const second = sessions.start(project, options({ writingMode: "revision" }));
		await second;
		const written = monthFile();
		expect(written?.sessions).toHaveLength(1);
		expect(written?.sessions[0]?.stopReason).toBe("replaced-by-new-session");
		// The pending delta belonged to the first session, not the second.
		expect(written?.sessions[0]?.words.project.added).toBe(3);
		expect(sessions.live()?.added).toBe(0);
		expect(sessions.live()?.writingMode).toBe("revision");
	});

	/**
	 * The heart of it: one session, both readings. What was written outside
	 * the manuscript is the project's writing and not the manuscript's, and
	 * neither number is lost by the reader looking at the other.
	 */
	/**
	 * One session runs at a time across the whole vault, so a panel that
	 * belongs to a project has to be able to ask whether the running one is
	 * its own -- or every project's timer shows the same clock over the same
	 * words under a different project's name.
	 */
	it("owns up to one project's sitting and disowns everybody else's", async () => {
		await startSession();
		const mine = project.projectFile;
		expect(sessions.live(mine)?.id).toBe(sessions.live()?.id);
		expect(sessions.live("Somewhere Else/001_Project_Metadata.md")).toBeNull();
		// Asking for nobody in particular still answers, which is what the
		// sidebar does: it belongs to no project and follows the writing.
		expect(sessions.live()).not.toBeNull();
		await sessions.stop();
		expect(sessions.live(mine)).toBeNull();
	});

	it("records the project's words and the manuscript's from one sitting", async () => {
		await projects.manuscript.writeSegment(
			DRAFT,
			"Seven words are in this draft body.",
		);
		await startSession();
		clock += 90_000;
		// Consulting a character is part of writing the chapter, so it holds
		// the clock, and it is the project's writing but not the manuscript's.
		sessions.surfaceActivity(NOTES);
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		expect(sessions.live()?.state).toBe("focus");
		expect(sessions.live()?.added).toBe(2);
		lens = "manuscript";
		expect(sessions.live()?.added).toBe(0);
		// And the draft itself, which is both.
		await projects.manuscript.writeSegment(
			DRAFT,
			"Seven words are in this draft body, plus three.",
		);
		sessions.noteChanged(DRAFT);
		await timers.flush();
		expect(sessions.live()?.added).toBe(2);
		lens = "project";
		expect(sessions.live()?.added).toBe(4);
		await sessions.stop();
		const stored = monthFile()?.sessions[0];
		expect(stored?.words.project.added).toBe(4);
		expect(stored?.words.manuscript.added).toBe(2);
		expect(stored?.files).toEqual([
			{ path: NOTES, added: 2, deleted: 0, net: 2, manuscript: false },
			{ path: DRAFT, added: 2, deleted: 0, net: 2, manuscript: true },
		]);
	});

	/**
	 * The two ends of one reading have to be read by one rule, or the gap
	 * between them is arithmetic rather than writing.
	 */
	it("reads both scopes' start and end totals from the same walk", async () => {
		await projects.manuscript.writeSegment(
			DRAFT,
			"Seven words are in this draft body.",
		);
		await startSession();
		const counted = await projects.writingCount.countScopes(
			project,
			countOptions,
		);
		expect(sessions.live()?.startWordCount).toBe(counted.project.total);
		lens = "manuscript";
		expect(sessions.live()?.startWordCount).toBe(counted.manuscript.total);
		await sessions.stop();
		const stored = monthFile()?.sessions[0];
		expect(stored?.words.project.start).toBe(counted.project.total);
		expect(stored?.words.project.end).toBe(counted.project.total);
		expect(stored?.words.manuscript.start).toBe(counted.manuscript.total);
		expect(stored?.words.manuscript.end).toBe(counted.manuscript.total);
	});

	it("leaves a session in focus wherever the author went, until the silence runs long", async () => {
		await startSession();
		// Nothing at all happens: no blur, no window event, no report.
		clock += 59_000;
		sessions.surfaceActivity(NOTES);
		expect(sessions.live()?.state).toBe("focus");
		clock += 61_000;
		expect(sessions.live()?.state).toBe("idle");
		sessions.surfaceActivity(NOTES);
		expect(sessions.live()?.state).toBe("focus");
	});

	it("holds focus for a form field and credits it no words", async () => {
		await startSession();
		clock += 90_000;
		expect(sessions.live()?.state).toBe("idle");
		// A name, a status, a paragraph of prose: all the same to the clock,
		// and none of them words until a note holds them. A form reports the
		// project it would save into, and reports it again from a dialog.
		for (const pass of [0, 1]) {
			void pass;
			sessions.surfaceActivity(project.projectFile);
			expect(sessions.live()?.state).toBe("focus");
			expect(sessions.live()?.added).toBe(0);
			clock += 90_000;
		}
	});

	it("counts a form's writing only once the save persists it", async () => {
		await startSession();
		sessions.surfaceActivity(project.projectFile);
		// Typed but not saved: the project has not changed, so nor has the count.
		expect(sessions.live()?.state).toBe("focus");
		expect(sessions.live()?.added).toBe(0);
		// The save is what the session hears, and it hears it once.
		sessions.noteChanged(NOTES, () => "one two three four five\n");
		await timers.flush();
		expect(sessions.live()?.added).toBe(2);
		sessions.noteChanged(NOTES, () => "one two three four five\n");
		await timers.flush();
		expect(sessions.live()?.added).toBe(2);
	});

	it("ignores a surface belonging to another project", async () => {
		await startSession();
		clock += 90_000;
		sessions.surfaceActivity("Somewhere Else/Novel/001_Project_Metadata.md");
		expect(sessions.live()?.state).toBe("idle");
		expect(sessions.live()?.added).toBe(0);
	});

	it("recovers a marked shutdown as one, ended at the captured moment", async () => {
		await startSession();
		sessions.noteChanged(NOTES, () => "one two three four five\n");
		await timers.flush();
		clock += 10_000;
		sessions.markShutdown();
		expect(store.value).not.toBeNull();

		const revived = buildService();
		const record = await revived.recoverAtStartup();
		expect(record?.stopReason).toBe("app-shutdown");
		expect(record?.endedAt).toBe(new Date(clock).toISOString());
		expect(record?.words.project.added).toBe(2);
		expect(record?.words.project.end).toBe(
			(record?.words.project.start ?? 0) + 2,
		);
		// Recovery derives both, from the files rather than from a total kept
		// beside them: the note was not the manuscript's, so it moved nothing
		// there and the manuscript's end is its own start.
		expect(record?.words.manuscript.added).toBe(0);
		expect(record?.words.manuscript.end).toBe(
			record?.words.manuscript.start,
		);
		expect(store.value).toBeNull();
		expect(monthFile()?.sessions[0]?.id).toBe(record?.id);
	});

	it("recovers an unmarked snapshot as a crash", async () => {
		await startSession();
		sessions.noteChanged(NOTES, () => "one two three four five\n");
		await timers.flush();
		sessions.markShutdown();
		const marked = store.value as WritingSessionSnapshot;
		const { markedShutdown: dropped, ...rest } = marked;
		void dropped;
		store.value = rest;

		const revived = buildService();
		const record = await revived.recoverAtStartup();
		expect(record?.stopReason).toBe("recovered");
	});

	it("starts an auto session only into silence, and stops only its own", async () => {
		await startSession();
		await sessions.startAuto(project, options({ writingMode: "revision" }));
		expect(sessions.live()?.startMode).toBe("manual");
		await sessions.stopIfAuto("focus-mode-ended");
		expect(sessions.isRunning()).toBe(true);
		await sessions.stop();

		await sessions.startAuto(project, options({ writingMode: "revision" }));
		expect(sessions.live()?.startMode).toBe("auto");
		clock += 20_000;
		await sessions.stopIfAuto("focus-mode-ended");
		const written = monthFile();
		expect(
			written?.sessions[written.sessions.length - 1]?.stopReason,
		).toBe("focus-mode-ended");
	});

	/**
	 * One file on disk, two answers. Nothing is recounted and nothing is
	 * rewritten: the lens only chooses which of the two numbers a record
	 * already holds is the one being read.
	 */
	it("answers a stored day in whichever scope is being read", async () => {
		const foreign =
			"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/711_Writing_Session/2026/2026_08_device-b_writing_session.json";
		await fakeVault.seedFile(
			foreign,
			JSON.stringify({
				schemaVersion: 1,
				sessions: [foreignRecord(T0 - 60 * 60_000, 250, 90)],
			}),
		);
		expect((await sessions.todaySummary(project)).trackedNet).toBe(250);
		lens = "manuscript";
		expect((await sessions.todaySummary(project)).trackedNet).toBe(90);
		// The goal reads its own scope throughout, so switching what the
		// charts show never moves which days met the target.
		expect((await sessions.todaySummary(project)).goalNet).toBe(250);
		goalScope = "manuscript";
		expect((await sessions.todaySummary(project)).goalNet).toBe(90);
		lens = "project";
		expect((await sessions.todaySummary(project)).goalNet).toBe(90);
		expect((await sessions.todaySummary(project)).trackedNet).toBe(250);
	});

	it("sums today across every device's file, the live session included", async () => {
		const foreign =
			"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/711_Writing_Session/2026/2026_08_device-b_writing_session.json";
		await fakeVault.seedFile(
			foreign,
			JSON.stringify({
				schemaVersion: 1,
				sessions: [foreignRecord(T0 - 60 * 60_000, 250)],
			}),
		);
		await startSession();
		sessions.noteChanged(NOTES, () => "one two three four five\n");
		await timers.flush();
		const summary = await sessions.todaySummary(project);
		expect(summary.sessions).toBe(2);
		expect(summary.trackedNet).toBe(252);
		expect(summary.focusMs).toBe(60_000 + 20_000);
		// The other device's file was read, never written.
		expect(fakeVault.processCalls).not.toContain(foreign);
	});

	/**
	 * A stretch of days is what the trend and the heatmap read, and the days
	 * nothing was written on are as much a part of it as the days something
	 * was: a reading that skipped them would draw a month of solid writing out
	 * of four scattered afternoons.
	 */
	it("reads a stretch of days with the empty ones still in it", async () => {
		const folder =
			"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/711_Writing_Session/2026";
		const day = 86_400_000;
		await fakeVault.seedFile(
			`${folder}/2026_08_device-b_writing_session.json`,
			JSON.stringify({
				schemaVersion: 1,
				sessions: [foreignRecord(T0 - 3 * day, 120)],
			}),
		);
		await fakeVault.seedFile(
			`${folder}/2026_07_device-b_writing_session.json`,
			JSON.stringify({
				schemaVersion: 1,
				sessions: [foreignRecord(T0 - 40 * day, 400)],
			}),
		);

		const week = await sessions.dailyTotals(project, 7);
		expect(week).toHaveLength(7);
		expect(week.map((one) => one.day)).toEqual([
			"2026-08-11",
			"2026-08-12",
			"2026-08-13",
			"2026-08-14",
			"2026-08-15",
			"2026-08-16",
			"2026-08-17",
		]);
		expect(week[3]?.trackedNet).toBe(120);
		expect(week[4]).toMatchObject({ sessions: 0, trackedNet: 0, focusMs: 0 });
		// Last month's session is outside the week, and its file is not one the
		// week has any reason to open.
		expect(week.reduce((carried, one) => carried + one.sessions, 0)).toBe(1);

		// A longer stretch reaches into the month before it, and a whole year
		// reaches into a year folder that was never created.
		const longer = await sessions.dailyTotals(project, 60);
		expect(longer).toHaveLength(60);
		expect(longer.reduce((carried, one) => carried + one.trackedNet, 0)).toBe(
			520,
		);
		const year = await sessions.dailyTotals(project, 366);
		expect(year).toHaveLength(366);
		expect(year[365]?.day).toBe("2026-08-17");
		expect(year[0]?.day).toBe("2025-08-17");
	});

	/** Today is one day of that stretch, and has to agree with it. */
	it("ends the stretch on the same today the day's own summary reads", async () => {
		await startSession();
		sessions.noteChanged(NOTES, () => "one two three four five\n");
		await timers.flush();
		const summary = await sessions.todaySummary(project);
		const [today] = await sessions.dailyTotals(project, 1);

		expect(today).toEqual(summary);
		expect(today?.day).toBe("2026-08-17");
		expect(today?.sessions).toBe(1);
	});

	/**
	 * A calendar is a shape before it is a reading: the days still to come are
	 * part of the month it is drawing, and one that stopped at today would
	 * change shape every morning.
	 */
	it("reads a whole month, the days still to come included", async () => {
		const folder =
			"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/711_Writing_Session/2026";
		const day = 86_400_000;
		await fakeVault.seedFile(
			`${folder}/2026_08_device-b_writing_session.json`,
			JSON.stringify({
				schemaVersion: 1,
				sessions: [foreignRecord(T0 - 3 * day, 120)],
			}),
		);
		await fakeVault.seedFile(
			`${folder}/2026_07_device-b_writing_session.json`,
			JSON.stringify({
				schemaVersion: 1,
				sessions: [foreignRecord(T0 - 40 * day, 400)],
			}),
		);

		const august = await sessions.monthTotals(project, "2026-08-17");
		expect(august).toHaveLength(31);
		expect(august[0]?.day).toBe("2026-08-01");
		expect(august[30]?.day).toBe("2026-08-31");
		expect(august[13]).toMatchObject({ day: "2026-08-14", trackedNet: 120 });
		// The rest of the month is drawn, and empty.
		expect(august[30]).toMatchObject({ sessions: 0, trackedNet: 0 });

		// A month the reader walked back to is read the same way.
		const july = await sessions.monthTotals(project, "2026-07-20");
		expect(july).toHaveLength(31);
		expect(july[7]).toMatchObject({ day: "2026-07-08", trackedNet: 400 });
	});

	/**
	 * The hours a project was written in, and the stages it was written at.
	 * A sitting belongs to the part of the day its clock ran through, not to
	 * the day it was filed under.
	 */
	it("spreads a day's sittings over the parts of the day", async () => {
		const folder =
			"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/711_Writing_Session/2026";
		const morning = Date.parse("2026-08-17T07:30:00.000Z");
		await fakeVault.seedFile(
			`${folder}/2026_08_device-b_writing_session.json`,
			JSON.stringify({
				schemaVersion: 1,
				sessions: [foreignRecord(morning, 100), foreignRecord(T0, 50)],
			}),
		);

		const today = await sessions.spread(project, "today");
		// Half past seven is the first part of the day; ten is the second.
		expect(today.bands[0]).toMatchObject({ focusMs: 60_000, added: 100 });
		expect(today.bands[1]).toMatchObject({ focusMs: 60_000, added: 50 });
		expect(today.bands[6]?.totalMs).toBe(0);
		const draft = today.modes.find((mode) => mode.mode === "draft");
		expect(draft).toMatchObject({ sessions: 2, focusMs: 120_000 });
		expect(today.modes.find((mode) => mode.mode === "planning")?.sessions).toBe(
			0,
		);
	});

	it("tells yesterday's sittings from today's", async () => {
		const folder =
			"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/711_Writing_Session/2026";
		await fakeVault.seedFile(
			`${folder}/2026_08_device-b_writing_session.json`,
			JSON.stringify({
				schemaVersion: 1,
				sessions: [foreignRecord(T0 - 86_400_000, 90)],
			}),
		);

		const yesterday = await sessions.spread(project, "yesterday");
		expect(yesterday.bands[1]?.added).toBe(90);
		const today = await sessions.spread(project, "today");
		expect(today.bands[1]?.added).toBe(0);
		expect(today.modes.every((mode) => mode.sessions === 0)).toBe(true);
	});

	/** Every month of every year, which is what "all time" has to mean. */
	it("reaches every year folder when the whole record is asked for", async () => {
		const base =
			"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/711_Writing_Session";
		await fakeVault.seedFile(
			`${base}/2026/2026_07_device-b_writing_session.json`,
			JSON.stringify({
				schemaVersion: 1,
				sessions: [foreignRecord(Date.parse("2026-07-08T20:00:00.000Z"), 400)],
			}),
		);
		await fakeVault.seedFile(
			`${base}/2025/2025_12_device-b_writing_session.json`,
			JSON.stringify({
				schemaVersion: 1,
				sessions: [foreignRecord(Date.parse("2025-12-02T04:00:00.000Z"), 60)],
			}),
		);

		const all = await sessions.spread(project, "all");
		// Eight in the evening, and four in the morning a year earlier.
		expect(all.bands[4]?.added).toBe(400);
		expect(all.bands[6]?.added).toBe(60);
		expect(all.modes.find((mode) => mode.mode === "draft")?.sessions).toBe(2);
	});

	it("counts the running session into the spread it belongs to", async () => {
		await startSession({ writingMode: "revision" });
		sessions.noteChanged(NOTES, () => "one two three four five\n");
		await timers.flush();

		const today = await sessions.spread(project, "today");
		expect(today.bands[1]?.focusMs).toBe(20_000);
		// The two words the edit added to what the note already held.
		expect(today.bands[1]?.added).toBe(2);
		const revision = today.modes.find((mode) => mode.mode === "revision");
		expect(revision).toMatchObject({ sessions: 1, focusMs: 20_000 });
	});

	/**
	 * A session holds its project ref for its whole life, so when the project
	 * folder itself moves the ref must move with it: judged against the old
	 * root, every note would read as having left the project, and the whole
	 * word count would be credited as deleted in one stroke.
	 */
	it("follows the project when its folder is renamed mid-session", async () => {
		await startSession();
		sessions.surfaceActivity(NOTES);
		sessions.noteChanged(NOTES, written("one two three four"));
		await timers.flush();
		expect(sessions.live()?.added).toBe(1);
		const oldRoot = "Snowflake Projects/Novel";
		const newRoot = "Snowflake Projects/Novel Renamed";
		fakeVault.rename(oldRoot, newRoot);
		sessions.notePathRenamed(oldRoot, newRoot);
		await timers.flush();
		expect(sessions.live()?.deleted).toBe(0);
		expect(sessions.live()?.added).toBe(1);
		// Writing under the new root still counts as the project's own.
		const movedNotes = `${newRoot}/80_Material/Notes.md`;
		sessions.noteChanged(movedNotes, written("one two three four five"));
		await timers.flush();
		expect(sessions.live()?.added).toBe(2);
		clock += 20_000;
		await sessions.stop();
		// And the record lands under the root the project has now, not the
		// path it left behind.
		const moved = fakeVault.contents.get(
			`${newRoot}/70_Tool/71_Data_Statistics/711_Writing_Session/2026/2026_08_device-a_writing_session.json`,
		);
		expect(moved).toBeDefined();
		const parsed = JSON.parse(moved ?? "{}") as {
			sessions: { words: { project: { added: number; deleted: number } } }[];
		};
		expect(parsed.sessions[0]?.words.project.added).toBe(2);
		expect(parsed.sessions[0]?.words.project.deleted).toBe(0);
	});

	/**
	 * A month file is named for the month its own device was in when the
	 * session began, and another zone's month can sit a day across from this
	 * one's: the walk has to open the neighbouring months too, or a session
	 * vanishes from the very day it is shown on.
	 */
	it("finds a session another zone filed under the neighbouring month", async () => {
		// Started 09:30 on 2026-09-01 in a UTC+14 zone: that moment is
		// 2026-08-31T19:30Z, the last of August to this device reading in UTC.
		const startedAt = Date.parse("2026-08-31T19:30:00.000Z");
		const september =
			"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/711_Writing_Session/2026/2026_09_device-b_writing_session.json";
		await fakeVault.seedFile(
			september,
			JSON.stringify({
				schemaVersion: 1,
				sessions: [foreignRecord(startedAt, 250)],
			}),
		);
		const days = await sessions.totalsBetween(
			project,
			"2026-08-31",
			"2026-08-31",
		);
		expect(days).toHaveLength(1);
		expect(days[0]?.sessions).toBe(1);
		expect(days[0]?.trackedNet).toBe(250);
	});

	/**
	 * The debounce drain runs outside the mutation queue, so a stop can land
	 * while a drain holds deltas it has already claimed from the pending map.
	 * The stop must wait for that drain, or the record is written without the
	 * last words typed.
	 */
	it("keeps the words a stop raced onto the debounce", async () => {
		await startSession();
		sessions.surfaceActivity(NOTES);
		sessions.noteChanged(NOTES, () => "one two three four five six\n");
		// Fire the debounce by hand and stop while the drain is mid-read.
		const pending = [...timers.handlers.values()];
		timers.handlers.clear();
		for (const handler of pending) handler();
		await sessions.stop();
		await settle();
		const written = monthFile();
		expect(written?.sessions).toHaveLength(1);
		expect(written?.sessions[0]?.words.project.added).toBe(3);
		expect(store.value).toBeNull();
	});

	/**
	 * The auto checks are re-run where the queue lands, not only where the
	 * call was made: a stale check must neither let an auto start replace a
	 * queued manual sitting, nor let a focus-mode stop kill the manual
	 * sitting that replaced its auto one.
	 */
	it("never lets a stale auto check replace or stop a manual sitting", async () => {
		const manual = sessions.start(project, options());
		// Checked before the manual start has run: the silence is stale.
		const auto = sessions.startAuto(
			project,
			options({ writingMode: "revision" }),
		);
		await Promise.all([manual, auto]);
		clock += 20_000;
		expect(sessions.live()?.startMode).toBe("manual");
		await sessions.stop();

		await sessions.startAuto(project, options({ writingMode: "revision" }));
		clock += 20_000;
		// The manual start is queued; the focus-mode exit still sees its auto
		// session and asks for a stop that must die with that session.
		const replacing = sessions.start(project, options());
		const stopped = sessions.stopIfAuto("focus-mode-ended");
		await Promise.all([replacing, stopped]);
		clock += 20_000;
		expect(sessions.live()?.startMode).toBe("manual");
		await sessions.stop();
	});

	/**
	 * An editor buffer passes through invalid frontmatter mid-edit. The count
	 * falls back to the disk rather than throwing away the whole drain -- and
	 * with it every other note's delta and, at a stop, the record itself.
	 */
	it("shrugs off invalid mid-edit frontmatter and reads the disk instead", async () => {
		await startSession();
		sessions.surfaceActivity(NOTES);
		sessions.noteChanged(NOTES, () => "---\ntitle: [\n---\nbroken words\n");
		await timers.flush();
		// The provider would not parse; the disk still holds the same three
		// words the baseline was seeded with.
		expect(sessions.live()?.added).toBe(0);
		expect(sessions.live()?.deleted).toBe(0);
		sessions.noteChanged(NOTES, written("one two three four"));
		await timers.flush();
		expect(sessions.live()?.added).toBe(1);
		await sessions.stop();
		expect(monthFile()?.sessions).toHaveLength(1);
	});

	/**
	 * The crash snapshot is the only copy of the session until its record is
	 * safely down: cleared first, one failed write would lose the sitting for
	 * good; cleared after, the next launch simply tries again.
	 */
	it("keeps the crash snapshot until the recovered record is written", async () => {
		await startSession();
		sessions.noteChanged(NOTES, () => "one two three four five\n");
		await timers.flush();
		clock += 10_000;
		sessions.markShutdown();
		const snapshot = store.value;
		expect(snapshot).not.toBeNull();

		const revived = buildService();
		const failing = vi
			.spyOn(projects.repository, "createPlainFile")
			.mockRejectedValueOnce(new Error("disk full"));
		await expect(revived.recoverAtStartup()).rejects.toThrow("disk full");
		expect(store.value).toEqual(snapshot);
		failing.mockRestore();

		const record = await revived.recoverAtStartup();
		expect(record).not.toBeNull();
		expect(store.value).toBeNull();
		expect(monthFile()?.sessions).toHaveLength(1);
	});

	/**
	 * A break that ends on its own clock is a resume nobody clicked: what
	 * changed through it must re-baseline exactly as a manual resume would,
	 * or the first keystroke of the new period is credited with everything
	 * typed during the break.
	 */
	it("credits nothing typed through an automatic break", async () => {
		await sessions.start(
			project,
			options({
				type: "pomodoro",
				timing: {
					idleThresholdSeconds: 6_000,
					workDurationSeconds: 60,
					breakDurationSeconds: 30,
					autoRepeat: true,
				},
			}),
		);
		clock += 20_000;
		sessions.surfaceActivity(NOTES);
		// The work period runs out on its own clock.
		clock += 45_000;
		await timers.flush();
		expect(sessions.live()?.state).toBe("paused");
		sessions.noteChanged(NOTES, written("one two three plus break words"));
		await timers.flush();
		expect(sessions.live()?.added).toBe(0);
		// The break ends by itself; nobody clicks resume.
		clock += 31_000;
		await timers.flush();
		expect(sessions.live()?.state).toBe("focus");
		// The same text again is no delta: the break absorbed those words.
		sessions.noteChanged(NOTES, written("one two three plus break words"));
		await timers.flush();
		expect(sessions.live()?.added).toBe(0);
		sessions.noteChanged(
			NOTES,
			written("one two three plus break words more"),
		);
		await timers.flush();
		expect(sessions.live()?.added).toBe(1);
	});

	/**
	 * A note only the disk knows about re-baselines through the drain, ahead
	 * of any delta for the same note: measured the other way round, the
	 * paused-time words would be credited to the first keystroke after the
	 * thaw.
	 */
	it("re-baselines a note only the disk knows before the next delta", async () => {
		await startSession();
		sessions.pause();
		// A sync client rewrites the note while the clock is frozen: no
		// editor holds it, so only the disk can say what it holds now.
		fakeVault.write(NOTES, written("one two three plus paused sync words")());
		sessions.noteChanged(NOTES);
		sessions.resume();
		// The author types straight away, before any disk read has landed.
		sessions.noteChanged(
			NOTES,
			written("one two three plus paused sync words again"),
		);
		await timers.flush();
		expect(sessions.live()?.added).toBe(1);
		expect(sessions.live()?.deleted).toBe(0);
	});

	/**
	 * A month file changes only when a session ends, and every reading walks
	 * the same files: parsed once per on-disk state, a repaint costs a stat
	 * check rather than a fresh read and re-validation of the whole month.
	 */
	it("parses a month file once until it changes on disk", async () => {
		const foreign =
			"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/711_Writing_Session/2026/2026_08_device-b_writing_session.json";
		await fakeVault.seedFile(
			foreign,
			JSON.stringify({
				schemaVersion: 1,
				sessions: [foreignRecord(T0 - 60 * 60_000, 250)],
			}),
		);
		const reads = (): number =>
			fakeVault.readCalls.filter((path) => path === foreign).length;
		const first = await sessions.todaySummary(project);
		expect(first.trackedNet).toBe(250);
		const before = reads();
		expect(before).toBeGreaterThan(0);
		const again = await sessions.todaySummary(project);
		expect(again.trackedNet).toBe(250);
		expect(reads()).toBe(before);
		// A stop rewrites this device's own file; the other device's stays
		// held, and the day still reads both sessions.
		await startSession();
		sessions.surfaceActivity(NOTES);
		sessions.noteChanged(NOTES, written("one two three four"));
		await timers.flush();
		clock += 20_000;
		await sessions.stop();
		const after = await sessions.todaySummary(project);
		expect(after.trackedNet).toBe(251);
		expect(after.sessions).toBe(2);
		expect(reads()).toBe(before);
	});

	/**
	 * A seed that cannot finish must leave no session standing: a liveState
	 * with no tracker would read as "starting" forever, refusing every auto
	 * start while crediting nothing.
	 */
	it("stands down cleanly when the baseline seed fails", async () => {
		const failing = vi
			.spyOn(projects.writingCount, "countNoteBoth")
			.mockRejectedValueOnce(new Error("read failed"));
		await expect(sessions.start(project, options())).rejects.toThrow(
			"read failed",
		);
		expect(sessions.isRunning()).toBe(false);
		expect(sessions.live()).toBeNull();
		failing.mockRestore();
		// And the next start is not haunted by the failed one.
		await startSession();
		expect(sessions.live()?.state).toBe("focus");
		await sessions.stop();
		expect(monthFile()?.sessions).toHaveLength(1);
	});

	/**
	 * Once a stop is reading the record out of the tracker, nothing may move
	 * the tracker again: an event landing mid-stop would close the same open
	 * stretch a second time, and the record would carry overlapping intervals
	 * counted twice by every reading.
	 */
	it("keeps the record's intervals whole when events land mid-stop", async () => {
		await startSession();
		sessions.surfaceActivity(NOTES);
		clock += 30_000;
		const stopping = sessions.stop();
		// Land events at every microtask seam of the stop.
		for (let i = 0; i < 4; i += 1) {
			await Promise.resolve();
			clock += 1_000;
			sessions.surfaceActivity(NOTES);
			sessions.pause();
			sessions.resume();
		}
		await stopping;
		await settle();
		const record = monthFile()?.sessions[0];
		expect(record).toBeDefined();
		const endedAt = Date.parse(record?.endedAt ?? "");
		const spans = [
			...(record?.activeIntervals ?? []),
			...(record?.idleIntervals ?? []),
			...(record?.pausedIntervals ?? []),
		]
			.map(
				(span) =>
					[Date.parse(span.startedAt), Date.parse(span.endedAt)] as const,
			)
			.sort((left, right) => left[0] - right[0]);
		expect(spans.length).toBeGreaterThan(0);
		for (const [from, to] of spans) {
			expect(from).toBeLessThanOrEqual(to);
			expect(to).toBeLessThanOrEqual(endedAt);
		}
		for (let i = 1; i < spans.length; i += 1) {
			const previous = spans[i - 1] ?? [0, 0];
			const current = spans[i] ?? [0, 0];
			expect(current[0]).toBeGreaterThanOrEqual(previous[1]);
		}
	});

	const CHARACTER = "Snowflake Projects/Novel/20_Character/Alice.md";

	/** A character note whose fields block holds `motivation`, rendered. */
	const characterNote = (motivation: string): string =>
		[
			"---",
			`snowflake-schema: ${String(SCHEMA_VERSION)}`,
			"snowflake-document: character",
			`snowflake-project-id: ${project.id}`,
			"---",
			"",
			"<!-- snowflake:section:character-fields:start -->",
			`**Motivation**: ${motivation}`,
			"<!-- snowflake:section:character-fields:end -->",
			"",
			"Alice walks on stage.\n",
		].join("\n");

	it("credits editor typing outside any session to the day's untimed words", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		const day = await sessions.todaySummary(project);
		// Two words, not five: the baseline seeded from the disk as it stood
		// before the edit, never from nothing.
		expect(day.added).toBe(2);
		expect(day.trackedNet).toBe(2);
		expect(day.goalNet).toBe(2);
		expect(day.sessions).toBe(0);
		expect(day.focusMs).toBe(0);
		expect(day.totalMs).toBe(0);
		expect(day.timedNet).toBe(0);
		expect(sessions.isRunning()).toBe(false);
	});

	it("marks word-bearing changes so panels can read the day at once", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		// The drain that moved the words says so; a throttled panel reads the
		// day immediately on this rather than waiting out its slow beat.
		expect(
			events.some(
				(event) => event.kind === "changed" && event.counted === true,
			),
		).toBe(true);
		await startSession();
		events.length = 0;
		sessions.setWritingMode("revision");
		// A change that moved no words carries no such mark.
		expect(
			events.some(
				(event) => event.kind === "changed" && event.counted === true,
			),
		).toBe(false);
	});

	it("credits a plugin save outside any session through the repository feed", async () => {
		fakeVault.write(DRAFT, written("alpha beta gamma", "draft")());
		await projects.manuscript.writeSegment(DRAFT, "alpha beta gamma delta\n");
		await timers.flush();
		const day = await sessions.todaySummary(project);
		// One word: the save was measured against the text it replaced.
		expect(day.added).toBe(1);
		expect(day.sessions).toBe(0);
	});

	it("credits a field-block edit by who caused it, never by where it landed", async () => {
		await fakeVault.seedFile(CHARACTER, characterNote("wants the crown"));
		sessions.notePersistedByPlugin(
			CHARACTER,
			characterNote("wants the crown"),
			characterNote("wants the crown very badly"),
			true,
		);
		await timers.flush();
		// The prose outside the block did not move; the typed words did.
		expect((await sessions.todaySummary(project)).added).toBe(2);
		// A reconcile re-rendering the same block credits nothing, however
		// much of it it rewrites.
		sessions.notePersistedByPlugin(
			CHARACTER,
			characterNote("wants the crown very badly"),
			characterNote("rendered wholly anew by the reconcile pass"),
			false,
		);
		await timers.flush();
		const day = await sessions.todaySummary(project);
		expect(day.added).toBe(2);
		expect(day.deleted).toBe(0);
	});

	it("weighs a note's creation and deletion the same, blocks included", async () => {
		await fakeVault.seedFile(CHARACTER, characterNote("wants the crown"));
		sessions.notePersistedByPlugin(
			CHARACTER,
			"",
			characterNote("wants the crown"),
			true,
		);
		await timers.flush();
		const created = await sessions.todaySummary(project);
		// More than the prose alone: the rendered block counted in with it.
		expect(created.added).toBeGreaterThan(4);
		fakeVault.delete(CHARACTER);
		sessions.noteDeleted(CHARACTER);
		const gone = await sessions.todaySummary(project);
		// And the whole of it counted out again: creating a character and
		// deleting it nets zero, with no ghost words left where the rendered
		// block used to be.
		expect(gone.deleted).toBe(created.added);
		expect(gone.trackedNet).toBe(0);
	});

	it("credits a form's field edit to the running session once", async () => {
		await fakeVault.seedFile(CHARACTER, characterNote("wants the crown"));
		await startSession();
		sessions.notePersistedByPlugin(
			CHARACTER,
			characterNote("wants the crown"),
			characterNote("wants the crown very badly"),
			true,
		);
		await timers.flush();
		expect(sessions.live()?.added).toBe(2);
	});

	it("gates untimed capture per project while a session runs", async () => {
		const second = await projects.createProject({
			title: "Second",
			locale: "en",
		});
		projectRefs.push(second);
		const otherNote = "Snowflake Projects/Second/80_Material/Ideas.md";
		const otherText = (body: string): string =>
			[
				"---",
				`snowflake-schema: ${String(SCHEMA_VERSION)}`,
				"snowflake-document: material",
				`snowflake-project-id: ${second.id}`,
				"---",
				"",
				`${body}\n`,
			].join("\n");
		await fakeVault.seedFile(otherNote, otherText("first thoughts"));
		await startSession();
		sessions.noteChanged(NOTES, written("one two three four five"));
		sessions.noteChanged(otherNote, () =>
			otherText("first thoughts arrive tonight"),
		);
		await timers.flush();
		// The session took its own project's words...
		expect(sessions.live()?.added).toBe(2);
		// ...and only the session did: nothing doubled into an untimed day.
		const own = await sessions.todaySummary(project);
		expect(own.trackedNet).toBe(2);
		expect(own.sessions).toBe(1);
		// The other project kept its untimed capture through it all.
		const other = await sessions.todaySummary(second);
		expect(other.trackedNet).toBe(2);
		expect(other.sessions).toBe(0);
	});

	it("re-seeds after a session so its words are not credited again", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		expect((await sessions.todaySummary(project)).trackedNet).toBe(2);
		await startSession();
		sessions.noteChanged(
			NOTES,
			written("one two three four five six seven"),
		);
		await timers.flush();
		// The autosave lands what the session watched being typed.
		fakeVault.write(NOTES, written("one two three four five six seven")());
		await sessions.stop();
		sessions.noteChanged(
			NOTES,
			written("one two three four five six seven eight"),
		);
		await timers.flush();
		const day = await sessions.todaySummary(project);
		// 2 untimed + 4 in the session + 1 after it -- not the session's four
		// over again, which is what a baseline kept through it would credit.
		expect(day.trackedNet).toBe(7);
		expect(day.timedNet).toBe(4);
		expect(day.sessions).toBe(1);
	});

	it("rolls the day over, files yesterday whole and keeps counting", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		clock += 26 * 3_600_000;
		sessions.noteChanged(NOTES, written("one two three four five six"));
		await timers.flush();
		const file = JSON.parse(fakeVault.contents.get(UNTIMED_FILE) ?? "{}") as {
			days: { id: string; day: string; words: { project: { net: number } } }[];
		};
		// Yesterday is filed whole; today may already be there too, carried by
		// the flush beat -- one record per day either way, never a duplicate.
		expect(new Set(file.days.map((day) => day.id)).size).toBe(
			file.days.length,
		);
		const filed = file.days.find((day) => day.day === "2026-08-17");
		expect(filed?.id).toBe("untimed-device-a-2026-08-17");
		expect(filed?.words.project.net).toBe(2);
		const [yesterday, today] = await sessions.dailyTotals(project, 2);
		expect(yesterday?.trackedNet).toBe(2);
		expect(today?.trackedNet).toBe(1);
	});

	it("upserts one record per device and day across a toggle cycle", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		untimedOn = false;
		await sessions.untimedTrackingChanged();
		await settle();
		const filed = JSON.parse(fakeVault.contents.get(UNTIMED_FILE) ?? "{}") as {
			days: { words: { project: { net: number } } }[];
		};
		expect(filed.days).toHaveLength(1);
		expect(filed.days[0]?.words.project.net).toBe(2);
		// Typing while off credits nothing new, and the filed day still reads.
		sessions.noteChanged(NOTES, written("one two three four five nothing"));
		await timers.flush();
		expect((await sessions.todaySummary(project)).trackedNet).toBe(2);
		// Back on: the day continues as one record, not a second copy.
		untimedOn = true;
		fakeVault.write(NOTES, written("one two three four five")());
		sessions.noteChanged(NOTES, written("one two three four five six"));
		await timers.flush();
		untimedOn = false;
		await sessions.untimedTrackingChanged();
		await settle();
		const upserted = JSON.parse(
			fakeVault.contents.get(UNTIMED_FILE) ?? "{}",
		) as { days: { words: { project: { net: number } } }[] };
		expect(upserted.days).toHaveLength(1);
		expect(upserted.days[0]?.words.project.net).toBe(3);
	});

	it("files the accruing day on the flush beat, not only at its end", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		// The day is underway and nothing has reached the vault yet.
		expect(fakeVault.contents.get(UNTIMED_FILE)).toBeUndefined();
		// The beat those credits armed fires, and the vault catches up
		// mid-day: another device sees today, and a lost localStorage now
		// costs minutes rather than the day.
		await timers.flush();
		const filed = JSON.parse(fakeVault.contents.get(UNTIMED_FILE) ?? "{}") as {
			days: {
				id: string;
				updatedAt?: string;
				words: { project: { net: number } };
			}[];
		};
		expect(filed.days).toHaveLength(1);
		expect(filed.days[0]?.words.project.net).toBe(2);
		// The record says when this copy of the day was filed, so a reader of
		// the file can tell a trailing number from a settled one.
		expect(filed.days[0]?.updatedAt).toBe(new Date(clock).toISOString());
		// The day keeps accruing into the same record, not a second copy.
		sessions.noteChanged(NOTES, written("one two three four five six"));
		await timers.flush();
		await timers.flush();
		const upserted = JSON.parse(
			fakeVault.contents.get(UNTIMED_FILE) ?? "{}",
		) as { days: { words: { project: { net: number } } }[] };
		expect(upserted.days).toHaveLength(1);
		expect(upserted.days[0]?.words.project.net).toBe(3);
	});

	it("holds the write to the ceiling when the credits never go quiet", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		// Fresh dirt is paced by the quiet spell.
		expect(timers.delays[timers.delays.length - 1]).toBe(5 * 60_000);
		// Sixteen minutes of dirt later the first write fails, keeping the
		// dirt's age; the next credit finds the ceiling spent and the write
		// goes out at once -- the fake runs zero-delay timers immediately, so
		// the ceiling shows as the file landing with no further beat.
		clock += 16 * 60_000;
		fakeVault.failNextCreatePath = UNTIMED_FILE;
		fakeVault.write(NOTES, written("one two three four five")());
		sessions.noteChanged(NOTES, written("one two three four five six"));
		await timers.flush();
		// No session ran, so the one zero-delay timer is the spent ceiling.
		expect(timers.delays).toContain(0);
		const filed = JSON.parse(fakeVault.contents.get(UNTIMED_FILE) ?? "{}") as {
			days: { words: { project: { net: number } } }[];
		};
		expect(filed.days).toHaveLength(1);
		expect(filed.days[0]?.words.project.net).toBe(3);
	});

	it("resumes a same-day untimed snapshot where the day still is", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		sessions.markShutdown();
		expect(untimedStore.value).not.toBeNull();
		sessions = buildService();
		await sessions.recoverAtStartup();
		await settle();
		// Nothing filed: the day is still underway, resumed in memory.
		expect(fakeVault.contents.get(UNTIMED_FILE)).toBeUndefined();
		expect((await sessions.todaySummary(project)).trackedNet).toBe(2);
		expect(untimedStore.value).not.toBeNull();
	});

	it("finalizes a past-day untimed snapshot into its file", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		sessions.markShutdown();
		clock += 26 * 3_600_000;
		sessions = buildService();
		await sessions.recoverAtStartup();
		await settle();
		const file = JSON.parse(fakeVault.contents.get(UNTIMED_FILE) ?? "{}") as {
			days: { day: string }[];
		};
		expect(file.days).toHaveLength(1);
		expect(file.days[0]?.day).toBe("2026-08-17");
		expect(untimedStore.value).toBeNull();
		const [yesterday] = await sessions.dailyTotals(project, 2);
		expect(yesterday?.trackedNet).toBe(2);
	});

	it("keeps the untimed snapshot until its record is written", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		sessions.markShutdown();
		clock += 26 * 3_600_000;
		sessions = buildService();
		fakeVault.failNextCreatePath = UNTIMED_FILE;
		await sessions.recoverAtStartup();
		await settle();
		expect(fakeVault.contents.get(UNTIMED_FILE)).toBeUndefined();
		// The snapshot still carries the day for the next launch to retry.
		expect(untimedStore.value).not.toBeNull();
		sessions = buildService();
		await sessions.recoverAtStartup();
		await settle();
		const retried = JSON.parse(
			fakeVault.contents.get(UNTIMED_FILE) ?? "{}",
		) as { days: unknown[] };
		expect(retried.days).toHaveLength(1);
		expect(untimedStore.value).toBeNull();
	});

	it("reads untimed words into words and goals but never into time or pace", async () => {
		const foreign =
			"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/711_Writing_Session/2026/2026_08_device-b_untimed_writing.json";
		await fakeVault.seedFile(
			foreign,
			JSON.stringify({
				schemaVersion: 1,
				days: [
					{
						id: "untimed-device-b-2026-08-17",
						day: "2026-08-17",
						timezone: "UTC",
						words: {
							project: { added: 10, deleted: 1, net: 9 },
							manuscript: { added: 4, deleted: 0, net: 4 },
						},
						files: [
							{ path: DRAFT, added: 4, deleted: 0, net: 4, manuscript: true },
							{ path: NOTES, added: 6, deleted: 1, net: 5, manuscript: false },
						],
					},
				],
			}),
		);
		await fakeVault.seedFile(
			MONTH_FILE.replace("device-a", "device-b"),
			JSON.stringify({
				schemaVersion: 1,
				sessions: [foreignRecord(T0 - 3_600_000, 100, 40)],
			}),
		);
		const day = await sessions.todaySummary(project);
		expect(day.added).toBe(110);
		expect(day.deleted).toBe(1);
		expect(day.trackedNet).toBe(109);
		expect(day.goalNet).toBe(109);
		expect(day.sessions).toBe(1);
		expect(day.focusMs).toBe(60_000);
		expect(day.timedNet).toBe(100);
		lens = "manuscript";
		goalScope = "manuscript";
		const strict = await sessions.todaySummary(project);
		expect(strict.added).toBe(44);
		expect(strict.trackedNet).toBe(44);
		expect(strict.timedNet).toBe(40);
		expect(strict.goalNet).toBe(44);
	});

	it("keeps untimed words out of the temporal spread", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		const today = await sessions.spread(project, "today");
		expect(today.bands.every((band) => band.added === 0)).toBe(true);
		expect(today.modes.every((mode) => mode.trackedNet === 0)).toBe(true);
	});

	it("credits an untimed deletion only for notes it credited today", async () => {
		fakeVault.write(DRAFT, written("draft words standing here", "draft")());
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		// A member the day never wrote in: known to the tracker, uncredited.
		sessions.noteWrittenExternally(DRAFT);
		await timers.flush();
		sessions.noteDeleted(DRAFT);
		expect((await sessions.todaySummary(project)).deleted).toBe(0);
		// The note the day did write in credits what it last held.
		sessions.noteDeleted(NOTES);
		const day = await sessions.todaySummary(project);
		expect(day.deleted).toBe(5);
		expect(day.added).toBe(2);
	});

	it("credits a deletion after a session from the session's own ledger", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		await startSession();
		sessions.noteChanged(
			NOTES,
			written("one two three four five six seven"),
		);
		await timers.flush();
		fakeVault.write(NOTES, written("one two three four five six seven")());
		await sessions.stop();
		// Deleted without another touch: the baselines the session handed
		// back are what know the note stood at seven words.
		fakeVault.delete(NOTES);
		sessions.noteDeleted(NOTES);
		expect((await sessions.todaySummary(project)).deleted).toBe(7);
	});

	it("credits a deletion after a relaunch from the snapshot's baselines", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		sessions.markShutdown();
		sessions = buildService();
		await sessions.recoverAtStartup();
		await settle();
		fakeVault.delete(NOTES);
		sessions.noteDeleted(NOTES);
		const day = await sessions.todaySummary(project);
		// The note stood at five words, and the relaunch did not forget it.
		expect(day.deleted).toBe(5);
		expect(day.trackedNet).toBe(-3);
	});

	it("still takes back the day's own words when every baseline is lost", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		sessions.markShutdown();
		// A snapshot from before any standing count was carried: no side map,
		// no per-tally standing, no convention stamp.
		const held = untimedStore.value as {
			states: {
				baselines?: unknown;
				countMode?: unknown;
				countHeadings?: unknown;
				files: { standing?: unknown }[];
			}[];
		};
		for (const state of held.states) {
			delete state.baselines;
			delete state.countMode;
			delete state.countHeadings;
			for (const tally of state.files) delete tally.standing;
		}
		sessions = buildService();
		await sessions.recoverAtStartup();
		await settle();
		fakeVault.delete(NOTES);
		sessions.noteDeleted(NOTES);
		const day = await sessions.todaySummary(project);
		// The standing count is unknowable, but the day put two words in and
		// the deletion takes at least those back out.
		expect(day.deleted).toBe(2);
		expect(day.trackedNet).toBe(0);
	});

	it("carries untimed state through a project folder rename", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		const oldRoot = "Snowflake Projects/Novel";
		const newRoot = "Snowflake Projects/Novel Renamed";
		fakeVault.rename(oldRoot, newRoot);
		sessions.notePathRenamed(oldRoot, newRoot);
		projectRefs = [
			{
				...project,
				rootPath: newRoot,
				projectFile: project.projectFile.replace(oldRoot, newRoot),
			},
		];
		const movedNotes = `${newRoot}/80_Material/Notes.md`;
		sessions.noteChanged(movedNotes, written("one two three four five six"));
		await timers.flush();
		untimedOn = false;
		await sessions.untimedTrackingChanged();
		await settle();
		const moved = fakeVault.contents.get(
			`${newRoot}/70_Tool/71_Data_Statistics/711_Writing_Session/2026/2026_08_device-a_untimed_writing.json`,
		);
		expect(moved).toBeDefined();
		const parsed = JSON.parse(moved ?? "{}") as {
			days: { words: { project: { added: number; deleted: number } } }[];
		};
		expect(parsed.days[0]?.words.project.added).toBe(3);
		expect(parsed.days[0]?.words.project.deleted).toBe(0);
	});

	it("records typing through a pause to the untimed day", async () => {
		await startSession();
		sessions.pause();
		sessions.noteChanged(NOTES, written("one two three plus paused words"));
		await timers.flush();
		// The session's clock and ledger stay frozen; the words land anyway.
		expect(sessions.live()?.added).toBe(0);
		const paused = await sessions.todaySummary(project);
		expect(paused.added).toBe(3);
		expect(paused.trackedNet).toBe(3);
		expect(paused.timedNet).toBe(0);
		// The thaw re-measures against what the untimed ledger settled: the
		// paused words are not credited a second time.
		sessions.resume();
		sessions.noteChanged(
			NOTES,
			written("one two three plus paused words typed"),
		);
		await timers.flush();
		expect(sessions.live()?.added).toBe(1);
		const day = await sessions.todaySummary(project);
		expect(day.added).toBe(4);
		expect(day.trackedNet).toBe(4);
		expect(day.timedNet).toBe(1);
	});

	it("counts words typed just before a pause exactly once", async () => {
		await startSession();
		// Typed while the clock ran, with the drain still on the debounce.
		let text = written("one two three four")();
		sessions.noteChanged(NOTES, () => text);
		// The pause lands first; the provider now answers with the paused
		// text, so a drain reading it would hand the session the whole lot.
		sessions.pause();
		text = written("one two three four five six")();
		sessions.noteChanged(NOTES, () => text);
		await timers.flush();
		const day = await sessions.todaySummary(project);
		expect(day.added).toBe(3);
		expect(day.deleted).toBe(0);
		// One word belonged to the running clock, two to the freeze.
		expect(day.timedNet).toBe(1);
		expect(sessions.live()?.added).toBe(1);
	});

	it("keeps the words typed in the last beat before a resume", async () => {
		await startSession();
		sessions.pause();
		// Typed during the pause, with no drain between it and the thaw.
		sessions.noteChanged(NOTES, written("one two three four five"));
		sessions.resume();
		await timers.flush();
		const day = await sessions.todaySummary(project);
		expect(day.added).toBe(2);
		expect(day.trackedNet).toBe(2);
		// The freeze recorded them, so the clock claims none of them.
		expect(day.timedNet).toBe(0);
		// And the session comes back measured against them, not crediting
		// them a second time at its next keystroke.
		sessions.noteChanged(
			NOTES,
			written("one two three four five six"),
		);
		await timers.flush();
		const after = await sessions.todaySummary(project);
		expect(after.added).toBe(3);
		expect(after.timedNet).toBe(1);
	});

	it("keeps a deleted note's words in the reading they were filed under", async () => {
		fakeVault.write(DRAFT, written("alpha beta", "draft")());
		sessions.noteChanged(DRAFT, written("alpha beta gamma delta", "draft"));
		await timers.flush();
		lens = "manuscript";
		goalScope = "manuscript";
		const before = await sessions.todaySummary(project);
		expect(before.added).toBe(2);
		// The note goes; its tally stays behind under its membership, which
		// a session that seeds from the notes that exist cannot know.
		fakeVault.delete(DRAFT);
		sessions.noteDeleted(DRAFT);
		await startSession();
		await sessions.stop();
		const after = await sessions.todaySummary(project);
		expect(after.added).toBe(2);
		// And a pause hands its memberships over the same way.
		await startSession();
		sessions.pause();
		const paused = await sessions.todaySummary(project);
		expect(paused.added).toBe(2);
	});

	it("records typing through a pomodoro break to the untimed day", async () => {
		await sessions.start(
			project,
			options({
				type: "pomodoro",
				timing: {
					idleThresholdSeconds: 6_000,
					workDurationSeconds: 60,
					breakDurationSeconds: 30,
					autoRepeat: true,
				},
			}),
		);
		clock += 20_000;
		sessions.surfaceActivity(NOTES);
		// The work period runs out on its own clock; the break begins.
		clock += 45_000;
		await timers.flush();
		expect(sessions.live()?.state).toBe("paused");
		sessions.noteChanged(NOTES, written("one two three plus break words"));
		await timers.flush();
		expect(sessions.live()?.added).toBe(0);
		const day = await sessions.todaySummary(project);
		expect(day.added).toBe(3);
		expect(day.timedNet).toBe(0);
	});

	it("does not double-credit a deletion the session already settled", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		fakeVault.write(NOTES, written("one two three four five")());
		await startSession();
		sessions.noteChanged(
			NOTES,
			written("one two three four five six seven"),
		);
		await timers.flush();
		fakeVault.delete(NOTES);
		sessions.noteDeleted(NOTES);
		// The session credits the standing seven once; the dormant untimed
		// day, whose morning tallied two of those words, must not subtract
		// them again.
		const day = await sessions.todaySummary(project);
		expect(day.added).toBe(4);
		expect(day.deleted).toBe(7);
		expect(day.trackedNet).toBe(-3);
		await sessions.stop();
		const after = await sessions.todaySummary(project);
		expect(after.deleted).toBe(7);
	});

	it("credits a post-stop deletion of a note only the session wrote", async () => {
		await startSession();
		sessions.noteChanged(
			NOTES,
			written("one two three four five six seven"),
		);
		await timers.flush();
		fakeVault.write(NOTES, written("one two three four five six seven")());
		await sessions.stop();
		// No untimed tally exists for the note; the baseline the session
		// vouched for at its stop is what knows it stood at seven.
		fakeVault.delete(NOTES);
		sessions.noteDeleted(NOTES);
		const day = await sessions.todaySummary(project);
		expect(day.added).toBe(4);
		expect(day.deleted).toBe(7);
		expect(day.trackedNet).toBe(-3);
	});

	it("nets a manuscript merge outside a session to nothing", async () => {
		const SECOND = "Snowflake Projects/Novel/50_Manuscript/Second.md";
		const before = written("head words", "draft")();
		const after = written(
			"head words absorbed tail words standing here",
			"draft",
		)();
		sessions.notePersistedByPlugin(DRAFT, before, after, true);
		sessions.noteRemovedByPlugin(
			SECOND,
			"absorbed tail words standing here\n",
			{ manuscript: true },
		);
		sessions.noteDeleted(SECOND);
		await timers.flush();
		const day = await sessions.todaySummary(project);
		expect(day.added).toBe(5);
		expect(day.deleted).toBe(5);
		expect(day.trackedNet).toBe(0);
		// And under the lens the merge is actually about: the survivor's
		// growth and the absorbed note's removal are both the manuscript's,
		// so the reading a novelist watches does not gain a segment nobody
		// wrote.
		lens = "manuscript";
		goalScope = "manuscript";
		const strict = await sessions.todaySummary(project);
		expect(strict.added).toBe(5);
		expect(strict.deleted).toBe(5);
		expect(strict.trackedNet).toBe(0);
		expect(strict.goalNet).toBe(0);
	});

	it("lets a deleted project's untimed day go instead of resurrecting it", async () => {
		sessions.noteChanged(NOTES, written("one two three four"));
		await timers.flush();
		sessions.noteDeleted("Snowflake Projects/Novel", { children: true });
		// The armed flush finds nothing to file: the state went with the
		// project, and no ghost of its folder tree comes back.
		await timers.flush();
		await settle();
		expect(fakeVault.contents.has(UNTIMED_FILE)).toBe(false);
		expect(untimedStore.value).toBeNull();
	});

	it("hydrates one copy of a day, never the disk under an unfiled flush", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		await timers.flush();
		expect(fakeVault.contents.has(UNTIMED_FILE)).toBe(true);
		sessions.noteChanged(NOTES, written("one two three four five six"));
		await timers.flush();
		// The switch-off files the whole day, but the write fails: the record
		// waits in memory while the disk keeps the older copy of the same id.
		fakeVault.failNextProcessPath = UNTIMED_FILE;
		untimedOn = false;
		await sessions.untimedTrackingChanged();
		await settle();
		untimedOn = true;
		sessions.noteChanged(
			NOTES,
			written("one two three four five six seven"),
		);
		await timers.flush();
		const day = await sessions.todaySummary(project);
		// Three words waited unfiled, one was typed now; the disk's stale two
		// are the same day again, not more of it.
		expect(day.added).toBe(4);
		expect(day.deleted).toBe(0);
		await timers.flush();
		const parsed = JSON.parse(
			fakeVault.contents.get(UNTIMED_FILE) ?? "{}",
		) as { days: { words: { project: { added: number } } }[] };
		expect(parsed.days).toHaveLength(1);
		expect(parsed.days[0]?.words.project.added).toBe(4);
	});

	it("retries a failed hydrate read instead of clobbering the day", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		await timers.flush();
		untimedOn = false;
		await sessions.untimedTrackingChanged();
		await settle();
		untimedOn = true;
		// The day's first read back fails once; the fold must wait for the
		// retry rather than be marked done and skipped forever.
		fakeVault.failNextReadPath = UNTIMED_FILE;
		sessions.noteChanged(NOTES, written("one two three four five six"));
		await timers.flush();
		await timers.flush();
		const day = await sessions.todaySummary(project);
		expect(day.added).toBe(3);
		await timers.flush();
		const parsed = JSON.parse(
			fakeVault.contents.get(UNTIMED_FILE) ?? "{}",
		) as { days: { words: { project: { added: number } } }[] };
		expect(parsed.days).toHaveLength(1);
		expect(parsed.days[0]?.words.project.added).toBe(3);
	});

	it("keeps a rebase queued across midnight from crediting foreign words", async () => {
		sessions.noteChanged(NOTES, written("one two three four"));
		await timers.flush();
		fakeVault.write(
			NOTES,
			written("one two three four foreign sync words landed")(),
		);
		sessions.noteWrittenExternally(NOTES);
		clock += 24 * 60 * 60_000;
		await timers.flush();
		sessions.noteChanged(
			NOTES,
			written("one two three four foreign sync words landed typed"),
		);
		await timers.flush();
		const day = await sessions.todaySummary(project);
		expect(day.added).toBe(1);
		expect(day.deleted).toBe(0);
	});

	it("credits a deletion into the day it happens, not yesterday", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		clock += 24 * 60 * 60_000;
		fakeVault.delete(NOTES);
		sessions.noteDeleted(NOTES);
		const totals = await sessions.dailyTotals(project, 2);
		expect(totals[0]?.added).toBe(2);
		expect(totals[0]?.deleted).toBe(0);
		expect(totals[1]?.deleted).toBe(5);
		expect(totals[1]?.trackedNet).toBe(-5);
	});

	it("hands baselines to a fresh untimed day at the stop", async () => {
		await startSession();
		sessions.noteChanged(NOTES, written("one two three four five six"));
		await timers.flush();
		await sessions.stop();
		// The disk still lags the editor; the handed-over baseline is what
		// keeps the session's tail from being credited a second time.
		sessions.noteChanged(
			NOTES,
			written("one two three four five six typed"),
		);
		await timers.flush();
		const day = await sessions.todaySummary(project);
		expect(day.added).toBe(4);
		expect(day.timedNet).toBe(3);
	});

	it("survives the tracking toggling off under a parked drain", async () => {
		const real = projects.writingCount.countNoteWhole.bind(
			projects.writingCount,
		);
		const parked = vi
			.spyOn(projects.writingCount, "countNoteWhole")
			.mockImplementationOnce(async (path, opts) => {
				untimedOn = false;
				void sessions.untimedTrackingChanged();
				await settle();
				return real(path, opts);
			});
		sessions.noteChanged(NOTES, written("one two three four"));
		await timers.flush();
		await settle();
		parked.mockRestore();
		// The in-flight delta lands nowhere rather than in a detached ledger
		// nothing would ever flush or snapshot.
		const day = await sessions.todaySummary(project);
		expect(day.added).toBe(0);
		expect(untimedStore.value).toBeNull();
	});

	it("credits a save that follows a mechanical rewrite in the same beat", async () => {
		sessions.noteChanged(NOTES, written("one two three four"));
		await timers.flush();
		fakeVault.write(NOTES, written("one two three four rendered")());
		sessions.notePersistedByPlugin(
			NOTES,
			written("one two three four")(),
			written("one two three four rendered")(),
			false,
		);
		sessions.notePersistedByPlugin(
			NOTES,
			written("one two three four rendered")(),
			written("one two three four rendered typed words")(),
			true,
		);
		fakeVault.write(
			NOTES,
			written("one two three four rendered typed words")(),
		);
		await timers.flush();
		// The mechanical word re-baselined away; the typed two survived the
		// rebase that would have read the disk after the save.
		const day = await sessions.todaySummary(project);
		expect(day.added).toBe(3);
		expect(day.deleted).toBe(0);
	});

	it("re-freezes the convention with the day and drops cross-rule baselines", async () => {
		sessions.noteChanged(NOTES, written("# Head\n\none two three"));
		await timers.flush();
		fakeVault.write(NOTES, written("# Head\n\none two three")());
		activeCountOptions = { mode: "ms-word", headings: "skip-all" };
		clock += 24 * 60 * 60_000;
		// The same text under the new rule: the rules' disagreement over the
		// heading must read as nothing, not as a word appearing or vanishing.
		sessions.noteChanged(NOTES, written("# Head\n\none two three"));
		await timers.flush();
		const totals = await sessions.dailyTotals(project, 2);
		expect(totals[0]?.added).toBe(1);
		expect(totals[1]?.added).toBe(0);
		expect(totals[1]?.deleted).toBe(0);
		sessions.noteChanged(NOTES, written("# Head\n\none two three four"));
		await timers.flush();
		untimedOn = false;
		await sessions.untimedTrackingChanged();
		await settle();
		const parsed = JSON.parse(
			fakeVault.contents.get(UNTIMED_FILE) ?? "{}",
		) as { days: { day: string; countHeadings?: string }[] };
		const byDay = new Map(parsed.days.map((day) => [day.day, day]));
		expect(byDay.get("2026-08-17")?.countHeadings).toBe("count");
		expect(byDay.get("2026-08-18")?.countHeadings).toBe("skip-all");
	});

	it("re-arms the drain a stopping session cleared for another project", async () => {
		const second = await projects.createProject({
			title: "Second",
			locale: "en",
		});
		projectRefs = [project, second];
		const OTHER = `${second.rootPath}/80_Material/Other.md`;
		await fakeVault.seedFile(
			OTHER,
			[
				"---",
				`snowflake-schema: ${String(SCHEMA_VERSION)}`,
				"snowflake-document: material",
				`snowflake-project-id: ${second.id}`,
				"---",
				"",
				"other words\n",
			].join("\n"),
		);
		const otherTyped = (): string =>
			[
				"---",
				`snowflake-schema: ${String(SCHEMA_VERSION)}`,
				"snowflake-document: material",
				`snowflake-project-id: ${second.id}`,
				"---",
				"",
				"other words typed here\n",
			].join("\n");
		await startSession();
		sessions.noteChanged(OTHER, otherTyped);
		// The stop clears the shared debounce; the other project's queued
		// words must get it re-armed rather than stranded.
		await sessions.stop();
		await timers.flush();
		const day = await sessions.todaySummary(second);
		expect(day.added).toBe(2);
	});

	it("announces recovered untimed words to painted panels", async () => {
		sessions.noteChanged(NOTES, written("one two three four"));
		await timers.flush();
		sessions.markShutdown();
		sessions = buildService();
		events.length = 0;
		await sessions.recoverAtStartup();
		await settle();
		expect(
			events.some(
				(event) => event.kind === "changed" && event.counted,
			),
		).toBe(true);
	});

	it("shows yesterday whole on the reading that rolls it over", async () => {
		sessions.noteChanged(NOTES, written("one two three four five"));
		await timers.flush();
		clock += 24 * 60 * 60_000;
		// This very reading performs the rollover; yesterday must not be
		// short on it and whole only on the next.
		const totals = await sessions.dailyTotals(project, 2);
		expect(totals[0]?.added).toBe(2);
		expect(totals[1]?.added).toBe(0);
	});
});
