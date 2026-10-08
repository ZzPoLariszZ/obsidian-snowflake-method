import { describe, expect, it, vi } from "vitest";

import { ExplorerCountService } from "../../src/services";
import { FakeFiles } from "../helpers/explorer-fake";

function service(files: FakeFiles, totals: Record<string, number | null>, pluginMade: string[] = []) {
	const countNote = vi.fn(async (path: string) => totals[path] ?? null);
	const counted = vi.fn();
	const breathe = vi.fn(async () => undefined);
	const counts = new ExplorerCountService({
		countNote,
		fileAt: (path) => files.get(path),
		pluginMade: (path) => pluginMade.includes(path),
		counted,
		breathe,
	});
	const landed: [string, number | null][] = [];
	const ask = (paths: string[]): Promise<void> => {
		counts.request(paths, (path, total) => landed.push([path, total]));
		return new Promise((resolve) => setTimeout(resolve, 0));
	};
	return { counts, countNote, counted, breathe, landed, ask };
}

describe("ExplorerCountService", () => {
	it("counts a note once per stat and tells the asker", async () => {
		const files = new FakeFiles();
		const note = files.file({ path: "Novel/a.md", mtime: 1, size: 5 });
		const { counts, countNote, counted, landed, ask } = service(files, { "Novel/a.md": 42 });
		expect(counts.noteTotal("Novel/a.md")).toBeUndefined();
		await ask(["Novel/a.md"]);
		expect(landed).toEqual([["Novel/a.md", 42]]);
		expect(counts.noteTotal("Novel/a.md")).toBe(42);
		expect(counted).toHaveBeenCalledWith("Novel/a.md");
		await ask(["Novel/a.md"]);
		expect(countNote).toHaveBeenCalledTimes(1);
		files.touch(note, 2);
		expect(counts.noteTotal("Novel/a.md")).toBeUndefined();
		await ask(["Novel/a.md"]);
		expect(countNote).toHaveBeenCalledTimes(2);
	});

	it("sums a folder from the notes beneath it, the plugin's own and unreadable ones left out", async () => {
		const files = new FakeFiles();
		files.file("Novel/a.md");
		files.file("Novel/Deep/b.md");
		files.file("Novel/Deep/broken.md");
		files.file("Novel/00_System/template.md");
		files.file("Novel/map.png");
		const { counts, landed, ask } = service(
			files,
			{ "Novel/a.md": 10, "Novel/Deep/b.md": 5, "Novel/Deep/broken.md": null, "Novel/00_System/template.md": 99, "Novel/map.png": 7 },
			["Novel/00_System/template.md"],
		);
		await ask(["Novel"]);
		expect(landed).toEqual([["Novel", 15]]);
		expect(counts.folderTotal("Novel")).toBe(15);
		expect(counts.folderTotal("Novel/Deep")).toBe(5);
		expect(counts.folderTotal("Novel/00_System")).toBe(0);
		expect(counts.noteTotal("Novel/Deep/broken.md")).toBeNull();
	});

	it("lets the folder sums above a change go, and nothing beside them", async () => {
		const files = new FakeFiles();
		files.file("Novel/a.md");
		files.file("Novel/Deep/b.md");
		files.file("Other/c.md");
		const { counts, ask } = service(files, { "Novel/a.md": 1, "Novel/Deep/b.md": 2, "Other/c.md": 3 });
		await ask(["Novel", "Other"]);
		expect(counts.folderTotal("Novel")).toBe(3);
		counts.invalidate("Novel/Deep/b.md");
		expect(counts.folderTotal("Novel/Deep")).toBeUndefined();
		expect(counts.folderTotal("Novel")).toBeUndefined();
		expect(counts.folderTotal("/")).toBeUndefined();
		expect(counts.folderTotal("Other")).toBe(3);
		expect(counts.noteTotal("Novel/Deep/b.md")).toBeUndefined();
		expect(counts.noteTotal("Novel/a.md")).toBe(1);
		counts.invalidate("Other", { children: true });
		expect(counts.noteTotal("Other/c.md")).toBeUndefined();
	});

	it("serves the first path asked for first, and drops what a cleared rule was still counting", async () => {
		const files = new FakeFiles();
		files.file("a.md");
		files.file("b.md");
		const { counts, countNote, landed, ask } = service(files, { "a.md": 1, "b.md": 2 });
		await ask(["a.md", "b.md"]);
		expect(landed.map(([path]) => path)).toEqual(["a.md", "b.md"]);
		landed.length = 0;
		counts.request(["a.md"], (path, total) => landed.push([path, total]));
		counts.clear();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(landed).toEqual([]);
		expect(countNote).toHaveBeenCalledTimes(2);
	});

	it("breathes through a long folder", async () => {
		const files = new FakeFiles();
		const totals: Record<string, number> = {};
		for (let at = 0; at < 40; at++) {
			files.file(`Big/${at}.md`);
			totals[`Big/${at}.md`] = 1;
		}
		const slow = { now: 0 };
		const spy = vi.spyOn(Date, "now").mockImplementation(() => (slow.now += 5));
		try {
			const { counts, breathe, ask } = service(files, totals);
			await ask(["Big"]);
			expect(counts.folderTotal("Big")).toBe(40);
			expect(breathe).toHaveBeenCalled();
		} finally {
			spy.mockRestore();
		}
	});
});
