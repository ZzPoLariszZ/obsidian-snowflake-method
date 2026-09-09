import { describe, expect, it } from "vitest";

import { ConcurrentChangeError, UnsafeSectionError } from "../../src/repository";
import { SnowflakeProjectService } from "../../src/services";
import { readMarkedSection } from "../../src/templates";
import { createFakeEnvironment } from "../helpers/fake-vault";

type Kind = "character" | "scene" | "location";

async function fixture(kind: Kind) {
  const env = createFakeEnvironment();
  const service = new SnowflakeProjectService(env.vault, env.fileManager, env.metadataCache);
  const project = await service.createProject({ name: "Section safety", locale: "en" });
  const created = kind === "character"
    ? await service.createCharacter(project, {
      name: "Ada", oneParagraphStoryline: "The original storyline.",
      characterSynopsis: "The original synopsis.", characterProfile: "The original profile.",
    })
    : kind === "scene"
      ? await service.createScene(project, { title: "Arrival", events: "The original events." })
      : await service.createEntity(project, { kind, name: "Town", notes: "The original notes." });
  const read = async () => {
    const snapshot = await service.loadProject(project);
    return kind === "character" ? snapshot.characters[0]!
      : kind === "scene" ? snapshot.scenes[0]! : snapshot.worldbuilding.location![0]!;
  };
  const update = (expectedRevision: string) => {
    const patch = { expectedRevision, progressStatus: "complete" as const, categoryPaths: ["New category"] };
    return kind === "character" ? service.updateCharacter(project, created.id, patch)
      : kind === "scene" ? service.updateScene(project, created.id, patch)
        : service.updateEntity(project, created.id, patch);
  };
  return { ...env, service, project, created, read, update };
}

function withoutMarkerPair(content: string, section: string): string {
  return content.replace(`<!-- snowflake:section:${section}:start -->`, "")
    .replace(`<!-- snowflake:section:${section}:end -->`, "");
}

describe("member form section safety", () => {
  it.each([
    ["character", "one-paragraph-storyline"],
    ["character", "character-synopsis"],
    ["character", "character-profile"],
    ["scene", "scene-events"],
    ["scene", "scene-planning"],
    ["location", "entity-fields"],
    ["location", "entity-notes"],
  ] as const)("refuses a %s edit with both %s markers missing before any writes", async (kind, section) => {
    const f = await fixture(kind);
    const damaged = withoutMarkerPair(f.fakeVault.contents.get(f.created.path)!, section);
    f.fakeVault.write(f.created.path, damaged);
    const member = await f.read();
    expect(member.sectionHealth.issues).toContainEqual(expect.objectContaining({ sectionId: section, code: "missing" }));
    const before = [...f.fakeVault.contents];
    const processes = [...f.fakeVault.processCalls];
    const frontmatterWrites = [...f.fakeFileManager.frontmatterCalls];

    await expect(f.update(member.revision)).rejects.toBeInstanceOf(UnsafeSectionError);

    expect([...f.fakeVault.contents]).toEqual(before);
    expect(f.fakeVault.processCalls).toEqual(processes);
    expect(f.fakeFileManager.frontmatterCalls).toEqual(frontmatterWrites);
  });

  it.each([
    ["character", "character-fields"],
    ["scene", "scene-fields"],
  ] as const)("still inserts the optional legacy %s fields block", async (kind, section) => {
    const f = await fixture(kind);
    const original = f.fakeVault.contents.get(f.created.path)!;
    const start = original.indexOf(`<!-- snowflake:section:${section}:start -->`);
    const endMarker = `<!-- snowflake:section:${section}:end -->`;
    const end = original.indexOf(endMarker) + endMarker.length;
    f.fakeVault.write(f.created.path, original.slice(0, start) + original.slice(end));
    const member = await f.read();
    expect(member.sectionHealth.issues).not.toContainEqual(expect.objectContaining({ sectionId: section, code: "missing" }));

    const updated = await f.update(member.revision);

    expect(updated.progressStatus).toBe("complete");
    expect(readMarkedSection(f.fakeVault.contents.get(f.created.path)!, section)).not.toBeNull();
  });

  it.each([
    ["character", "character-synopsis"],
    ["scene", "scene-events"],
    ["location", "entity-notes"],
  ] as const)("refuses %s damage arriving after the model read and before its atomic write", async (kind, section) => {
    const f = await fixture(kind);
    const member = await f.read();
    const damaged = withoutMarkerPair(f.fakeVault.contents.get(f.created.path)!, section);
    const process = f.fakeVault.process.bind(f.fakeVault);
    f.fakeVault.process = async (file, callback) => {
      if (file.path === f.created.path) f.fakeVault.write(file.path, damaged);
      return process(file, callback);
    };
    const frontmatterWrites = [...f.fakeFileManager.frontmatterCalls];

    await expect(f.update(member.revision)).rejects.toBeInstanceOf(ConcurrentChangeError);

    expect(f.fakeVault.contents.get(f.created.path)).toBe(damaged);
    // Definition creation may precede the race, but the member's structured
    // fields must not land after its section/revision check refuses the write.
    expect(f.fakeFileManager.frontmatterCalls.filter((path) => path === f.created.path))
      .toEqual(frontmatterWrites.filter((path) => path === f.created.path));
  });
});
