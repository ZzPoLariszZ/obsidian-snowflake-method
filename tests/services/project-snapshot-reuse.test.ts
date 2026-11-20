import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FRONTMATTER_KEYS,
  SnowflakeProjectService,
  type ProjectSnapshot,
} from "../../src/services";
import {
  createFakeEnvironment,
  type FakeMetadataCache,
  type FakeVault,
} from "../helpers/fake-vault";

/**
 * What a project load keeps between two askings, and what makes it read
 * again. The digest of a project's tree used to be walked at every load. It
 * is now kept while the vault announces no change, and a reading under way
 * is shared by whoever asks for the same tree meanwhile. Neither may ever
 * hand back a project the vault no longer holds, which is what these hold
 * the service to.
 */

type Internals = {
  buildSnapshot: (...args: unknown[]) => Promise<ProjectSnapshot>;
  calculateProjectFingerprints: (...args: unknown[]) => Promise<unknown>;
};

/** A note's properties as its file holds them. */
function frontmatterOf(vault: FakeVault, path: string): Record<string, unknown> {
  const raw = vault.contents.get(path) ?? "";
  const parts = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(raw);
  if (parts === null) throw new Error(`No frontmatter in ${path}`);
  return JSON.parse(parts[1] ?? "{}") as Record<string, unknown>;
}

/** Rewrites one frontmatter key of a note the way an edit from outside would. */
function setFrontmatter(vault: FakeVault, path: string, key: string, value: unknown): void {
  const raw = vault.contents.get(path) ?? "";
  const parts = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(raw);
  if (parts === null) throw new Error(`No frontmatter in ${path}`);
  const frontmatter = JSON.parse(parts[1] ?? "{}") as Record<string, unknown>;
  frontmatter[key] = value;
  vault.write(path, `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n${parts[2] ?? ""}`);
}

describe("a project's snapshot between two loads", () => {
  let fakeVault: FakeVault;
  let fakeMetadataCache: FakeMetadataCache;
  let service: SnowflakeProjectService;
  let fresh: () => SnowflakeProjectService;
  let projectFile: string;
  let rootPath: string;

  beforeEach(async () => {
    const environment = createFakeEnvironment();
    fakeVault = environment.fakeVault;
    fakeMetadataCache = environment.fakeMetadataCache;
    const make = (): SnowflakeProjectService =>
      new SnowflakeProjectService(
        environment.vault,
        environment.fileManager,
        environment.metadataCache,
      );
    service = make();
    fresh = make;
    const project = await service.createProject({ title: "Winter", locale: "en" });
    projectFile = project.projectFile;
    rootPath = project.rootPath;
    await service.createCharacter(projectFile, "Ada");
    await service.createScene(projectFile, { title: "Opening" });
  });

  it("walks the tree at every load while nobody listens to the vault", async () => {
    expect(service.repository.treeVersion).toBeNull();
    await service.loadProject(projectFile);
    const walks = vi.spyOn(service.repository, "visitBelow");
    await service.loadProject(projectFile);
    await service.loadProject(projectFile);
    expect(walks).toHaveBeenCalledTimes(2);
  });

  it("keeps the digest, and the snapshot, while the vault announces no change", async () => {
    const stop = service.repository.watch();
    expect(service.repository.treeVersion).toBe(0);
    const first = await service.loadProject(projectFile);
    const walks = vi.spyOn(service.repository, "visitBelow");
    const builds = vi.spyOn(service as unknown as Internals, "buildSnapshot");
    expect(await service.loadProject(projectFile)).toBe(first);
    expect(await service.loadProject(projectFile)).toBe(first);
    expect(walks).not.toHaveBeenCalled();
    expect(builds).not.toHaveBeenCalled();
    stop();
  });

  it("counts every kind of change the vault announces", async () => {
    const stop = service.repository.watch();
    const at = (): number => service.repository.treeVersion ?? -1;
    let before = at();
    fakeVault.write(projectFile, `${fakeVault.contents.get(projectFile) ?? ""}\n`);
    expect(at()).toBeGreaterThan(before);
    before = at();
    await fakeVault.createFolder(`${rootPath}/Aside`);
    expect(at()).toBeGreaterThan(before);
    before = at();
    await fakeVault.create(`${rootPath}/Aside/Note.md`, "words");
    expect(at()).toBeGreaterThan(before);
    before = at();
    fakeVault.rename(`${rootPath}/Aside/Note.md`, `${rootPath}/Aside/Other.md`);
    expect(at()).toBeGreaterThan(before);
    before = at();
    fakeVault.delete(`${rootPath}/Aside`);
    expect(at()).toBeGreaterThan(before);
    stop();
  });

  it("serves what a fresh reading would after each kind of change, with the count kept", async () => {
    const stop = service.repository.watch();
    const character = (await service.loadProject(projectFile)).characters[0];
    const scene = (await service.loadProject(projectFile)).scenes[0];
    if (character === undefined || scene === undefined) throw new Error("fixture");
    const changes: Array<[string, () => void | Promise<unknown>]> = [
      ["a note written from outside", () => setFrontmatter(fakeVault, character.path, FRONTMATTER_KEYS.characterName, "Ada Byron")],
      ["a note written to the same length", () => setFrontmatter(fakeVault, character.path, FRONTMATTER_KEYS.characterName, "Eve Byron")],
      ["the metadata note written", () => setFrontmatter(fakeVault, projectFile, FRONTMATTER_KEYS.projectName, "Spring")],
      ["a folder made", () => fakeVault.createFolder(`${rootPath}/80_Material/Loose`)],
      ["a note made", () => fakeVault.create(`${rootPath}/80_Material/Loose/Thought.md`, "a thought")],
      ["a note renamed", () => fakeVault.rename(scene.path, scene.path.replace(/[^/]+\.md$/u, "Renamed Scene.md"))],
      ["a note deleted", () => fakeVault.delete(character.path)],
      ["a folder deleted", () => fakeVault.delete(`${rootPath}/80_Material/Loose`)],
    ];
    let last = await service.loadProject(projectFile);
    for (const [what, change] of changes) {
      await change();
      const kept = await service.loadProject(projectFile);
      const anew = await fresh().loadProject(projectFile);
      expect(kept, what).toEqual(anew);
      expect(kept, what).not.toBe(last);
      // And the reading is kept again once the vault is still.
      expect(await service.loadProject(projectFile), what).toBe(kept);
      last = kept;
    }
    stop();
  });

  it("forgets the count when the listening stops, and lets every listener go", async () => {
    const stop = service.repository.watch();
    expect(fakeVault.listenerCount()).toBe(4);
    await service.loadProject(projectFile);
    stop();
    expect(fakeVault.listenerCount()).toBe(0);
    expect(service.repository.treeVersion).toBeNull();
    const walks = vi.spyOn(service.repository, "visitBelow");
    await service.loadProject(projectFile);
    expect(walks).toHaveBeenCalledTimes(1);
    // A change made while nobody listened is found by the walk, as before.
    fakeVault.write(projectFile, `${fakeVault.contents.get(projectFile) ?? ""}\n`);
    const kept = await service.loadProject(projectFile);
    expect(kept).toEqual(await fresh().loadProject(projectFile));
  });

  it("shares one reading between two loads asked for at once", async () => {
    service.forgetSnapshots();
    const builds = vi.spyOn(service as unknown as Internals, "buildSnapshot");
    const [one, other] = await Promise.all([
      service.loadProject(projectFile),
      service.loadProject(projectFile),
    ]);
    expect(builds).toHaveBeenCalledTimes(1);
    expect(other).toBe(one);
    // Asked by the folder or by the snapshot itself, it is the same tree.
    service.forgetSnapshots();
    builds.mockClear();
    const [byFile, byRoot, bySnapshot] = await Promise.all([
      service.loadProject(projectFile),
      service.loadProject(rootPath),
      service.loadProject(one),
    ]);
    expect(builds).toHaveBeenCalledTimes(1);
    expect(byRoot).toBe(byFile);
    expect(bySnapshot).toBe(byFile);
  });

  it("gives a load asked for after a write a reading of its own", async () => {
    const stop = service.repository.watch();
    service.forgetSnapshots();
    const internals = service as unknown as Internals;
    const builds = vi.spyOn(internals, "buildSnapshot");
    // The first reading is held partway, as a read from the disk would hold it.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reading = internals.calculateProjectFingerprints.bind(service);
    vi.spyOn(internals, "calculateProjectFingerprints").mockImplementationOnce(
      async (...args: unknown[]) => {
        await held;
        return reading(...args);
      },
    );
    const before = service.loadProject(projectFile);
    for (let turn = 0; turn < 20 && builds.mock.calls.length === 0; turn += 1) {
      await Promise.resolve();
    }
    expect(builds).toHaveBeenCalledTimes(1);
    setFrontmatter(fakeVault, projectFile, FRONTMATTER_KEYS.projectName, "Thaw");
    const after = service.loadProject(projectFile);
    const late = await after;
    expect(builds).toHaveBeenCalledTimes(2);
    expect(late.title).toBe("Thaw");
    release();
    const early = await before;
    expect(early).not.toBe(late);
    // What stands afterwards is the later reading: the one the write
    // overtook was handed to whoever asked for it and kept by nobody.
    expect(await service.loadProject(projectFile)).toBe(late);
    expect(builds).toHaveBeenCalledTimes(2);
    stop();
  });

  it("never puts the note as it stood under the tree as it stands", async () => {
    // The metadata note comes back from memory in the turn the load is asked
    // for, and the tree's digest is taken a turn later: a write between the
    // two must not leave the old title kept under the new digest.
    const stop = service.repository.watch();
    await service.loadProject(projectFile);
    const before = service.loadProject(projectFile);
    setFrontmatter(fakeVault, projectFile, FRONTMATTER_KEYS.projectName, "Thaw");
    const after = service.loadProject(projectFile);
    const [early, late] = await Promise.all([before, after]);
    expect(early.title).toBe("Thaw");
    expect(late.title).toBe("Thaw");
    expect((await service.loadProject(projectFile)).title).toBe("Thaw");
    expect(await service.loadProject(projectFile)).toEqual(await fresh().loadProject(projectFile));
    stop();
  });

  /**
   * A second chapter written into the first one's place by hand, with the
   * app's index still serving what it read before: the file has moved on,
   * the index has not. What the index says of a chapter's place is what the
   * health report's manuscript findings are read from.
   */
  async function writeBehindTheIndex(): Promise<string> {
    const two = await service.manuscript.appendSegment(await service.loadProject(projectFile), "Two");
    await service.loadProject(projectFile);
    fakeMetadataCache.behind.set(two, frontmatterOf(fakeVault, two));
    setFrontmatter(fakeVault, two, FRONTMATTER_KEYS.manuscriptSequence, 1024);
    return two;
  }

  const codes = (snapshot: ProjectSnapshot): string[] =>
    snapshot.structureIssues.map((issue) => issue.code);
  const DUPLICATE = "duplicate-manuscript-sequence";

  it("reads again once the index has caught up with a write, and keeps that reading", async () => {
    const stop = service.repository.watch();
    const two = await writeBehindTheIndex();
    // Read in the beat before the index catches up: the note's place is the old one.
    const early = await service.loadProject(projectFile);
    expect(codes(early)).not.toContain(DUPLICATE);

    // The index reads the note again and says so.
    fakeMetadataCache.behind.delete(two);
    service.indexMoved(two);
    const late = await service.loadProject(projectFile);
    expect(late).not.toBe(early);
    expect(codes(late)).toContain(DUPLICATE);
    expect(late).toEqual(await fresh().loadProject(projectFile));
    // Kept from here on, while the tree and the index both stand still.
    expect(await service.loadProject(projectFile)).toBe(late);
    // A note elsewhere in the vault read again is no change to this project.
    service.indexMoved("Elsewhere/Loose.md");
    expect(await service.loadProject(projectFile)).toBe(late);
    stop();
  });

  it("gives a load asked for after the index caught up a reading of its own", async () => {
    const stop = service.repository.watch();
    const two = await writeBehindTheIndex();
    const internals = service as unknown as Internals;
    const builds = vi.spyOn(internals, "buildSnapshot");
    // The first reading is held after it has asked the index, as the disk
    // read that follows in a build holds it.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let asked = false;
    const reading = internals.calculateProjectFingerprints.bind(service);
    vi.spyOn(internals, "calculateProjectFingerprints").mockImplementationOnce(
      async (...args: unknown[]) => {
        const result = await reading(...args);
        asked = true;
        await held;
        return result;
      },
    );
    const before = service.loadProject(projectFile);
    for (let turn = 0; turn < 2000 && !asked; turn += 1) await Promise.resolve();
    expect(asked).toBe(true);

    // The index catches up while that reading is still out.
    fakeMetadataCache.behind.delete(two);
    service.indexMoved(two);
    const late = await service.loadProject(projectFile);
    // Not handed the reading under way, which holds the note as it was.
    expect(builds).toHaveBeenCalledTimes(2);
    expect(codes(late)).toContain(DUPLICATE);

    release();
    const early = await before;
    expect(early).not.toBe(late);
    // What stands afterwards is the later reading.
    expect(await service.loadProject(projectFile)).toBe(late);
    stop();
  });

  it("hands a failed reading to everyone who joined it, and reads again for the next", async () => {
    service.forgetSnapshots();
    const failure = new Error("the disk said no");
    const builds = vi
      .spyOn(service as unknown as Internals, "buildSnapshot")
      .mockRejectedValueOnce(failure);
    const results = await Promise.allSettled([
      service.loadProject(projectFile),
      service.loadProject(projectFile),
    ]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(builds).toHaveBeenCalledTimes(1);
    const next = await service.loadProject(projectFile);
    expect(next.title).toBe("Winter");
    expect(builds).toHaveBeenCalledTimes(2);
  });
});
