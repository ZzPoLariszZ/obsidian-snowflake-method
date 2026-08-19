import { beforeEach, describe, expect, it } from "vitest";

import {
	SCHEMA_VERSION,
	type WritingSessionRecord,
	type WritingSessionScope,
	type WritingSessionSnapshot,
	type WritingSurfaceActivity,
} from "../../src/domain";
import {
	SnowflakeProjectService,
	WritingSessionService,
	type ProjectSnapshot,
	type StartWritingSessionOptions,
	type WritingSessionEvent,
} from "../../src/services";
import { createFakeEnvironment, type FakeVault } from "../helpers/fake-vault";

const T0 = Date.parse("2026-08-17T10:00:00.000Z");
const DRAFT = "Snowflake Projects/Novel/50_Manuscript/Draft.md";
/** A note of the project that is not the manuscript's: in one scope, not both. */
const NOTES = "Snowflake Projects/Novel/80_Material/Notes.md";
/** A note nobody's project made, which is therefore nobody's word count. */
const LOOSE = "Snowflake Projects/Novel/Loose note.md";
const MONTH_FILE =
	"Snowflake Projects/Novel/70_Tool/71_Data_Statistics/711_Writing_Session/2026/2026_08_device-a_writing_session.json";

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
	let timers: {
		handlers: Map<number, () => void>;
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
			now: () => clock,
			timezone: () => "UTC",
			uuid: () => `session-${String(clock)}`,
			timers: {
				set: (handler, ms) => {
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
		const handlers = new Map<number, () => void>();
		timers = {
			handlers,
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

	/** An edit on a writing surface, with the defaults most tests want. */
	const surface = (
		overrides: Partial<WritingSurfaceActivity> = {},
	): WritingSurfaceActivity => ({
		kind: "markdown-editor",
		path: NOTES,
		...overrides,
	});

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
		sessions.surfaceActivity(surface());
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

	it("credits a note born mid-session with the words it was born with", async () => {
		await startSession();
		const path = "Snowflake Projects/Novel/80_Material/Fresh.md";
		await seedNote(path, "four new words here");
		// The create alone: a note written in one go fires nothing after it,
		// so waiting for a change would lose everything a form put in it.
		sessions.noteCreated(path);
		await timers.flush();
		expect(sessions.live()?.added).toBe(4);
		// And a later edit of the same note credits only the difference.
		sessions.noteChanged(path, written("four new words here again"));
		await timers.flush();
		expect(sessions.live()?.added).toBe(5);
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
		sessions.surfaceActivity(surface({ path: NOTES }));
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
		sessions.surfaceActivity(surface());
		expect(sessions.live()?.state).toBe("focus");
		clock += 61_000;
		expect(sessions.live()?.state).toBe("idle");
		sessions.surfaceActivity(surface());
		expect(sessions.live()?.state).toBe("focus");
	});

	it("holds focus for a form field and credits it no words", async () => {
		await startSession();
		clock += 90_000;
		expect(sessions.live()?.state).toBe("idle");
		// A name, a status, a paragraph of prose: all the same to the clock,
		// and none of them words until a note holds them.
		for (const kind of ["dashboard-field", "modal-field"] as const) {
			sessions.surfaceActivity({ kind, path: project.projectFile });
			expect(sessions.live()?.state).toBe("focus");
			expect(sessions.live()?.added).toBe(0);
			clock += 90_000;
		}
	});

	it("counts a form's writing only once the save persists it", async () => {
		await startSession();
		sessions.surfaceActivity({ kind: "modal-field", path: project.projectFile });
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
		sessions.surfaceActivity({
			kind: "dashboard-field",
			path: "Somewhere Else/Novel/001_Project_Metadata.md",
		});
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
});
