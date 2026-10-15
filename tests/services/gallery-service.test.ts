import { beforeEach, describe, expect, it } from "vitest";

import { FRONTMATTER_KEYS, type GalleryDraft } from "../../src/domain";
import { parseMarkdownFrontmatter } from "../../src/repository";
import { SnowflakeProjectService, galleryFolderPath } from "../../src/services";
import {
  createFakeEnvironment,
  type FakeFileManager,
  type FakeMetadataCache,
  type FakeVault,
} from "../helpers/fake-vault";

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;
const data = (name: string, text = name): { kind: "data"; name: string; read: () => Promise<ArrayBuffer> } => ({
  kind: "data",
  name,
  read: () => Promise.resolve(bytes(text)),
});
const link = (path: string): string => `[[${path}]]`;

describe("GalleryService", () => {
  let fakeVault: FakeVault;
  let fakeFileManager: FakeFileManager;
  let fakeMetadataCache: FakeMetadataCache;
  let service: SnowflakeProjectService;

  const stored = (path: string): Record<string, unknown> =>
    parseMarkdownFrontmatter(fakeVault.contents.get(path) ?? "").frontmatter;

  beforeEach(() => {
    const environment = createFakeEnvironment();
    fakeVault = environment.fakeVault;
    fakeFileManager = environment.fakeFileManager;
    fakeMetadataCache = environment.fakeMetadataCache;
    service = new SnowflakeProjectService(environment.vault, environment.fileManager, environment.metadataCache);
  });

  it("names the gallery folder after the kind's folder in both languages", async () => {
    const english = await service.createProject({ name: "Pictures" });
    expect(galleryFolderPath(english, "character")).toBe(`${english.rootPath}/20_Character/25_Gallery`);
    expect(galleryFolderPath(english, "scene")).toBe(`${english.rootPath}/40_Scene/45_Gallery`);
    expect(galleryFolderPath(english, "location")).toBe(`${english.rootPath}/60_Worldbuilding/62_Location/625_Gallery`);
    expect(service.gallery.folderPaths(english)).toEqual([
      `${english.rootPath}/20_Character/25_Gallery`,
      `${english.rootPath}/40_Scene/45_Gallery`,
      `${english.rootPath}/60_Worldbuilding/61_Time/615_Gallery`,
      `${english.rootPath}/60_Worldbuilding/62_Location/625_Gallery`,
      `${english.rootPath}/60_Worldbuilding/63_Item/635_Gallery`,
    ]);
    const chinese = await service.createProject({ name: "图片", locale: "zh-CN" });
    expect(galleryFolderPath(chinese, "character")).toBe(`${chinese.rootPath}/20_角色/25_图库`);
    expect(galleryFolderPath(chinese, "item")).toBe(`${chinese.rootPath}/60_世界观/63_物品/635_图库`);
  });

  it("lands device files under their own names, the folder made on the first, a namesake numbered", async () => {
    const project = await service.createProject({ name: "Landing" });
    const folder = galleryFolderPath(project, "character");
    expect(fakeVault.getAbstractFileByPath(folder)).toBeNull();
    const landed = await service.gallery.addPictures(project, "character", [
      data("portrait.png", "first"),
      data("portrait.png", "second"),
      data("b: c?.jpg", "third"),
    ]);
    expect(landed).toEqual([
      { link: link(`${folder}/portrait.png`), path: `${folder}/portrait.png`, created: true },
      { link: link(`${folder}/portrait (2).png`), path: `${folder}/portrait (2).png`, created: true },
      { link: link(`${folder}/b- c-.jpg`), path: `${folder}/b- c-.jpg`, created: true },
    ]);
    expect(fakeVault.getAbstractFileByPath(folder)).not.toBeNull();
    expect(new TextDecoder().decode(fakeVault.binaryContents.get(`${folder}/portrait (2).png`))).toBe("second");
  });

  it("copies a vault picture from elsewhere and links one already in the folder where it is", async () => {
    const project = await service.createProject({ name: "Vault picks" });
    const folder = galleryFolderPath(project, "scene");
    await fakeVault.ensureFolders(`${project.rootPath}/80_Material`);
    await fakeVault.createBinary(`${project.rootPath}/80_Material/map.png`, bytes("map"));
    await fakeVault.ensureFolders(folder);
    await fakeVault.createBinary(`${folder}/shared.png`, bytes("shared"));
    const landed = await service.gallery.addPictures(project, "scene", [
      { kind: "vault", path: `${project.rootPath}/80_Material/map.png` },
      { kind: "vault", path: `${folder}/shared.png` },
    ]);
    expect(landed).toEqual([
      { link: link(`${folder}/map.png`), path: `${folder}/map.png`, created: true },
      { link: link(`${folder}/shared.png`), path: `${folder}/shared.png`, created: false },
    ]);
    // The original stays where the author keeps it; the copy carries its bytes.
    expect(fakeVault.getFileByPath(`${project.rootPath}/80_Material/map.png`)).not.toBeNull();
    expect(new TextDecoder().decode(fakeVault.binaryContents.get(`${folder}/map.png`))).toBe("map");
    expect(fakeVault.createBinaryCalls).toEqual([
      `${project.rootPath}/80_Material/map.png`,
      `${folder}/shared.png`,
      `${folder}/map.png`,
    ]);
  });

  it("takes back what it landed when a later picture is refused, and when the note write is", async () => {
    const project = await service.createProject({ name: "Refusals" });
    const folder = galleryFolderPath(project, "character");
    fakeVault.failNextCreateBinaryPath = `${folder}/second.png`;
    await expect(
      service.gallery.addPictures(project, "character", [data("first.png"), data("second.png")]),
    ).rejects.toThrow(/Simulated binary create failure/u);
    expect(fakeFileManager.trashCalls).toEqual([`${folder}/first.png`]);
    expect(fakeVault.getFileByPath(`${folder}/first.png`)).toBeNull();

    fakeFileManager.trashCalls.length = 0;
    const draft: GalleryDraft = { entries: [data("third.png")], removed: [], mainIndex: 0 };
    await expect(
      service.gallery.commit(project, "character", draft, () => Promise.reject(new Error("note refused")), () => ""),
    ).rejects.toThrow("note refused");
    expect(fakeFileManager.trashCalls).toEqual([`${folder}/third.png`]);
    expect(fakeVault.getFileByPath(`${folder}/third.png`)).toBeNull();
  });

  it("writes a note's gallery around its own write and tidies what the draft took off", async () => {
    const project = await service.createProject({ name: "Commit" });
    const folder = galleryFolderPath(project, "character");
    const draft: GalleryDraft = {
      entries: [data("one.png"), data("two.png")],
      removed: [],
      mainIndex: 1,
    };
    const { result: created } = await service.gallery.commit(
      project,
      "character",
      draft,
      (gallery) => service.createCharacter(project, { name: "Pictured", ...gallery }),
      (character) => character.path,
    );
    expect(created.gallery).toEqual([link(`${folder}/one.png`), link(`${folder}/two.png`)]);
    expect(created.galleryMain).toBe(link(`${folder}/two.png`));
    expect(stored(created.path)[FRONTMATTER_KEYS.gallery]).toEqual(created.gallery);
    expect(stored(created.path)[FRONTMATTER_KEYS.galleryMain]).toBe(created.galleryMain);
    const keys = Object.keys(stored(created.path));
    expect(keys.indexOf(FRONTMATTER_KEYS.gallery)).toBeGreaterThan(keys.indexOf(FRONTMATTER_KEYS.progressStatus));
    expect(keys.indexOf(FRONTMATTER_KEYS.galleryMain)).toBe(keys.indexOf(FRONTMATTER_KEYS.gallery) + 1);

    // The second picture leaves the gallery; the main goes with it, the file to the trash.
    const edit: GalleryDraft = {
      entries: [{ kind: "kept", link: link(`${folder}/one.png`) }],
      removed: [link(`${folder}/two.png`)],
      mainIndex: null,
    };
    const { result: updated, trashFailed } = await service.gallery.commit(
      project,
      "character",
      edit,
      (gallery) => service.updateCharacter(project.projectFile, created.characterId, {
        expectedRevision: created.revision,
        ...gallery,
      }),
      (character) => character.path,
    );
    expect(trashFailed).toEqual([]);
    expect(updated.gallery).toEqual([link(`${folder}/one.png`)]);
    expect(updated.galleryMain).toBeNull();
    expect(fakeFileManager.trashCalls).toEqual([`${folder}/two.png`]);
    expect(stored(updated.path)[FRONTMATTER_KEYS.galleryMain]).toBeUndefined();

    // A form that offered no gallery writes with nothing and touches no file.
    const untouched = await service.gallery.commit(
      project,
      "character",
      undefined,
      (gallery) => service.updateCharacter(project.projectFile, created.characterId, {
        expectedRevision: updated.revision,
        motivation: "To be seen",
        ...gallery,
      }),
      (character) => character.path,
    );
    expect(untouched.result.gallery).toEqual([link(`${folder}/one.png`)]);
    expect(fakeFileManager.trashCalls).toHaveLength(1);
  });

  it("keeps a removed picture another note still names, one outside the gallery folders, and one picked again", async () => {
    const project = await service.createProject({ name: "Orphans" });
    const folder = galleryFolderPath(project, "character");
    const shared = await service.gallery.addPictures(project, "character", [data("shared.png"), data("alone.png")]);
    const [sharedLink, aloneLink] = shared.map((entry) => entry.link) as [string, string];
    const first = await service.createCharacter(project, { name: "First", gallery: [sharedLink, aloneLink] });
    const second = await service.createCharacter(project, { name: "Second", gallery: [sharedLink] });
    await fakeVault.ensureFolders(`${project.rootPath}/80_Material`);
    await fakeVault.createBinary(`${project.rootPath}/80_Material/outside.png`, bytes("outside"));
    const outside = link(`${project.rootPath}/80_Material/outside.png`);

    const answer = await service.gallery.trashOrphans(
      project,
      [sharedLink, aloneLink, outside, "[[Nowhere/gone.png]]", "not a link"],
      first.path,
      [first.path],
    );
    expect(answer).toEqual({ trashed: [`${folder}/alone.png`], failed: [] });
    expect(fakeVault.getFileByPath(`${folder}/shared.png`)).not.toBeNull();
    expect(fakeVault.getFileByPath(`${project.rootPath}/80_Material/outside.png`)).not.toBeNull();
    expect(second.gallery).toEqual([sharedLink]);

    // Taken off and picked again in one form: still the note's, so still standing.
    const again: GalleryDraft = {
      entries: [{ kind: "vault", path: `${folder}/shared.png` }],
      removed: [sharedLink],
      mainIndex: 0,
    };
    fakeFileManager.trashCalls.length = 0;
    const { result } = await service.gallery.commit(
      project,
      "character",
      again,
      (gallery) => service.updateCharacter(project.projectFile, second.characterId, {
        expectedRevision: second.revision,
        ...gallery,
      }),
      (character) => character.path,
    );
    expect(result.gallery).toEqual([sharedLink]);
    expect(fakeFileManager.trashCalls).toEqual([]);
    expect(fakeMetadataCache.resolvedLinks[result.path]?.[`${folder}/shared.png`]).toBe(2);
  });

  it("gives a namesake the name of a picture the same save takes off, once that one is in the trash", async () => {
    const project = await service.createProject({ name: "Namesakes" });
    const folder = galleryFolderPath(project, "character");
    const { result: created } = await service.gallery.commit(
      project,
      "character",
      { entries: [data("face.png", "old")], removed: [], mainIndex: 0 },
      (gallery) => service.createCharacter(project, { name: "Pictured", ...gallery }),
      (character) => character.path,
    );
    expect(created.gallery).toEqual([link(`${folder}/face.png`)]);

    // Taken off and a namesake picked from the device in one save: the note
    // names face.png, the new bytes stand under it, the old are in the trash.
    fakeFileManager.trashCalls.length = 0;
    fakeFileManager.renameCalls.length = 0;
    const swap: GalleryDraft = { entries: [data("face.png", "new")], removed: [link(`${folder}/face.png`)], mainIndex: 0 };
    const { result: updated, trashFailed } = await service.gallery.commit(
      project,
      "character",
      swap,
      (gallery) => service.updateCharacter(project.projectFile, created.characterId, {
        expectedRevision: created.revision,
        ...gallery,
      }),
      (character) => character.path,
      created.path,
    );
    expect(trashFailed).toEqual([]);
    expect(updated.gallery).toEqual([link(`${folder}/face.png`)]);
    expect(updated.galleryMain).toBe(link(`${folder}/face.png`));
    expect(stored(updated.path)[FRONTMATTER_KEYS.gallery]).toEqual([link(`${folder}/face.png`)]);
    expect(fakeFileManager.trashCalls).toEqual([`${folder}/face.png`]);
    expect(fakeFileManager.renameCalls).toEqual([{ from: `${folder}/face (2).png`, to: `${folder}/face.png` }]);
    expect(fakeVault.getFileByPath(`${folder}/face (2).png`)).toBeNull();
    expect(new TextDecoder().decode(fakeVault.binaryContents.get(`${folder}/face.png`))).toBe("new");

    // Named by another note as well, the leaving picture stays, so the next namesake is numbered as before.
    const other = await service.createCharacter(project, { name: "Other", gallery: [link(`${folder}/face.png`)] });
    fakeFileManager.trashCalls.length = 0;
    fakeFileManager.renameCalls.length = 0;
    const shared: GalleryDraft = { entries: [data("face.png", "third")], removed: [link(`${folder}/face.png`)], mainIndex: 0 };
    const { result: numbered } = await service.gallery.commit(
      project,
      "character",
      shared,
      (gallery) => service.updateCharacter(project.projectFile, created.characterId, {
        expectedRevision: updated.revision,
        ...gallery,
      }),
      (character) => character.path,
      created.path,
    );
    expect(numbered.gallery).toEqual([link(`${folder}/face (2).png`)]);
    expect(fakeFileManager.trashCalls).toEqual([]);
    expect(fakeFileManager.renameCalls).toEqual([]);
    expect(other.gallery).toEqual([link(`${folder}/face.png`)]);
    expect(new TextDecoder().decode(fakeVault.binaryContents.get(`${folder}/face.png`))).toBe("new");
  });

  it("hands a freed name to the first namesake only, and a refused write moves nothing", async () => {
    const project = await service.createProject({ name: "Two namesakes" });
    const folder = galleryFolderPath(project, "character");
    const { result: created } = await service.gallery.commit(
      project,
      "character",
      { entries: [data("face.png", "old")], removed: [], mainIndex: null },
      (gallery) => service.createCharacter(project, { name: "Pictured", ...gallery }),
      (character) => character.path,
    );
    const pair: GalleryDraft = {
      entries: [data("face.png", "one"), data("face.png", "two")],
      removed: [link(`${folder}/face.png`)],
      mainIndex: null,
    };
    const { result } = await service.gallery.commit(
      project,
      "character",
      pair,
      (gallery) => service.updateCharacter(project.projectFile, created.characterId, {
        expectedRevision: created.revision,
        ...gallery,
      }),
      (character) => character.path,
      created.path,
    );
    expect(result.gallery).toEqual([link(`${folder}/face.png`), link(`${folder}/face (3).png`)]);
    expect(new TextDecoder().decode(fakeVault.binaryContents.get(`${folder}/face.png`))).toBe("one");
    expect(new TextDecoder().decode(fakeVault.binaryContents.get(`${folder}/face (3).png`))).toBe("two");
    expect(fakeVault.getFileByPath(`${folder}/face (2).png`)).toBeNull();

    // A write the note refuses leaves the leaving picture where it stands and the namesake nowhere.
    const refused: GalleryDraft = { entries: [data("face.png", "late")], removed: [link(`${folder}/face.png`)], mainIndex: null };
    await expect(
      service.gallery.commit(project, "character", refused, () => Promise.reject(new Error("note refused")), () => "", created.path),
    ).rejects.toThrow("note refused");
    expect(new TextDecoder().decode(fakeVault.binaryContents.get(`${folder}/face.png`))).toBe("one");
    expect(fakeVault.getFileByPath(`${folder}/face (2).png`)).toBeNull();
    expect(stored(result.path)[FRONTMATTER_KEYS.gallery]).toEqual([link(`${folder}/face.png`), link(`${folder}/face (3).png`)]);
  });

  it("stores the two keys on every kind, drops them when emptied, and holds the main to the list", async () => {
    const project = await service.createProject({ name: "Keys" });
    const picture = link(`${project.rootPath}/40_Scene/45_Gallery/dawn.png`);
    const other = link(`${project.rootPath}/40_Scene/45_Gallery/dusk.png`);
    const scene = await service.createScene(project, { title: "Dawn", gallery: [picture, other, picture], galleryMain: other });
    expect(scene.gallery).toEqual([picture, other, picture]);
    expect(scene.galleryMain).toBe(other);
    const entity = await service.createEntity(project, {
      kind: "location",
      name: "Harbour",
      gallery: [picture],
      galleryMain: "[[Elsewhere/none.png]]",
    });
    expect(entity.gallery).toEqual([picture]);
    expect(entity.galleryMain).toBeNull();
    expect(FRONTMATTER_KEYS.galleryMain in stored(entity.path)).toBe(false);

    // A patch naming neither leaves both; a main alone must name an entry; an empty list clears the main too.
    const same = await service.updateScene(project.projectFile, scene.sceneId, {
      conflict: "The tide turns.",
      expectedRevision: scene.revision,
    });
    expect(same.gallery).toEqual(scene.gallery);
    expect(same.galleryMain).toBe(other);
    const mainOnly = await service.updateScene(project.projectFile, scene.sceneId, {
      galleryMain: picture,
      expectedRevision: same.revision,
    });
    expect(mainOnly.galleryMain).toBe(picture);
    const cleared = await service.updateScene(project.projectFile, scene.sceneId, {
      gallery: [],
      expectedRevision: mainOnly.revision,
    });
    expect(cleared.gallery).toEqual([]);
    expect(cleared.galleryMain).toBeNull();
    expect(FRONTMATTER_KEYS.gallery in stored(scene.path)).toBe(false);
    expect(FRONTMATTER_KEYS.galleryMain in stored(scene.path)).toBe(false);

    // A note made without pictures carries neither key.
    const plain = await service.createCharacter(project, { name: "Plain" });
    expect(plain.gallery).toEqual([]);
    expect(plain.galleryMain).toBeNull();
    expect(FRONTMATTER_KEYS.gallery in stored(plain.path)).toBe(false);
  });
});
