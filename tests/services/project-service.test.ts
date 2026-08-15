import { beforeEach, describe, expect, it } from "vitest";

import {
  SCENE_POV_MULTIPLE,
  SCENE_POV_OMNISCIENT,
  SCHEMA_VERSION,
  STEP_ONE_SECTION_IDS,
} from "../../src/domain";
import {
  ConcurrentChangeError,
  InvalidManagedDocumentError,
  UnsafeSectionError,
  UnsupportedSchemaError,
  parseMarkdownFrontmatter,
} from "../../src/repository";
import {
  DuplicateNameError,
  FRONTMATTER_KEYS,
  ProjectCreationInterruptedError,
  SnowflakeProjectService,
  type ProjectSnapshot,
} from "../../src/services";
import {
  getSystemTemplates,
  readMarkedSection,
  renderMarkedSection,
  type RecordLine,
} from "../../src/templates";
import {
  createFakeEnvironment,
  type FakeFileManager,
  type FakeMetadataCache,
  type FakeVault,
} from "../helpers/fake-vault";

const STEP_ONE_RELATIVE_PATH = "10_Summary/11_One_Sentence_Summary.md";

/** What a note's path looks like inside a link: no ".md", as Obsidian writes them. */
const linkTarget = (path: string): string => path.replace(/\.md$/u, "");

function stripSection(content: string, sectionId: string): string {
  const start = `<!-- snowflake:section:${sectionId}:start -->`;
  const end = `<!-- snowflake:section:${sectionId}:end -->`;
  const from = content.indexOf(start);
  const to = content.indexOf(end);
  if (from === -1 || to === -1) return content;
  return `${content.slice(0, from)}${content.slice(to + end.length)}`.replace(
    /\n{3,}/gu,
    "\n\n",
  );
}

/**
 * Rewrites a freshly created scene into the shape older releases wrote: no
 * conflict property, no fields block, and the conflict in its own managed
 * section under its step heading, above the events.
 */
function reshapeToLegacyScene(
  vault: FakeVault,
  path: string,
  conflictText: string,
): void {
  const raw = vault.contents.get(path) ?? "";
  const parts = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(raw);
  if (!parts) throw new Error(`No frontmatter to reshape in ${path}`);
  const frontmatter = JSON.parse(parts[1]!) as Record<string, unknown>;
  delete frontmatter[FRONTMATTER_KEYS.conflict];
  const body = stripSection(parts[2]!, "scene-fields").replace(
    "## Step 8 · Specific Events",
    `## Step 8 · Conflict\n\n${renderMarkedSection(
      "scene-conflict",
      conflictText,
    )}\n\n## Step 8 · Specific Events`,
  );
  vault.contents.set(
    path,
    `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n${body}`,
  );
}

describe("SnowflakeProjectService", () => {
  let fakeVault: FakeVault;
  let fakeFileManager: FakeFileManager;
  let fakeMetadataCache: FakeMetadataCache;
  let service: SnowflakeProjectService;

  beforeEach(() => {
    const environment = createFakeEnvironment();
    fakeVault = environment.fakeVault;
    fakeFileManager = environment.fakeFileManager;
    fakeMetadataCache = environment.fakeMetadataCache;
    service = new SnowflakeProjectService(
      environment.vault,
      environment.fileManager,
      environment.metadataCache,
    );
  });

  it("creates the full bilingual Markdown project structure", async () => {
    const project = await service.createProject({
      title: "北境之雪",
      locale: "zh-CN",
    });

    expect(project.rootPath).toBe("Snowflake Projects/北境之雪");
    expect(project.projectFile).toBe(
      "Snowflake Projects/北境之雪/00_系统/001_项目元数据.md",
    );
    expect(project.locale).toBe("zh-CN");
    expect(project.links).toEqual({
      draft: "Snowflake Projects/北境之雪/50_正文/初稿.md",
    });
    // Named like every other link the plugin writes, so the property editor
    // shows the note rather than the path leading to it.
    expect(
      (await service.readManagedFrontmatter(project.projectFile))[
        FRONTMATTER_KEYS.draft
      ],
    ).toBe("[[Snowflake Projects/北境之雪/50_正文/初稿|初稿]]");
    const stepOnePath = `${project.rootPath}/10_概述/11_一句话概述.md`;
    expect(fakeVault.getFileByPath(stepOnePath)).not.toBeNull();
    expect(fakeVault.getFileByPath(`${project.rootPath}/10_概述/12_一段式梗概.md`)).not.toBeNull();
    expect(fakeVault.getFileByPath(`${project.rootPath}/30_大纲/31_情节大纲.md`)).not.toBeNull();
    expect(fakeVault.getFileByPath(`${project.rootPath}/30_大纲/32_长篇大纲.md`)).not.toBeNull();
    expect(fakeVault.getAbstractFileByPath(`${project.rootPath}/20_角色`)).not.toBeNull();
    expect(fakeVault.getAbstractFileByPath(`${project.rootPath}/40_场景`)).not.toBeNull();
    expect(fakeVault.getAbstractFileByPath(`${project.rootPath}/50_正文`)).not.toBeNull();
    expect(fakeVault.getAbstractFileByPath(`${project.rootPath}/80_素材`)).not.toBeNull();
    expect(fakeVault.getAbstractFileByPath(`${project.rootPath}/90_存档`)).not.toBeNull();
    expect(fakeVault.getFileByPath(`${project.rootPath}/50_正文/初稿.md`)).not.toBeNull();
    const systemTemplatePaths = [
      "011_模板_一句话概述.md",
      "012_模板_一段式梗概.md",
      "021_模板_角色.md",
      "031_模板_情节大纲.md",
      "032_模板_长篇大纲.md",
      "041_模板_场景.md",
      "051_模板_初稿.md",
      "081_模板_素材.md",
      "091_模板_存档.md",
    ].map((name) => `${project.rootPath}/00_系统/${name}`);
    for (const path of systemTemplatePaths) {
      expect(fakeVault.getFileByPath(path), path).not.toBeNull();
    }
    const stepOne = fakeVault.contents.get(stepOnePath) ?? "";
    expect(stepOne).toContain("# 第一步 · 一句话概述");
    expect(stepOne).toContain("确定自己准备撰写哪种类型的小说，并明确你的目标读者群。");
    expect(stepOne).not.toContain("作为小说家，你的职责就是取悦你的目标读者。");
    expect(stepOne).not.toContain("我想写一个怎样的故事");
    expect(stepOne).not.toContain("#### 原因 1");
    expect(stepOne).not.toContain("#### 原因 2");
    expect(stepOne.match(/### 这类故事之所以能取悦我的目标读者群，原因在于/gu)).toHaveLength(1);
    expect(STEP_ONE_SECTION_IDS).toHaveLength(9);
    expect(stepOne).not.toContain("Snowflake Method compatibility field");
    expect(stepOne).not.toContain("snowflake:section:story-type");
    expect(stepOne).not.toContain("snowflake:section:audience-reason-2");
    expect(stepOne).toContain("snowflake:section:candidate-title-6:start");
    for (const sectionId of STEP_ONE_SECTION_IDS) {
      expect(stepOne.match(new RegExp(`<!-- snowflake:section:${sectionId}:start -->`, "gu"))).toHaveLength(1);
      expect(stepOne.match(new RegExp(`<!-- snowflake:section:${sectionId}:end -->`, "gu"))).toHaveLength(1);
    }
    const systemStepOne = fakeVault.contents.get(systemTemplatePaths[0]!) ?? "";
    expect(parseMarkdownFrontmatter(stepOne).body.trim()).toBe(
      parseMarkdownFrontmatter(systemStepOne).body.trim(),
    );
    for (const templateDefinition of getSystemTemplates("zh-CN")) {
      const path = `${project.rootPath}/00_系统/${templateDefinition.fileName}`;
      const parsed = parseMarkdownFrontmatter(fakeVault.contents.get(path) ?? "");
      expect(parsed.frontmatter[FRONTMATTER_KEYS.schema], path).toBe(SCHEMA_VERSION);
      expect(parsed.frontmatter[FRONTMATTER_KEYS.document], path).toBe(
        templateDefinition.documentType,
      );
      expect(parsed.frontmatter[FRONTMATTER_KEYS.projectId], path).toBe(project.id);
    }
    const characterTemplateProperties = parseMarkdownFrontmatter(
      fakeVault.contents.get(`${project.rootPath}/00_系统/021_模板_角色.md`) ?? "",
    ).frontmatter;
    for (const key of [
      FRONTMATTER_KEYS.characterId,
      FRONTMATTER_KEYS.characterName,
      FRONTMATTER_KEYS.rank,
      FRONTMATTER_KEYS.characterType,
      FRONTMATTER_KEYS.oneSentenceStoryline,
      FRONTMATTER_KEYS.motivation,
      FRONTMATTER_KEYS.goal,
      FRONTMATTER_KEYS.conflict,
      FRONTMATTER_KEYS.growth,
    ]) {
      expect(characterTemplateProperties, key).toHaveProperty(key);
    }
    const sceneTemplateProperties = parseMarkdownFrontmatter(
      fakeVault.contents.get(`${project.rootPath}/00_系统/041_模板_场景.md`) ?? "",
    ).frontmatter;
    for (const key of [
      FRONTMATTER_KEYS.sceneId,
      FRONTMATTER_KEYS.sceneTitle,
      FRONTMATTER_KEYS.rank,
      FRONTMATTER_KEYS.pov,
      FRONTMATTER_KEYS.sceneTime,
      FRONTMATTER_KEYS.sceneLocation,
      FRONTMATTER_KEYS.sceneCharacters,
    ]) {
      expect(sceneTemplateProperties, key).toHaveProperty(key);
    }
    const metadata = fakeVault.contents.get(project.projectFile) ?? "";
    expect(metadata).toContain("本笔记保存雪花写作法插件的项目元数据。");
    expect(metadata).toContain("请勿修改该元数据文件中的任何内容！");
    expect(metadata).toContain("**请勿修改该元数据文件中的任何内容！**");
    expect(metadata).not.toContain("color:");
  });

  it("writes current snowflake-document values to every managed note type", async () => {
    const project = await service.createProject({ name: "Document types" });
    const character = await service.createCharacter(project, { name: "Ada" });
    const scene = await service.createScene(project, { title: "Arrival" });

    const expectedByPath = new Map<string, string>([
      [project.projectFile, "project-metadata"],
      [`${project.rootPath}/10_Summary/11_One_Sentence_Summary.md`, "one-sentence-summary"],
      [`${project.rootPath}/10_Summary/12_One_Paragraph_Summary.md`, "one-paragraph-summary"],
      [`${project.rootPath}/30_Synopsis/31_Plot_Synopsis.md`, "plot-synopsis"],
      [`${project.rootPath}/30_Synopsis/32_Long_Synopsis.md`, "long-synopsis"],
      [character.path, "character"],
      [scene.path, "scene"],
      [project.links.draft ?? "", "draft"],
    ]);

    for (const [path, expectedDocumentType] of expectedByPath) {
      const content = fakeVault.contents.get(path);
      expect(content, path).toBeDefined();
      expect(parseMarkdownFrontmatter(content ?? "").frontmatter[FRONTMATTER_KEYS.document]).toBe(
        expectedDocumentType,
      );
    }
  });

  it("reports missing project metadata, folders, and canonical notes as structure issues", async () => {
    const project = await service.createProject({ name: "Structure health" });
    const summaryPath = `${project.rootPath}/10_Summary/11_One_Sentence_Summary.md`;
    const sceneFolder = `${project.rootPath}/40_Scene`;

    fakeVault.delete(summaryPath);
    fakeVault.delete(sceneFolder);
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(project.projectFile)!,
      (frontmatter) => {
        delete frontmatter[FRONTMATTER_KEYS.projectName];
      },
    );
	const beforeCheck = new Map(fakeVault.contents);
	const frontmatterCallsBeforeCheck = fakeFileManager.frontmatterCalls.length;
	const processCallsBeforeCheck = fakeVault.processCalls.length;

    const damaged = await service.loadProject(project.projectFile);

    expect(damaged.structureIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-metadata-field",
          path: project.projectFile,
          field: FRONTMATTER_KEYS.projectName,
          stepIds: [],
          canOpen: true,
        }),
        expect.objectContaining({
          code: "missing-artifact",
          path: summaryPath,
          stepIds: [1],
          canOpen: false,
        }),
        expect.objectContaining({
          code: "missing-directory",
          path: sceneFolder,
          stepIds: [8, 9],
          canOpen: false,
        }),
      ]),
    );
	expect(new Map(fakeVault.contents)).toEqual(beforeCheck);
	expect(fakeFileManager.frontmatterCalls).toHaveLength(frontmatterCallsBeforeCheck);
	expect(fakeVault.processCalls).toHaveLength(processCallsBeforeCheck);
  });

  it("repairs only the explicitly selected missing project note or folder", async () => {
    const project = await service.createProject({ name: "Targeted repair" });
    const summaryPath = `${project.rootPath}/10_Summary/11_One_Sentence_Summary.md`;
    const materialFolder = `${project.rootPath}/80_Material`;
    const archiveFolder = `${project.rootPath}/90_Archive`;
    const synopsisPath = `${project.rootPath}/30_Synopsis/31_Plot_Synopsis.md`;
    const synopsisBefore = fakeVault.contents.get(synopsisPath);

    fakeVault.delete(summaryPath);
    fakeVault.delete(materialFolder);
    fakeVault.delete(archiveFolder);

    const afterNoteRepair = await service.repairMissingStructureItem(
      project.projectFile,
      summaryPath,
    );

    expect(fakeVault.getFileByPath(summaryPath)).not.toBeNull();
    expect(fakeVault.getAbstractFileByPath(materialFolder)).toBeNull();
    expect(fakeVault.getAbstractFileByPath(archiveFolder)).toBeNull();
    expect(afterNoteRepair.structureIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-directory", path: materialFolder }),
        expect.objectContaining({ code: "missing-directory", path: archiveFolder }),
      ]),
    );

    const afterFolderRepair = await service.repairMissingStructureItem(
      project.projectFile,
      materialFolder,
    );

    expect(fakeVault.getAbstractFileByPath(materialFolder)).not.toBeNull();
    expect(fakeVault.getAbstractFileByPath(archiveFolder)).toBeNull();
    expect(afterFolderRepair.structureIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-directory", path: archiveFolder }),
      ]),
    );
    expect(afterFolderRepair.structureIssues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: summaryPath }),
        expect.objectContaining({ path: materialFolder }),
      ]),
    );
    expect(fakeVault.contents.get(synopsisPath)).toBe(synopsisBefore);
  });

  it("repairs canonical note identity properties without changing its Markdown body", async () => {
    const project = await service.createProject({ name: "Safe property repair" });
    const summaryPath = `${project.rootPath}/${STEP_ONE_RELATIVE_PATH}`;
    const before = parseMarkdownFrontmatter(fakeVault.contents.get(summaryPath) ?? "");
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(summaryPath)!,
      (frontmatter) => {
        delete frontmatter[FRONTMATTER_KEYS.schema];
        frontmatter[FRONTMATTER_KEYS.document] = "not-a-document";
        delete frontmatter[FRONTMATTER_KEYS.projectId];
      },
    );

    const damaged = await service.loadProject(project.projectFile);
    expect(damaged.structureIssues).toContainEqual(
      expect.objectContaining({
        code: "invalid-artifact-metadata",
        path: summaryPath,
        repairable: true,
      }),
    );

    const repaired = await service.repairMissingStructureItem(
      project.projectFile,
      summaryPath,
    );
    const after = parseMarkdownFrontmatter(fakeVault.contents.get(summaryPath) ?? "");
    expect(after.body).toBe(before.body);
    expect(after.frontmatter[FRONTMATTER_KEYS.schema]).toBe(SCHEMA_VERSION);
    expect(after.frontmatter[FRONTMATTER_KEYS.document]).toBe("one-sentence-summary");
    expect(after.frontmatter[FRONTMATTER_KEYS.projectId]).toBe(project.id);
    expect(repaired.structureIssues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: summaryPath })]),
    );
  });

  it("repairs safe project metadata fields one at a time without resetting progress", async () => {
    const project = await service.createProject({ name: "Metadata fields" });
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(project.projectFile)!,
      (frontmatter) => {
        delete frontmatter[FRONTMATTER_KEYS.document];
        delete frontmatter[FRONTMATTER_KEYS.projectName];
      },
    );

    const damaged = await service.loadProject(project.projectFile);
    expect(damaged.structureIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: FRONTMATTER_KEYS.document,
          repairable: true,
        }),
        expect.objectContaining({
          field: FRONTMATTER_KEYS.projectName,
          repairable: true,
        }),
      ]),
    );

    await service.repairMissingStructureItem(
      project.projectFile,
      project.projectFile,
      FRONTMATTER_KEYS.projectName,
    );
    const afterName = await service.loadProject(project.projectFile);
    expect(afterName.structureIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: FRONTMATTER_KEYS.document }),
      ]),
    );
    expect(afterName.structureIssues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: FRONTMATTER_KEYS.projectName }),
      ]),
    );

    await service.repairMissingStructureItem(
      project.projectFile,
      project.projectFile,
      FRONTMATTER_KEYS.document,
    );
    const parsed = parseMarkdownFrontmatter(
      fakeVault.contents.get(project.projectFile) ?? "",
    );
    expect(parsed.frontmatter[FRONTMATTER_KEYS.document]).toBe("project-metadata");
    expect(parsed.frontmatter[FRONTMATTER_KEYS.projectName]).toBe("Metadata fields");
    expect(parsed.frontmatter[FRONTMATTER_KEYS.stepStatuses]).toEqual(
      project.steps,
    );
  });

  it("repairs generated character identity fields but never guesses character type", async () => {
    const project = await service.createProject({ name: "Character metadata" });
    const character = await service.createCharacter(project, {
      name: "Ada",
      type: "major",
    });
    const beforeBody = parseMarkdownFrontmatter(
      fakeVault.contents.get(character.path) ?? "",
    ).body;
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(character.path)!,
      (frontmatter) => {
        delete frontmatter[FRONTMATTER_KEYS.characterId];
        delete frontmatter[FRONTMATTER_KEYS.characterName];
        delete frontmatter[FRONTMATTER_KEYS.rank];
      },
    );

    const damaged = await service.loadProject(project.projectFile);
    expect(damaged.structureIssues).toContainEqual(
      expect.objectContaining({ path: character.path, repairable: true }),
    );
    await service.repairMissingStructureItem(project.projectFile, character.path);
    const repaired = parseMarkdownFrontmatter(
      fakeVault.contents.get(character.path) ?? "",
    );
    expect(repaired.body).toBe(beforeBody);
    expect(repaired.frontmatter[FRONTMATTER_KEYS.characterId]).toEqual(
      expect.any(String),
    );
    expect(repaired.frontmatter[FRONTMATTER_KEYS.characterName]).toBe("Ada");
    expect(repaired.frontmatter[FRONTMATTER_KEYS.rank]).toEqual(expect.any(Number));
    // The role stays where creation put it: in the category link, with no
    // legacy key invented by the repair.
    expect(repaired.frontmatter[FRONTMATTER_KEYS.category]).toEqual([
      expect.stringContaining("21_Category#Major|Major]]"),
    ]);
    expect(repaired.frontmatter[FRONTMATTER_KEYS.characterType]).toBeUndefined();

    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(character.path)!,
      (frontmatter) => {
        // With the category gone and the legacy key nonsense, no home stores
        // a role any more, and the repair must refuse to guess one.
        delete frontmatter[FRONTMATTER_KEYS.category];
        frontmatter[FRONTMATTER_KEYS.characterType] = "protagonist";
      },
    );
    const unsafe = await service.loadProject(project.projectFile);
    expect(unsafe.structureIssues).toContainEqual(
      expect.objectContaining({ path: character.path, repairable: false }),
    );
    await expect(
      service.repairMissingStructureItem(project.projectFile, character.path),
    ).rejects.toThrow(/No repairable/u);
  });

  it("does not take ownership of a note with another valid project id", async () => {
    const project = await service.createProject({ name: "Foreign identity" });
    const summaryPath = `${project.rootPath}/${STEP_ONE_RELATIVE_PATH}`;
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(summaryPath)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.projectId] = "another-project";
      },
    );

    const damaged = await service.loadProject(project.projectFile);
    expect(damaged.structureIssues).toContainEqual(
      expect.objectContaining({
        path: summaryPath,
        code: "invalid-artifact-metadata",
        repairable: false,
      }),
    );
    await expect(
      service.repairMissingStructureItem(project.projectFile, summaryPath),
    ).rejects.toThrow(/No repairable/u);
  });

  it("reports and restores a missing system template without a step-scoped issue", async () => {
    const project = await service.createProject({ name: "System templates" });
    const templateDefinition = getSystemTemplates("en").find(
      ({ id }) => id === "plot-synopsis",
    )!;
    const templatePath = `${project.rootPath}/00_System/${templateDefinition.fileName}`;
    fakeVault.delete(templatePath);

    const damaged = await service.loadProject(project.projectFile);
    expect(damaged.structureIssues).toContainEqual(
      expect.objectContaining({
        code: "missing-system-template",
        path: templatePath,
        stepIds: [],
        canOpen: false,
      }),
    );

    const repaired = await service.repairMissingStructureItem(
      project.projectFile,
      templatePath,
    );
    const repairedTemplate = parseMarkdownFrontmatter(
      fakeVault.contents.get(templatePath) ?? "",
    );
    expect(repairedTemplate.body).toBe(templateDefinition.template.body);
    expect(repairedTemplate.frontmatter[FRONTMATTER_KEYS.document]).toBe(
      templateDefinition.documentType,
    );
    expect(repairedTemplate.frontmatter[FRONTMATTER_KEYS.projectId]).toBe(project.id);
    expect(repaired.structureIssues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: templatePath })]),
    );
  });

  it("reports and explicitly refreshes an outdated system template", async () => {
    const project = await service.createProject({ name: "Outdated template" });
    const templateDefinition = getSystemTemplates("en").find(
      ({ id }) => id === "scene",
    )!;
    const templatePath = `${project.rootPath}/00_System/${templateDefinition.fileName}`;
    fakeVault.contents.set(templatePath, "# Outdated scene template\n");

    const damaged = await service.loadProject(project.projectFile);
    expect(damaged.structureIssues).toContainEqual(
      expect.objectContaining({
        code: "invalid-system-template",
        path: templatePath,
        stepIds: [],
        canOpen: false,
      }),
    );

    await service.repairMissingStructureItem(project.projectFile, templatePath);
    const repairedTemplate = parseMarkdownFrontmatter(
      fakeVault.contents.get(templatePath) ?? "",
    );
    expect(repairedTemplate.body).toBe(templateDefinition.template.body);
    expect(repairedTemplate.frontmatter[FRONTMATTER_KEYS.document]).toBe(
      templateDefinition.documentType,
    );
    expect(repairedTemplate.frontmatter[FRONTMATTER_KEYS.projectId]).toBe(project.id);
  });

  it("keeps a project discoverable when its identity metadata is damaged", async () => {
    const project = await service.createProject({ name: "Damaged identity" });
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(project.projectFile)!,
      (frontmatter) => {
        delete frontmatter[FRONTMATTER_KEYS.document];
        delete frontmatter[FRONTMATTER_KEYS.projectId];
      },
    );

    const discovered = await service.discoverProjects();
    const damaged = discovered.find((candidate) => candidate.rootPath === project.rootPath);

    expect(damaged).toBeDefined();
    const snapshot = await service.loadProject(project.projectFile);
    expect(snapshot.structureIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-metadata-field",
          field: FRONTMATTER_KEYS.document,
        }),
        expect.objectContaining({
          code: "missing-metadata-field",
          field: FRONTMATTER_KEYS.projectId,
        }),
      ]),
    );
  });

  it("renames the project folder and title while preserving its stable id", async () => {
    const project = await service.createProject({ name: "Old title" });
	const metadata = fakeVault.contents.get(project.projectFile) ?? "";
	fakeVault.contents.set(
	  project.projectFile,
	  metadata.replace("# Old title", "# Stale title from an earlier rename"),
	);

    const renamed = await service.renameProject(project, "New title");

    expect(renamed.id).toBe(project.id);
    expect(renamed.title).toBe("New title");
    expect(renamed.rootPath).toBe("Snowflake Projects/New title");
    expect(renamed.projectFile).toBe(
      "Snowflake Projects/New title/00_System/001_Project_Metadata.md",
    );
    expect(fakeVault.getAbstractFileByPath(project.rootPath)).toBeNull();
    expect(
      fakeVault.getFileByPath(
        "Snowflake Projects/New title/10_Summary/11_One_Sentence_Summary.md",
      ),
    ).not.toBeNull();
	const renamedMetadata = fakeVault.contents.get(renamed.projectFile) ?? "";
	expect(parseMarkdownFrontmatter(renamedMetadata).body).toMatch(/^# New title$/mu);
	expect(renamedMetadata).not.toContain("# Stale title from an earlier rename");
  });

  it("uses Chinese names for every managed path in a Chinese project", async () => {
    const project = await service.createProject({
      title: "月海来信",
      locale: "zh-CN",
    });
    const character = await service.createCharacter(project, { name: "林岚" });
    const scene = await service.createScene(project, { title: "离港" });

    expect(project.projectFile).toBe(
      "Snowflake Projects/月海来信/00_系统/001_项目元数据.md",
    );
    expect(project.links.draft).toBe(
      "Snowflake Projects/月海来信/50_正文/初稿.md",
    );
    expect(character.path).toBe("Snowflake Projects/月海来信/20_角色/林岚.md");
    expect(scene.path).toBe("Snowflake Projects/月海来信/40_场景/离港.md");
    expect(fakeVault.getFileByPath(project.links.draft ?? "")).not.toBeNull();
    expect(fakeVault.getAbstractFileByPath(`${project.rootPath}/Plot`)).toBeNull();
    expect(fakeVault.getAbstractFileByPath(`${project.rootPath}/Characters`)).toBeNull();
    expect(fakeVault.getAbstractFileByPath(`${project.rootPath}/Scenes`)).toBeNull();
    expect(fakeVault.getAbstractFileByPath(`${project.rootPath}/Manuscript`)).toBeNull();
  });

  it("creates localized scene canvases without overwriting an existing canvas", async () => {
    const project = await service.createProject({
      title: "画布测试",
      locale: "zh-CN",
    });

    const first = await service.createSceneCanvas(project);
    const second = await service.createSceneCanvas(project);

    expect(first).toBe(`${project.rootPath}/40_场景/场景看板.canvas`);
    expect(second).toBe(`${project.rootPath}/40_场景/场景看板 (2).canvas`);
    expect(fakeVault.contents.get(first)).toBe('{"nodes":[],"edges":[]}');
    expect(fakeVault.contents.get(second)).toBe('{"nodes":[],"edges":[]}');
  });

  it("uses a unique project folder and discovers projects only one level below the root", async () => {
    const first = await service.createProject({ name: "Novel" });
    // No project may take another's name, but a folder the author already keeps
    // under the root claims none -- so the project takes the next name along
    // rather than moving into it.
    await fakeVault.ensureFolders("Snowflake Projects/Sequel");
    const second = await service.createProject({ name: "Sequel" });
    expect(first.rootPath).toBe("Snowflake Projects/Novel");
    expect(second.rootPath).toBe("Snowflake Projects/Sequel (2)");

    const nestedPath = `${first.rootPath}/Nested`;
    await fakeVault.ensureFolders(nestedPath);
    const nestedContent = `---\n${JSON.stringify({
      [FRONTMATTER_KEYS.schema]: SCHEMA_VERSION,
      [FRONTMATTER_KEYS.document]: "project-metadata",
      [FRONTMATTER_KEYS.projectId]: "nested-project",
      [FRONTMATTER_KEYS.projectName]: "Nested",
      [FRONTMATTER_KEYS.projectLanguage]: "en",
    })}\n---\n# Nested`;
    await fakeVault.ensureFolders(`${nestedPath}/00_System`);
    await fakeVault.seedFile(`${nestedPath}/00_System/001_Project_Metadata.md`, nestedContent);

    const discovered = await service.discoverProjects();
    expect(discovered.map((project) => project.id)).toEqual([first.id, second.id]);
  });

  it("refuses a project taking a name another project already has", async () => {
    await service.createProject({ name: "Novel" });

    await expect(service.createProject({ name: "Novel" })).rejects.toBeInstanceOf(
      DuplicateNameError,
    );
    await expect(service.createProject({ name: "  novel " })).rejects.toBeInstanceOf(
      DuplicateNameError,
    );

    expect(await service.discoverProjects()).toHaveLength(1);
    // Nothing was left behind by either attempt.
    expect(fakeVault.getAbstractFileByPath("Snowflake Projects/Novel (2)")).toBeNull();
  });

  // The name only has to be free where the project's folder lands, so the same
  // name under a different root is a different project, not a duplicate.
  it("scopes a project name to the root it is created in", async () => {
    await service.createProject({ name: "Novel" });
    const elsewhere = await service.createProject({
      name: "Novel",
      rootPath: "Archive",
    });

    expect(elsewhere.rootPath).toBe("Archive/Novel");
  });

  it("refuses a project rename onto a name another project has", async () => {
    const novel = await service.createProject({ name: "Novel" });
    const sequel = await service.createProject({ name: "Sequel" });

    await expect(service.renameProject(sequel.projectFile, "Novel")).rejects.toBeInstanceOf(
      DuplicateNameError,
    );

    // Neither project moved.
    expect(fakeVault.getAbstractFileByPath(novel.rootPath)).not.toBeNull();
    expect(fakeVault.getAbstractFileByPath(sequel.rootPath)).not.toBeNull();
  });

  it("lets a project keep its own name through a rename", async () => {
    await service.createProject({ name: "Novel" });
    const sequel = await service.createProject({ name: "Sequel" });

    const renamed = await service.renameProject(sequel.projectFile, "Sequel");

    expect(renamed.title).toBe("Sequel");
    expect(renamed.rootPath).toBe(sequel.rootPath);
  });

  it("creates and discovers projects directly below the Vault root", async () => {
    const rootService = new SnowflakeProjectService(
      fakeVault.asVault(),
      fakeFileManager.asFileManager(),
      fakeMetadataCache.asMetadataCache(),
      "",
    );
    const project = await rootService.createProject({ name: "Root Project" });

    expect(project.rootPath).toBe("Root Project");
    expect(project.projectFile).toBe(
      "Root Project/00_System/001_Project_Metadata.md",
    );
    expect(fakeVault.getAbstractFileByPath("Snowflake Projects")).toBeNull();

    const discovered = await rootService.discoverProjects();
    expect(discovered.map((candidate) => candidate.projectFile)).toEqual([
      project.projectFile,
    ]);
  });

  it("creates a missing nested project root only when a project is created", async () => {
    const rootService = new SnowflakeProjectService(
      fakeVault.asVault(),
      fakeFileManager.asFileManager(),
      fakeMetadataCache.asMetadataCache(),
      "Future Projects/Snowflake",
    );

    expect(fakeVault.getAbstractFileByPath("Future Projects")).toBeNull();
    expect(fakeVault.getAbstractFileByPath("Future Projects/Snowflake")).toBeNull();

    const project = await rootService.createProject({ name: "Novel" });

    expect(project.rootPath).toBe("Future Projects/Snowflake/Novel");
    expect(fakeVault.getAbstractFileByPath("Future Projects")).not.toBeNull();
    expect(fakeVault.getAbstractFileByPath("Future Projects/Snowflake")).not.toBeNull();
  });

  it("recovers an interrupted creation and repairs idempotently without overwriting prose", async () => {
    fakeVault.failNextCreatePath =
      `Snowflake Projects/Interrupted/${STEP_ONE_RELATIVE_PATH}`;
    let interruption: ProjectCreationInterruptedError | null = null;
    try {
      await service.createProject({ name: "Interrupted" });
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectCreationInterruptedError);
      if (error instanceof ProjectCreationInterruptedError) interruption = error;
    }
    expect(interruption?.projectPath).toBe(
      "Snowflake Projects/Interrupted/00_System/001_Project_Metadata.md",
    );
    expect(
      interruption?.originalError instanceof Error
        ? interruption.originalError.message
        : "",
    ).toContain("Simulated");

    const firstRepair = await service.repairProject("Snowflake Projects/Interrupted");
    const synopsis = `${firstRepair.project.rootPath}/30_Synopsis/31_Plot_Synopsis.md`;
    const before = fakeVault.contents.get(synopsis) ?? "";
    fakeVault.contents.set(synopsis, `${before}\nUser appendix that must survive.\n`);
    const beforeSecondRepair = new Map(fakeVault.contents);

    const secondRepair = await service.repairProject(firstRepair.project.rootPath);
    expect(secondRepair.created).toEqual([]);
    expect(fakeVault.contents.get(synopsis)).toContain("User appendix that must survive.");
    expect(new Map(fakeVault.contents)).toEqual(beforeSecondRepair);
  });

  it("round-trips the latest Step 1 fields and rejects a stale batch without any write", async () => {
    const project = await service.createProject({ name: "Step One Fields" });
    const artifact = await service.loadArtifact(project, 1);
    expect(artifact?.path).toBe(`${project.rootPath}/${STEP_ONE_RELATIVE_PATH}`);
    expect(STEP_ONE_SECTION_IDS).toHaveLength(9);

    const fields = {
      genre: "Speculative mystery",
      "audience-reason-1": "1. It rewards readers who enjoy impossible maps.\n2. Its mystery changes whenever the characters look away.",
      "one-sentence-summary": "A cartographer must map a city that erases its own streets.",
      "candidate-title-1": "The Vanishing Atlas",
      "candidate-title-2": "",
      "candidate-title-3": "Streets Without Names",
      "candidate-title-4": "The Last Cartographer",
      "candidate-title-5": "A Map of Absence",
      "candidate-title-6": "City of Erased Streets",
    } satisfies Record<(typeof STEP_ONE_SECTION_IDS)[number], string>;

    await service.updateSections(artifact!.path, fields, artifact!.revision);
    const saved = await service.loadArtifact(project, 1);
    for (const sectionId of STEP_ONE_SECTION_IDS) {
      expect(readMarkedSection(saved!.content, sectionId)).toBe(fields[sectionId]);
    }

    const externalContent = `${saved!.content}\nExternal appendix written after the form opened.\n`;
    fakeVault.contents.set(saved!.path, externalContent);
    const processCount = fakeVault.processCalls.length;
    const staleFields = Object.fromEntries(
      STEP_ONE_SECTION_IDS.map((sectionId) => [sectionId, `Stale ${sectionId}`]),
    );

    await expect(
      service.updateSections(saved!.path, staleFields, saved!.revision),
    ).rejects.toBeInstanceOf(ConcurrentChangeError);
    expect(fakeVault.contents.get(saved!.path)).toBe(externalContent);
    expect(fakeVault.processCalls).toHaveLength(processCount);
  });

  it("repairs present-but-invalid project, character, and scene metadata", async () => {
    const project = await service.createProject({ name: "Damaged metadata", locale: "zh-CN" });
    const character = await service.createCharacter(project, { name: "Ada", type: "major" });
    const firstScene = await service.createScene(project, "Arrival");
    const secondScene = await service.createScene(project, "Departure");

    await fakeFileManager.processFrontMatter(fakeVault.getFileByPath(project.projectFile)!, (frontmatter) => {
      delete frontmatter[FRONTMATTER_KEYS.schema];
      frontmatter[FRONTMATTER_KEYS.projectId] = "   ";
      frontmatter[FRONTMATTER_KEYS.projectName] = 42;
      frontmatter[FRONTMATTER_KEYS.projectLanguage] = "fr";
      frontmatter[FRONTMATTER_KEYS.stepStatuses] = {
        1: "not-a-status",
        9: "skipped",
        11: "complete",
      };
      frontmatter[FRONTMATTER_KEYS.reviewedFingerprints] = {
        1: 42,
        2: "not-a-fingerprint",
        11: "fp1-1234567890abcdef",
      };
    });
    await fakeFileManager.processFrontMatter(fakeVault.getFileByPath(character.path)!, (frontmatter) => {
      delete frontmatter[FRONTMATTER_KEYS.schema];
      delete frontmatter[FRONTMATTER_KEYS.characterId];
      frontmatter[FRONTMATTER_KEYS.characterName] = 42;
      frontmatter[FRONTMATTER_KEYS.characterType] = "hero";
      frontmatter[FRONTMATTER_KEYS.goal] = { invalid: true };
    });
    for (const scene of [firstScene, secondScene]) {
      await fakeFileManager.processFrontMatter(fakeVault.getFileByPath(scene.path)!, (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.sceneId] = "duplicate-scene-id";
        frontmatter[FRONTMATTER_KEYS.rank] = "not-a-rank";
      });
    }
    await fakeFileManager.processFrontMatter(fakeVault.getFileByPath(secondScene.path)!, (frontmatter) => {
      frontmatter[FRONTMATTER_KEYS.sceneTitle] = null;
      frontmatter[FRONTMATTER_KEYS.pov] = 42;
      frontmatter[FRONTMATTER_KEYS.sceneTime] = [];
      frontmatter[FRONTMATTER_KEYS.sceneLocation] = { invalid: true };
      frontmatter[FRONTMATTER_KEYS.sceneCharacters] = 42;
    });

    expect(
      (await service.repository.readManaged(project.projectFile)).frontmatter[
        FRONTMATTER_KEYS.projectId
      ],
    ).toBe("   ");

    const repaired = await service.repairProject(project.rootPath);
    const projectFrontmatter = await service.readManagedFrontmatter(project.projectFile);
    const characters = await service.listCharacters(repaired.project);
    const scenes = await service.listScenes(repaired.project);

    expect(repaired.project.id).toBe(project.id);
    expect(repaired.project.title).toBe("Damaged metadata");
    expect(repaired.project.locale).toBe("en");
    expect(projectFrontmatter[FRONTMATTER_KEYS.schema]).toBe(SCHEMA_VERSION);
    expect(repaired.project.steps[1]).toBe("not-started");
    expect(repaired.project.steps[9]).toBe("not-started");
    expect(repaired.project.reviewedFingerprints).toEqual({});
    expect(characters).toHaveLength(1);
    // The tampered legacy key does not decide the role: the category link
    // written at creation still names it.
    expect(characters[0]).toMatchObject({
      name: "Ada",
      type: "major",
      goal: "",
    });
    expect(characters[0]!.characterId).toMatch(/^character-/u);
    expect(scenes).toHaveLength(2);
    expect(new Set(scenes.map((scene) => scene.sceneId)).size).toBe(2);
    expect(new Set(scenes.map((scene) => scene.rank)).size).toBe(2);
    expect(scenes.find((scene) => scene.path === secondScene.path)).toMatchObject({
      title: "Departure",
      povPath: null,
      time: "",
      location: "",
      characters: [],
    });
    expect(new Set(repaired.repaired).size).toBe(repaired.repaired.length);
    expect(repaired.repaired).toEqual(
      expect.arrayContaining([project.projectFile, character.path, firstScene.path, secondScene.path]),
    );
    expect(repaired.unchanged.filter((path) => repaired.repaired.includes(path))).toEqual([]);
  });

  it("replaces a broken draft link with a collision-safe local draft", async () => {
    const project = await service.createProject({ name: "Broken draft" });
    const occupiedDraft = `${project.rootPath}/50_Manuscript/Draft.md`;
    fakeVault.delete(occupiedDraft);
    await fakeVault.seedFile(occupiedDraft, "Unmanaged notes that must survive");
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(project.projectFile)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.draft] = "[[External/Original.md]]";
      },
    );
    fakeVault.delete("External/Original.md");

    const repaired = await service.repairProject(project.rootPath);
    const replacement = `${project.rootPath}/50_Manuscript/Draft (2).md`;

    expect(repaired.project.links.draft).toBe(replacement);
    expect(fakeVault.getFileByPath(replacement)).not.toBeNull();
    expect(fakeVault.contents.get(occupiedDraft)).toBe("Unmanaged notes that must survive");
    expect(repaired.created).toContain(replacement);
    expect(repaired.repaired.filter((path) => path === project.projectFile)).toHaveLength(1);
  });

  // Obsidian rewrites the links it finds in a renamed note or folder, this
  // plugin's own included, and its rewrite carries no ".md" and may be shortened
  // to a bare file name. Renaming a project is enough to trigger it, so a stored
  // link that is no longer a Vault path is the ordinary case rather than a
  // damaged one, and the note it names is right where it always was.
  it("finds the draft through a link Obsidian rewrote without the file extension", async () => {
    const project = await service.createProject({ name: "Rewritten link" });
    const draftPath = `${project.rootPath}/50_Manuscript/Draft.md`;
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(project.projectFile)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.draft] =
          `[[${project.rootPath}/50_Manuscript/Draft]]`;
      },
    );

    const reloaded = await service.loadProject(project.projectFile);

    expect(reloaded.links.draft).toBe(draftPath);
    expect(reloaded.structureIssues).toEqual([]);
    expect(reloaded.artifacts[10]?.path).toBe(draftPath);
  });

  it("finds the draft through a link shortened to its file name", async () => {
    const project = await service.createProject({ name: "Shortened link" });
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(project.projectFile)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.draft] = "[[Draft]]";
      },
    );

    const reloaded = await service.loadProject(project.projectFile);

    // Still found, and still reported: a bare file name reaches the draft only
    // while nothing else in the Vault answers to it.
    expect(reloaded.links.draft).toBe(`${project.rootPath}/50_Manuscript/Draft.md`);
    expect(reloaded.structureIssues).toContainEqual(
      expect.objectContaining({
        code: "incomplete-link",
        path: project.projectFile,
        expected: "Draft",
        repairable: true,
      }),
    );

    await service.repairMissingStructureItem(
      project.projectFile,
      project.projectFile,
    );
    const repaired = await service.loadProject(project.projectFile);

    expect(
      (await service.readManagedFrontmatter(project.projectFile))[
        FRONTMATTER_KEYS.draft
      ],
    ).toBe(`[[${project.rootPath}/50_Manuscript/Draft|Draft]]`);
    expect(repaired.structureIssues).toEqual([]);
  });

  it("leaves a scene alone when Obsidian rewrote its links without the file extension", async () => {
    const project = await service.createProject({ name: "Rewritten cast" });
    const pov = await service.createCharacter(project, { name: "Ada", type: "major" });
    const supporting = await service.createCharacter(project, {
      name: "Bram",
      type: "supporting",
    });
    const scene = await service.createScene(project, {
      title: "Arrival",
      povPath: pov.path,
      characters: [pov.path, supporting.path],
    });
    const withoutExtension = (path: string): string =>
      `[[${path.replace(/\.md$/u, "")}]]`;
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(scene.path)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.pov] = withoutExtension(pov.path);
        frontmatter[FRONTMATTER_KEYS.sceneCharacters] = [
          withoutExtension(pov.path),
          withoutExtension(supporting.path),
        ];
      },
    );

    const reloaded = await service.loadProject(project.projectFile);

    expect(reloaded.structureIssues).toEqual([]);
  });

  it("puts the manuscript start back when the stored link leads nowhere", async () => {
    const project = await service.createProject({ name: "Lost link" });
    const draftPath = `${project.rootPath}/50_Manuscript/Draft.md`;
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(project.projectFile)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.draft] = "[[Nowhere]]";
      },
    );

    const reloaded = await service.loadProject(project.projectFile);

    // Nobody typed this link, so a stale one is not news. It goes back to the
    // note the manuscript begins at without asking, and a second draft beside
    // it would be the plugin losing the author's manuscript.
    expect(reloaded.links.draft).toBe(draftPath);
    expect(reloaded.structureIssues).toEqual([]);
    expect(
      (await service.readManagedFrontmatter(project.projectFile))[
        FRONTMATTER_KEYS.draft
      ],
    ).toBe(`[[${draftPath.replace(/\.md$/u, "")}|Draft]]`);
    expect(fakeVault.getFileByPath(`${project.rootPath}/50_Manuscript/Draft (2).md`)).toBeNull();
  });

  it("starts the manuscript wherever the author put it, under any name", async () => {
    const project = await service.createProject({ name: "Renamed" });
    const draftPath = `${project.rootPath}/50_Manuscript/Draft.md`;
    await service.manuscript.appendSegment(project, "Chapter Two");
    // The author renames the opening note and files it into a part folder, then
    // deletes nothing: this is the ordinary shape of a real manuscript.
    await service.repository.renameFile(
      draftPath,
      `${project.rootPath}/50_Manuscript/Part One/Chapter One.md`,
    );

    const reloaded = await service.loadProject(project.projectFile);

    expect(reloaded.structureIssues).toEqual([]);
    expect(
      (await service.manuscript.listSegments(reloaded)).map(
        (segment) => segment.title,
      ),
    ).toEqual(["Chapter One", "Chapter Two"]);
  });

  it("says a project has no manuscript only when it truly has none", async () => {
    const project = await service.createProject({ name: "Emptied" });
    const draftPath = `${project.rootPath}/50_Manuscript/Draft.md`;
    const second = await service.manuscript.appendSegment(
      project,
      "Chapter Two",
    );

    // One note gone out of two is not a project without a manuscript.
    await service.repository.trashFile(draftPath);
    const partial = await service.loadProject(project.projectFile);
    expect(partial.structureIssues).toEqual([]);
    expect(partial.links.draft).toBe(second);

    // Both gone is.
    await service.repository.trashFile(second);
    const empty = await service.loadProject(project.projectFile);
    expect(empty.structureIssues).toContainEqual(
      expect.objectContaining({
        code: "missing-artifact",
        path: draftPath,
        expected: "draft",
        repairable: true,
      }),
    );

    const repaired = await service.repairMissingStructureItem(
      project.projectFile,
      draftPath,
    );
    expect(repaired.links.draft).toBe(draftPath);
    expect(repaired.structureIssues).toEqual([]);
  });

  it("reports missing artifact markers without changing the note", async () => {
    const project = await service.createProject({ name: "Repair summary" });
    const synopsisPath = `${project.rootPath}/30_Synopsis/31_Plot_Synopsis.md`;
    const synopsis = fakeVault.contents.get(synopsisPath) ?? "";
    fakeVault.contents.set(
      synopsisPath,
      synopsis.replace(/<!-- snowflake:section:plot-synopsis:start -->[\s\S]*?<!-- snowflake:section:plot-synopsis:end -->/u, "User synopsis"),
    );

    const before = fakeVault.contents.get(synopsisPath);
    const repaired = await service.repairProject(project.rootPath);

    expect(repaired.repaired).not.toContain(synopsisPath);
    expect(repaired.unchanged).not.toContain(synopsisPath);
    expect(repaired.conflicts.some((entry) => entry.path === synopsisPath)).toBe(true);
    expect(fakeVault.contents.get(synopsisPath)).toBe(before);
    expect(repaired.sectionResults).toContainEqual(expect.objectContaining({
      path: synopsisPath,
      sectionId: "plot-synopsis",
      status: "conflict",
      code: "missing",
    }));
    expect(
      repaired.sectionResults.find(
        (entry) => entry.path === synopsisPath && entry.sectionId === "plot-synopsis",
      )?.reason,
    ).toEqual(expect.any(String));
  });

  it("reports an invalid-schema artifact without changing it or aborting repair", async () => {
    const project = await service.createProject({ name: "Invalid child schema" });
    const summaryPath = await service.getArtifactPath(project, 1);
    expect(summaryPath).not.toBeNull();
    await fakeFileManager.processFrontMatter(fakeVault.getFileByPath(summaryPath!)!, (frontmatter) => {
      frontmatter[FRONTMATTER_KEYS.schema] = "invalid-version";
    });
    const before = fakeVault.contents.get(summaryPath!);

    const repaired = await service.repairProject(project.rootPath);

    expect(repaired.conflicts.some((conflict) => conflict.path === summaryPath)).toBe(true);
    expect(fakeVault.contents.get(summaryPath!)).toBe(before);
    expect(repaired.project.projectFile).toBe(project.projectFile);
  });

  it("creates, updates, and renames character notes by stable id", async () => {
    const project = await service.createProject({ name: "Characters" });
    const ada = await service.createCharacter(project, {
      name: "Ada",
      type: "major",
      goal: "Escape",
	  oneParagraphStoryline: "Ada escapes one trap and discovers a larger one.",
      characterSynopsis: "Ada tells the story.",
    });
    const grace = await service.createCharacter(project, "Grace", "supporting");
    expect(ada.path).toMatch(/20_Character\/Ada\.md$/u);
    expect(grace.path).toMatch(/20_Character\/Grace\.md$/u);

    const renamedPath = `${project.rootPath}/20_Character/Ada Lovelace.md`;
    fakeVault.rename(ada.path, renamedPath);
    const updated = await service.updateCharacter(project, ada.characterId, {
      expectedRevision: ada.revision,
      type: "minor",
      motivation: "Freedom",
	  oneParagraphStoryline: "Ada escapes, regroups, and chooses to return.",
      characterProfile: "A complete profile.",
    });
    expect(updated.path).toBe(renamedPath);
    expect(updated.motivation).toBe("Freedom");
    expect(updated.type).toBe("minor");
	expect(updated.oneParagraphStoryline).toBe("Ada escapes, regroups, and chooses to return.");
    expect(updated.characterProfile).toBe("A complete profile.");
    expect(updated.revision).not.toBe(ada.revision);
	const updatedRecord = await service.repository.readManaged(updated.path);
	expect(readMarkedSection(updatedRecord.content, "one-paragraph-storyline")).toBe(
	  "Ada escapes, regroups, and chooses to return.",
	);

    // Both notes keep the ranks createCharacter assigned, so they list in
    // creation order rather than by the renamed file name.
    expect((await service.listCharacters(project)).map((character) => character.characterId)).toEqual([
      ada.characterId,
      grace.characterId,
    ]);
  });

  it("creates character prose in one template write without follow-up section mutations", async () => {
    const project = await service.createProject({ name: "Atomic character create" });
    fakeVault.processCalls.length = 0;

    const character = await service.createCharacter(project, {
      name: "Ada",
      oneParagraphStoryline: "Ada follows the impossible map.",
      characterSynopsis: "Ada retells the story from her point of view.",
      characterProfile: "Ada keeps meticulous field notes.",
    });
    const content = fakeVault.contents.get(character.path) ?? "";

    expect(fakeVault.processCalls).not.toContain(character.path);
    expect(readMarkedSection(content, "one-paragraph-storyline")).toBe(
      "Ada follows the impossible map.",
    );
    expect(readMarkedSection(content, "character-synopsis")).toBe(
      "Ada retells the story from her point of view.",
    );
    expect(readMarkedSection(content, "character-profile")).toBe(
      "Ada keeps meticulous field notes.",
    );
  });

  it("does not partially save a character form when any managed boundary is damaged", async () => {
    const project = await service.createProject({ name: "Damaged character" });
    const created = await service.createCharacter(project, {
      name: "Ada",
      goal: "Escape",
      oneParagraphStoryline: "Original paragraph.",
    });
    const damaged = (fakeVault.contents.get(created.path) ?? "").replace(
      "<!-- snowflake:section:character-profile:start -->",
      "",
    );
    fakeVault.contents.set(created.path, damaged);
    const [character] = (await service.loadProject(project)).characters;
    const frontmatterWrites = fakeFileManager.frontmatterCalls.length;
    const processWrites = fakeVault.processCalls.length;

    await expect(
      service.updateCharacter(project, created.characterId, {
        expectedRevision: character!.revision,
        goal: "A goal that must not be partially saved",
        oneParagraphStoryline: "A paragraph that must not be partially saved.",
      }),
    ).rejects.toBeInstanceOf(UnsafeSectionError);

    expect(fakeVault.contents.get(created.path)).toBe(damaged);
    expect(fakeFileManager.frontmatterCalls).toHaveLength(frontmatterWrites);
    expect(fakeVault.processCalls).toHaveLength(processWrites);
  });

  it("rolls character prose back when the frontmatter phase fails", async () => {
    const project = await service.createProject({ name: "Character rollback" });
    const character = await service.createCharacter(project, {
      name: "Ada",
      goal: "Original goal",
      oneParagraphStoryline: "Original paragraph.",
    });
    const before = fakeVault.contents.get(character.path) ?? "";
    fakeFileManager.failNextFrontmatterPath = character.path;

    await expect(
      service.updateCharacter(project, character.characterId, {
        expectedRevision: character.revision,
        goal: "New goal",
        oneParagraphStoryline: "New paragraph.",
      }),
    ).rejects.toThrow("Simulated frontmatter failure");

    expect(fakeVault.contents.get(character.path)).toBe(before);
  });

  it("preserves the minor character type through creation and loading", async () => {
    const project = await service.createProject({ name: "Minor Characters" });
    const created = await service.createCharacter(project, {
      name: "Courier",
      type: "minor",
    });

    expect(created.type).toBe("minor");
    const [reloaded] = await service.listCharacters(project);
    expect(reloaded?.type).toBe("minor");
    expect(reloaded?.revision).toBe(created.revision);
  });

  it("persists character drag order and normally rewrites only the moved rank", async () => {
    const project = await service.createProject({ name: "Character order" });
    const first = await service.createCharacter(project, { name: "First" });
    const second = await service.createCharacter(project, { name: "Second" });
    const third = await service.createCharacter(project, { name: "Third" });
    fakeFileManager.frontmatterCalls.length = 0;

    const reordered = await service.reorderCharacter(project, third.characterId, 1);

    expect(reordered.map((character) => character.name)).toEqual([
      "First",
      "Third",
      "Second",
    ]);
    expect(fakeFileManager.frontmatterCalls).toEqual([third.path]);
    expect(first.rank).toBeLessThan(reordered[1]!.rank);
    expect(reordered[1]!.rank).toBeLessThan(second.rank);
  });

  it("blocks ambiguous duplicate stable ids until repair assigns new ids", async () => {
    const project = await service.createProject({ name: "Duplicate ids" });
    const first = await service.createCharacter(project, { name: "First" });
    const second = await service.createCharacter(project, { name: "Second" });
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(second.path)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.characterId] = first.characterId;
      },
    );

    await expect(service.loadProject(project)).rejects.toBeInstanceOf(
      InvalidManagedDocumentError,
    );
    await expect(
      service.updateCharacter(project, first.characterId, {
        expectedRevision: first.revision,
        goal: "Must not choose an arbitrary duplicate",
      }),
    ).rejects.toBeInstanceOf(InvalidManagedDocumentError);

    const repaired = await service.repairProject(project.projectFile);
    expect(
      new Set(repaired.project.characters.map((character) => character.characterId)).size,
    ).toBe(2);
  });

  it("rejects a stale character edit without overwriting external Markdown changes", async () => {
    const project = await service.createProject({ name: "Character Concurrency" });
    const character = await service.createCharacter(project, {
      name: "Ada",
      goal: "Escape",
    });
    const openedRevision = character.revision;
    const beforeExternalEdit = fakeVault.contents.get(character.path) ?? "";
    const externalContent = `${beforeExternalEdit}\nExternal appendix written in Obsidian.\n`;
    fakeVault.contents.set(character.path, externalContent);
    const frontmatterWrites = fakeFileManager.frontmatterCalls.length;
    const contentWrites = fakeVault.processCalls.length;

    await expect(
      service.updateCharacter(project, character.characterId, {
        expectedRevision: openedRevision,
        goal: "Overwrite the external edit",
      }),
    ).rejects.toBeInstanceOf(ConcurrentChangeError);

    expect(fakeVault.contents.get(character.path)).toBe(externalContent);
    expect(fakeFileManager.frontmatterCalls).toHaveLength(frontmatterWrites);
    expect(fakeVault.processCalls).toHaveLength(contentWrites);
  });

  it("creates scenes, stores links, and normally rewrites only the moved rank", async () => {
    const project = await service.createProject({ name: "Scenes" });
    // A scene reports the character its link reaches, so there has to be one.
    const ada = await service.createCharacter(project, { name: "Ada", type: "major" });
    const first = await service.createScene(project, { title: "First", conflict: "One" });
	expect(first.povPath).toBe(SCENE_POV_OMNISCIENT);
    const second = await service.createScene(project, {
      title: "Second",
      povPath: ada.path,
      planning: "Plan the reversal.",
    });
    const updatedSecond = await service.updateScene(project, second.sceneId, {
      expectedRevision: second.revision,
      planning: "Plan the reversal and its consequences.",
    });
    expect(updatedSecond.planning).toBe("Plan the reversal and its consequences.");
    expect(updatedSecond.revision).not.toBe(second.revision);
    const third = await service.createScene(project, "Third");
    fakeFileManager.frontmatterCalls.length = 0;

    const reordered = await service.reorderScene(project, third.sceneId, 1);
    expect(reordered.map((scene) => scene.title)).toEqual(["First", "Third", "Second"]);
    expect(fakeFileManager.frontmatterCalls).toEqual([third.path]);
    expect(reordered[2]?.povPath).toBe(ada.path);
    expect(reordered[2]?.planning).toBe("Plan the reversal and its consequences.");
    expect(first.rank).toBeLessThan(reordered[1]!.rank);
  });

  it("persists a reordered scene list when the notes stored no rank", async () => {
    const project = await service.createProject({ name: "Rankless scenes" });
    const scenes = [
      await service.createScene(project, "First"),
      await service.createScene(project, "Second"),
      await service.createScene(project, "Third"),
    ];
    for (const scene of scenes) {
      await fakeFileManager.processFrontMatter(
        fakeVault.getFileByPath(scene.path)!,
        (frontmatter) => {
          delete frontmatter[FRONTMATTER_KEYS.rank];
        },
      );
    }
    expect((await service.listScenes(project)).every((scene) => scene.hasStoredRank)).toBe(
      false,
    );

    const reordered = await service.reorderScene(project, scenes[2]!.sceneId, 0);

    expect(reordered[0]?.sceneId).toBe(scenes[2]!.sceneId);
    // Every note is written, including any whose computed rank equals the
    // fallback it was displaying: without a stored rank the new order would
    // not survive the next load.
    expect(reordered.every((scene) => scene.hasStoredRank)).toBe(true);
    expect((await service.listScenes(project)).map((scene) => scene.title)).toEqual(
      reordered.map((scene) => scene.title),
    );
  });

  it("stores and updates the complete Step 8 scene form", async () => {
    const project = await service.createProject({ name: "Scene Details" });
    const ada = await service.createCharacter(project, { name: "Ada", type: "major" });
    const lin = await service.createCharacter(project, { name: "Lin", type: "major" });
    const scene = await service.createScene(project, {
      title: "Midnight meeting",
      time: "Midnight",
      location: "Old station",
      characters: [ada.path, lin.path],
      conflict: "Ada must choose whom to trust.",
      povPath: ada.path,
      events: "A coded message arrives and the lights go out.",
    });

    expect(scene.time).toBe("Midnight");
    expect(scene.location).toBe("Old station");
    expect(scene.characters).toEqual([ada.path, lin.path]);
    const sceneFrontmatter = parseMarkdownFrontmatter(
      fakeVault.contents.get(scene.path) ?? "",
    ).frontmatter;
    expect(sceneFrontmatter[FRONTMATTER_KEYS.sceneCharacters]).toEqual([
      `[[${linkTarget(ada.path)}|Ada]]`,
      `[[${linkTarget(lin.path)}|Lin]]`,
    ]);
    expect(sceneFrontmatter[FRONTMATTER_KEYS.pov]).toBe(
      `[[${linkTarget(ada.path)}|Ada]]`,
    );
    expect(scene.conflict).toBe("Ada must choose whom to trust.");
    expect(scene.povPath).toBe(ada.path);
    expect(scene.events).toBe("A coded message arrives and the lights go out.");
    expect(sceneFrontmatter[FRONTMATTER_KEYS.conflict]).toBe(
      "Ada must choose whom to trust.",
    );
    expect(
      readMarkedSection(fakeVault.contents.get(scene.path) ?? "", "scene-conflict"),
    ).toBeNull();
    expect(readMarkedSection(fakeVault.contents.get(scene.path) ?? "", "scene-events")).toBe(
      "A coded message arrives and the lights go out.",
    );

    const updated = await service.updateScene(project, scene.sceneId, {
      expectedRevision: scene.revision,
      conflict: "Ada must escape before dawn.",
      events: "The final train arrives without a driver.",
		povPath: SCENE_POV_MULTIPLE,
    });
    expect(updated.conflict).toBe("Ada must escape before dawn.");
    expect(updated.events).toBe("The final train arrives without a driver.");
	expect(updated.povPath).toBe(SCENE_POV_MULTIPLE);
	expect(
		parseMarkdownFrontmatter(fakeVault.contents.get(scene.path) ?? "").frontmatter[
			FRONTMATTER_KEYS.pov
		],
	).toBe(SCENE_POV_MULTIPLE);
    expect((await service.listScenes(project)).map((candidate) => candidate.sceneId)).toEqual([
      scene.sceneId,
    ]);
  });

  it("reads a legacy scene conflict from its section until the property exists", async () => {
    const project = await service.createProject({ name: "Legacy conflict" });
    const created = await service.createScene(project, {
      title: "Old shape",
      conflict: "Written by the property",
    });
    reshapeToLegacyScene(fakeVault, created.path, "The bridge is out.");

    const [legacy] = (await service.loadProject(project)).scenes;
    expect(legacy!.conflict).toBe("The bridge is out.");
    // The old shape is a state of the note, not damage: nothing blocks it.
    expect(legacy!.sectionHealth.issues).toEqual([]);

    const updated = await service.updateScene(project, legacy!.sceneId, {
      expectedRevision: legacy!.revision,
      conflict: "The bridge is rebuilt.",
    });
    expect(updated.conflict).toBe("The bridge is rebuilt.");
    const afterEdit = fakeVault.contents.get(created.path) ?? "";
    expect(
      parseMarkdownFrontmatter(afterEdit).frontmatter[FRONTMATTER_KEYS.conflict],
    ).toBe("The bridge is rebuilt.");
    // Until the migration removes it, the legacy section keeps saying what
    // the property says, so the note never shows yesterday's conflict.
    expect(readMarkedSection(afterEdit, "scene-conflict")).toBe(
      "The bridge is rebuilt.",
    );
  });

  it("lets an empty conflict property override a leftover legacy section", async () => {
    const project = await service.createProject({ name: "Emptied conflict" });
    const created = await service.createScene(project, {
      title: "Cleared",
      conflict: "To be cleared",
    });
    reshapeToLegacyScene(fakeVault, created.path, "Stale section text");
    const raw = fakeVault.contents.get(created.path) ?? "";
    const parts = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(raw);
    const frontmatter = JSON.parse(parts![1]!) as Record<string, unknown>;
    frontmatter[FRONTMATTER_KEYS.conflict] = "";
    fakeVault.contents.set(
      created.path,
      `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n${parts![2]!}`,
    );

    const [scene] = (await service.loadProject(project)).scenes;
    expect(scene!.conflict).toBe("");
  });

  it("writes the localized fields block into new notes and refreshes it on edit", async () => {
    const project = await service.createProject({ name: "Block life" });
    const character = await service.createCharacter(project, {
      name: "Ada",
      type: "major",
      motivation: "Belong somewhere.",
    });
    const created = fakeVault.contents.get(character.path) ?? "";
    const block = readMarkedSection(created, "character-fields");
    expect(block).toContain("> [!info] Character overview");
    expect(block).toContain("20_Character/21_Category#Major|Major]]");
    expect(block).toContain("> **Motivation**: Belong somewhere.");

    const updated = await service.updateCharacter(project, character.characterId, {
      expectedRevision: character.revision,
      motivation: "Lead the fleet.",
      type: "supporting",
    });
    const after = readMarkedSection(
      fakeVault.contents.get(updated.path) ?? "",
      "character-fields",
    );
    expect(after).toContain("21_Category#Supporting|Supporting]]");
    expect(after).toContain("> **Motivation**: Lead the fleet.");
    expect(after).not.toContain("Belong somewhere.");
  });

  it("gives a character from before the block its fields block on the first edit", async () => {
    const project = await service.createProject({ name: "Block by edit" });
    const character = await service.createCharacter(project, {
      name: "Ada",
      type: "minor",
    });
    const raw = fakeVault.contents.get(character.path) ?? "";
    fakeVault.contents.set(character.path, stripSection(raw, "character-fields"));

    const [legacy] = (await service.loadProject(project)).characters;
    expect(legacy!.sectionHealth.issues).toEqual([]);

    const updated = await service.updateCharacter(project, legacy!.characterId, {
      expectedRevision: legacy!.revision,
      goal: "Cross the sea.",
    });
    const content = fakeVault.contents.get(updated.path) ?? "";
    const block = readMarkedSection(content, "character-fields");
    expect(block).toContain("> **Goal**: Cross the sea.");
    expect(content.indexOf("snowflake:section:character-fields:end")).toBeLessThan(
      content.indexOf("## Step 3"),
    );
  });

  it("keeps the scene block naming the point of view and the conflict", async () => {
    const project = await service.createProject({ name: "Scene block" });
    const ada = await service.createCharacter(project, { name: "Ada", type: "major" });
    const scene = await service.createScene(project, {
      title: "Arrival",
      povPath: ada.path,
      conflict: "The tide turns.",
      characters: [ada.path],
    });
    const block = readMarkedSection(
      fakeVault.contents.get(scene.path) ?? "",
      "scene-fields",
    );
    expect(block).toContain(
      `> **Point-of-view character**: [[${linkTarget(ada.path)}|Ada]]`,
    );
    expect(block).toContain("> **Conflict**: The tide turns.");
    expect(block).toContain(`> **Characters**: [[${linkTarget(ada.path)}|Ada]]`);

    const updated = await service.updateScene(project, scene.sceneId, {
      expectedRevision: scene.revision,
      povPath: SCENE_POV_OMNISCIENT,
      conflict: "The tide waits.",
    });
    const after = readMarkedSection(
      fakeVault.contents.get(updated.path) ?? "",
      "scene-fields",
    );
    expect(after).toContain("> **Point-of-view character**: Omniscient");
    expect(after).toContain("> **Conflict**: The tide waits.");
  });

  it("migrates a project's legacy notes in one pass and reports the counts", async () => {
    const project = await service.createProject({ name: "Bulk migration" });
    const ada = await service.createCharacter(project, {
      name: "Ada",
      type: "major",
      goal: "Hold.",
    });
    const scene = await service.createScene(project, {
      title: "Arrival",
      conflict: "The gate is shut.",
      povPath: ada.path,
    });
    const characterRaw = fakeVault.contents.get(ada.path) ?? "";
    fakeVault.contents.set(
      ada.path,
      stripSection(characterRaw, "character-fields"),
    );
    reshapeToLegacyScene(fakeVault, scene.path, "The gate is shut.");

    const before = await service.loadProject(project);
    expect(before.characters[0]!.unmigrated).toBe(true);
    expect(before.scenes[0]!.unmigrated).toBe(true);

    const result = await service.migrateMemberNotes(project.projectFile);
    expect(result).toEqual({ migrated: 2, skipped: 0 });

    const characterContent = fakeVault.contents.get(ada.path) ?? "";
    expect(
      readMarkedSection(characterContent, "character-fields"),
    ).toContain("> **Goal**: Hold.");

    const sceneContent = fakeVault.contents.get(scene.path) ?? "";
    expect(readMarkedSection(sceneContent, "scene-fields")).toContain(
      "> **Conflict**: The gate is shut.",
    );
    expect(sceneContent).not.toContain("snowflake:section:scene-conflict");
    expect(sceneContent).not.toContain("## Step 8 · Conflict");
    expect(
      parseMarkdownFrontmatter(sceneContent).frontmatter[
        FRONTMATTER_KEYS.conflict
      ],
    ).toBe("The gate is shut.");
    expect(
      sceneContent.indexOf("snowflake:section:scene-fields:end"),
    ).toBeLessThan(sceneContent.indexOf("## Step 8 · Specific Events"));

    const after = await service.loadProject(project);
    expect(after.characters[0]!.unmigrated).toBe(false);
    expect(after.scenes[0]!.unmigrated).toBe(false);
    expect(await service.migrateMemberNotes(project.projectFile)).toEqual({
      migrated: 0,
      skipped: 0,
    });
  });

  it("skips a note whose block markers are damaged and migrates the rest", async () => {
    const project = await service.createProject({ name: "Damaged skip" });
    const ada = await service.createCharacter(project, { name: "Ada", type: "major" });
    const bea = await service.createCharacter(project, { name: "Bea", type: "minor" });
    const adaRaw = fakeVault.contents.get(ada.path) ?? "";
    const beaRaw = fakeVault.contents.get(bea.path) ?? "";
    fakeVault.contents.set(ada.path, stripSection(adaRaw, "character-fields"));
    fakeVault.contents.set(
      bea.path,
      `${stripSection(beaRaw, "character-fields")}\n<!-- snowflake:section:character-fields:start -->\n`,
    );

    const result = await service.migrateMemberNotes(project.projectFile);
    expect(result).toEqual({ migrated: 1, skipped: 1 });
    expect(
      readMarkedSection(
        fakeVault.contents.get(ada.path) ?? "",
        "character-fields",
      ),
    ).not.toBeNull();
    expect(
      readMarkedSection(
        fakeVault.contents.get(bea.path) ?? "",
        "character-fields",
      ),
    ).toBeNull();
  });

  it("reconciles a drifted block and follows a property edited outside the forms", async () => {
    const project = await service.createProject({ name: "Reconcile" });
    const character = await service.createCharacter(project, {
      name: "Ada",
      type: "major",
      goal: "Hold the line.",
    });
    const content = fakeVault.contents.get(character.path) ?? "";
    const tampered = content.replace(
      "> **Goal**: Hold the line.",
      "> **Goal**: Something typed into the block",
    );
    expect(tampered).not.toBe(content);
    fakeVault.contents.set(character.path, tampered);

    let snapshot = await service.loadProject(project);
    expect(
      await service.reconcileMemberFieldsBlock(snapshot, character.path),
    ).toBe(true);
    expect(
      readMarkedSection(
        fakeVault.contents.get(character.path) ?? "",
        "character-fields",
      ),
    ).toContain("> **Goal**: Hold the line.");

    snapshot = await service.loadProject(project);
    expect(
      await service.reconcileMemberFieldsBlock(snapshot, character.path),
    ).toBe(false);

    await service.repository.updateFrontmatter(character.path, {
      [FRONTMATTER_KEYS.goal]: "Cross the sea.",
    });
    snapshot = await service.loadProject(project);
    expect(
      await service.reconcileMemberFieldsBlock(snapshot, character.path),
    ).toBe(true);
    expect(
      readMarkedSection(
        fakeVault.contents.get(character.path) ?? "",
        "character-fields",
      ),
    ).toContain("> **Goal**: Cross the sea.");
  });

  it("creates all scene prose in the initial template and rejects a partially damaged form", async () => {
    const project = await service.createProject({ name: "Atomic scene" });
    fakeVault.processCalls.length = 0;
    const created = await service.createScene(project, {
      title: "Arrival",
      conflict: "Ada cannot enter the city.",
      events: "The gate closes.",
      planning: "Reveal the forged pass.",
    });
    const original = fakeVault.contents.get(created.path) ?? "";
    expect(fakeVault.processCalls).not.toContain(created.path);
    expect(readMarkedSection(original, "scene-conflict")).toBeNull();
    expect(
      parseMarkdownFrontmatter(original).frontmatter[FRONTMATTER_KEYS.conflict],
    ).toBe("Ada cannot enter the city.");
    expect(readMarkedSection(original, "scene-events")).toBe("The gate closes.");
    expect(readMarkedSection(original, "scene-planning")).toBe(
      "Reveal the forged pass.",
    );

    const damaged = original.replace(
      "<!-- snowflake:section:scene-planning:end -->",
      "",
    );
    fakeVault.contents.set(created.path, damaged);
    const [scene] = (await service.loadProject(project)).scenes;
    const frontmatterWrites = fakeFileManager.frontmatterCalls.length;
    const processWrites = fakeVault.processCalls.length;
    await expect(
      service.updateScene(project, created.sceneId, {
        expectedRevision: scene!.revision,
        location: "Must not be saved",
        events: "Must not be saved",
      }),
    ).rejects.toBeInstanceOf(UnsafeSectionError);
    expect(fakeVault.contents.get(created.path)).toBe(damaged);
    expect(fakeFileManager.frontmatterCalls).toHaveLength(frontmatterWrites);
    expect(fakeVault.processCalls).toHaveLength(processWrites);
  });

  it("rejects a stale scene edit without overwriting external frontmatter changes", async () => {
    const project = await service.createProject({ name: "Scene Concurrency" });
    const scene = await service.createScene(project, {
      title: "Arrival",
      time: "At dawn",
    });
    const openedRevision = scene.revision;
    const beforeExternalEdit = fakeVault.contents.get(scene.path) ?? "";
    const externalContent = beforeExternalEdit.replace(
      `"${FRONTMATTER_KEYS.sceneTime}": "At dawn"`,
      `"${FRONTMATTER_KEYS.sceneTime}": "Changed directly in Markdown"`,
    );
    expect(externalContent).not.toBe(beforeExternalEdit);
    fakeVault.contents.set(scene.path, externalContent);
    const frontmatterWrites = fakeFileManager.frontmatterCalls.length;
    const contentWrites = fakeVault.processCalls.length;

    await expect(
      service.updateScene(project, scene.sceneId, {
        expectedRevision: openedRevision,
        location: "Stale location",
      }),
    ).rejects.toMatchObject({
      code: "concurrent-change",
      path: scene.path,
      expectedRevision: openedRevision,
    });

    expect(fakeVault.contents.get(scene.path)).toBe(externalContent);
    expect(fakeFileManager.frontmatterCalls).toHaveLength(frontmatterWrites);
    expect(fakeVault.processCalls).toHaveLength(contentWrites);
  });

  it("marks a newer project schema read-only and rejects every mutation path", async () => {
    let project: ProjectSnapshot = await service.createProject({ name: "Future" });
    const content = fakeVault.contents.get(project.projectFile) ?? "";
    fakeVault.contents.set(
      project.projectFile,
      content.replace(`"${FRONTMATTER_KEYS.schema}": ${SCHEMA_VERSION}`, `"${FRONTMATTER_KEYS.schema}": 99`),
    );
    project = await service.loadProject(project.projectFile);

    expect(project.readOnly).toBe(true);
    expect(project.structureIssues).toEqual([]);
    await expect(service.updateStepStatus(project, 1, "complete")).rejects.toBeInstanceOf(
      UnsupportedSchemaError,
    );
    await expect(service.createScene(project, "Forbidden")).rejects.toBeInstanceOf(
      UnsupportedSchemaError,
    );
    expect(fakeVault.getFileByPath(`${project.rootPath}/40_Scene/Forbidden.md`)).toBeNull();
  });

  it("opens a project read-only when a child note uses a newer schema", async () => {
    const project = await service.createProject({ name: "Future child" });
    const character = await service.createCharacter(project, { name: "Unknown future hero" });
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(character.path)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.schema] = SCHEMA_VERSION + 1;
        delete frontmatter[FRONTMATTER_KEYS.characterId];
      },
    );

    const reloaded = await service.loadProject(project);
    expect(reloaded.readOnly).toBe(true);
    expect(reloaded.structureIssues).toEqual([]);
    expect(await service.listCharacters(reloaded)).toEqual([]);
    await expect(service.createScene(reloaded, "Forbidden")).rejects.toBeInstanceOf(
      UnsupportedSchemaError,
    );
  });

  it("does not reconcile revision statuses in a read-only project", async () => {
    let project = await service.createProject({ name: "Read-only revision" });
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const) {
      await service.updateStepStatus(project, step, "complete");
    }
    const summaryPath = await service.getArtifactPath(project, 1);
    await service.updateSection(
      summaryPath!,
      "one-sentence-summary",
      "Changed before a future-schema upgrade.",
    );
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(project.projectFile)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.schema] = SCHEMA_VERSION + 1;
      },
    );
    const frontmatterWrites = fakeFileManager.frontmatterCalls.length;

    project = await service.reconcileRevisionStatuses(project.projectFile);
    expect(project.readOnly).toBe(true);
    expect(project.steps[2]).toBe("complete");
    expect(project.steps[10]).toBe("complete");
    expect(fakeFileManager.frontmatterCalls).toHaveLength(frontmatterWrites);
  });

  it("keeps step 10 incomplete until steps 1 through 9 are handled", async () => {
    const project = await service.createProject({ name: "Step ten dependency" });

    await service.updateStepStatus(project, 10, "complete");
    let reloaded = await service.loadProject(project);
    expect(reloaded.steps[10]).toBe("not-started");

    for (const step of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      await service.updateStepStatus(project, step, "complete");
    }
    await service.updateStepStatus(project, 9, "skipped");
    await service.updateStepStatus(project, 10, "complete");
    reloaded = await service.loadProject(project);
    expect(reloaded.steps[10]).toBe("complete");

    await service.updateStepStatus(project, 4, "in-revision");
    reloaded = await service.loadProject(project);
    expect(reloaded.steps[4]).toBe("in-revision");
    expect(reloaded.steps[6]).toBe("complete");
    expect(reloaded.steps[8]).toBe("complete");
    expect(reloaded.steps[9]).toBe("skipped");
    expect(reloaded.steps[10]).toBe("complete");

    await service.updateStepStatus(project, 4, "complete");
    reloaded = await service.loadProject(project);
    expect(reloaded.steps[10]).toBe("complete");
  });

  it("persists outdated completed steps as revisions and resets step 10", async () => {
    const project = await service.createProject({ name: "Review" });
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const) {
      await service.updateStepStatus(project, step, "complete");
    }
    let reloaded = await service.loadProject(project);
    expect(reloaded.needsReview).toEqual([]);
    const summaryPath = await service.getArtifactPath(reloaded, 1);
    expect(summaryPath).not.toBeNull();
    await service.updateSection(
      summaryPath!,
      "one-sentence-summary",
      "A changed one-sentence summary.",
    );

    reloaded = await service.loadProject(project);
    expect(reloaded.needsReview).toEqual([2, 4, 6, 8, 9, 10]);

    reloaded = await service.reconcileRevisionStatuses(project);
    expect(reloaded.steps[1]).toBe("complete");
    expect(reloaded.steps[2]).toBe("in-revision");
    expect(reloaded.steps[4]).toBe("in-revision");
    expect(reloaded.steps[6]).toBe("in-revision");
    expect(reloaded.steps[8]).toBe("in-revision");
    expect(reloaded.steps[9]).toBe("in-revision");
    expect(reloaded.steps[10]).toBe("not-started");

    await service.updateStepStatus(project, 2, "complete");
    await service.updateStepStatus(project, 4, "complete");
    reloaded = await service.loadProject(project);
    expect(reloaded.steps[2]).toBe("complete");
    expect(reloaded.steps[4]).toBe("complete");
    expect(reloaded.needsReview).toEqual([6, 8, 9]);

    // Steps left in revision keep their stale reviewed fingerprint, so they
    // stay in needsReview with nothing left to reconcile. That steady state
    // must not rewrite the metadata note: the Vault "modify" it emits comes
    // straight back as another dashboard refresh.
    const frontmatterWrites = fakeFileManager.frontmatterCalls.length;
    const reconciledAgain = await service.reconcileRevisionStatuses(project);
    expect(reconciledAgain.steps).toEqual(reloaded.steps);
    expect(fakeFileManager.frontmatterCalls).toHaveLength(frontmatterWrites);

    expect(
      (await service.reconcileRevisionStatuses(project)).steps,
    ).toEqual(reloaded.steps);
    expect(fakeFileManager.frontmatterCalls).toHaveLength(frontmatterWrites);
  });

  it("keeps a skipped optional step skipped and refreshes its fingerprint", async () => {
    const project = await service.createProject({ name: "Skipped review" });
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      await service.updateStepStatus(project, step, "complete");
    }
    await service.updateStepStatus(project, 9, "skipped");
    await service.updateStepStatus(project, 10, "complete");

    const summaryPath = await service.getArtifactPath(project, 1);
    expect(summaryPath).not.toBeNull();
    await service.updateSection(
      summaryPath!,
      "one-sentence-summary",
      "A changed summary for a skipped planning step.",
    );

    const reconciled = await service.reconcileRevisionStatuses(project);
    expect(reconciled.steps[9]).toBe("skipped");
    expect(reconciled.steps[10]).toBe("not-started");
    expect(reconciled.needsReview).not.toContain(9);
  });

  it("does not reconcile revision statuses while a managed marker is damaged", async () => {
    const project = await service.createProject({ name: "Damaged revision" });
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const) {
      await service.updateStepStatus(project, step, "complete");
    }
    const summaryPath = await service.getArtifactPath(project, 1);
    const content = fakeVault.contents.get(summaryPath!) ?? "";
    fakeVault.contents.set(
      summaryPath!,
      content.replace(
        "<!-- snowflake:section:one-sentence-summary:start -->",
        "<!-- snowflake:section:one-sentence-summary:broken -->",
      ),
    );
    const frontmatterWrites = fakeFileManager.frontmatterCalls.length;

    const reconciled = await service.reconcileRevisionStatuses(project);
    expect(reconciled.steps[2]).toBe("complete");
    expect(reconciled.steps[10]).toBe("complete");
    expect(fakeFileManager.frontmatterCalls).toHaveLength(frontmatterWrites);
  });

  it("does not overwrite a concurrent status change during reconciliation", async () => {
    const project = await service.createProject({ name: "Concurrent revision" });
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const) {
      await service.updateStepStatus(project, step, "complete");
    }
    const summaryPath = await service.getArtifactPath(project, 1);
    await service.updateSection(
      summaryPath!,
      "one-sentence-summary",
      "Changed while another status update is arriving.",
    );
    fakeFileManager.beforeNextFrontmatterProcess = async (file) => {
      if (file.path !== project.projectFile) return;
      const current = fakeVault.contents.get(file.path) ?? "";
      fakeVault.contents.set(
        file.path,
        current.replace('"2": "complete"', '"2": "in-progress"'),
      );
    };

    const reconciled = await service.reconcileRevisionStatuses(project);
    expect(reconciled.steps[2]).toBe("in-progress");
    expect(reconciled.steps[4]).toBe("not-started");
    expect(reconciled.steps[10]).toBe("not-started");
  });

  it("renames the character file and heading when the name changes", async () => {
    const project = await service.createProject({ name: "Renames" });
    const character = await service.createCharacter(project, "Bob");
    expect(character.path).toBe(`${project.rootPath}/20_Character/Bob.md`);

    const renamed = await service.updateCharacter(project, character.characterId, {
      expectedRevision: character.revision,
      name: "Robert",
    });

    expect(renamed.path).toBe(`${project.rootPath}/20_Character/Robert.md`);
    expect(renamed.name).toBe("Robert");
    expect(fakeVault.getFileByPath(character.path)).toBeNull();
    expect(fakeVault.contents.get(renamed.path)).toContain("# Robert");
    expect(renamed.characterId).toBe(character.characterId);
  });

  it("refreshes the links scenes store for a renamed character", async () => {
    const project = await service.createProject({ name: "Scene Links" });
    const bob = await service.createCharacter(project, "Bob");
    const alice = await service.createCharacter(project, "Alice");
    const scene = await service.createScene(project, {
      title: "Meeting",
      povPath: bob.path,
      characters: [bob.path, alice.path],
    });

    const renamed = await service.updateCharacter(project, bob.characterId, {
      expectedRevision: bob.revision,
      name: "Robert",
    });
    const frontmatter = await service.readManagedFrontmatter(scene.path);

    // The path and the display text both have to follow the rename; Obsidian
    // would only ever update the path.
    expect(frontmatter[FRONTMATTER_KEYS.pov]).toBe(
      `[[${linkTarget(renamed.path)}|Robert]]`,
    );
    expect(frontmatter[FRONTMATTER_KEYS.sceneCharacters]).toEqual([
      `[[${linkTarget(renamed.path)}|Robert]]`,
      `[[${linkTarget(alice.path)}|Alice]]`,
    ]);
    const reloaded = await service.listScenes(project);
    expect(reloaded[0]?.povPath).toBe(renamed.path);
  });

  it("renames the scene file and heading when the title changes", async () => {
    const project = await service.createProject({ name: "Scene Renames" });
    const scene = await service.createScene(project, "Arrival");

    const renamed = await service.updateScene(project, scene.sceneId, {
      expectedRevision: scene.revision,
      title: "Departure",
    });

    expect(renamed.path).toBe(`${project.rootPath}/40_Scene/Departure.md`);
    expect(fakeVault.getFileByPath(scene.path)).toBeNull();
    expect(fakeVault.contents.get(renamed.path)).toContain("# Departure");
    expect(renamed.sceneId).toBe(scene.sceneId);
  });

  // No character may take another's name, but the note it wants can still be
  // occupied by something outside the project -- an ordinary note the author
  // keeps in the same folder.
  it("keeps a rename that collides with another note on a distinct file", async () => {
    const project = await service.createProject({ name: "Collision" });
    const stray = `${project.rootPath}/20_Character/Alice.md`;
    await service.repository.createPlainFile(stray, "Notes about Alice.\n");
    const bob = await service.createCharacter(project, "Bob");

    const renamed = await service.updateCharacter(project, bob.characterId, {
      expectedRevision: bob.revision,
      name: "Alice",
    });

    expect(renamed.path).toBe(`${project.rootPath}/20_Character/Alice (2).md`);
    expect(fakeVault.getFileByPath(stray)).not.toBeNull();
    expect(renamed.name).toBe("Alice");
  });

  it("accepts a numbered file name when the note a name asks for is taken", async () => {
    const project = await service.createProject({ name: "Duplicates" });
    await service.repository.createPlainFile(
      `${project.rootPath}/20_Character/Alice.md`,
      "Notes about Alice.\n",
    );
    await service.createCharacter(project, "Alice");

    const snapshot = await service.loadProject(project.projectFile);

    // The numbered file is the only one left, so it is not drift.
    expect(snapshot.structureIssues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "mismatched-character-title" }),
      ]),
    );
  });

  it("refuses a character taking a name another character already has", async () => {
    const project = await service.createProject({ name: "Duplicate names" });
    const alice = await service.createCharacter(project, "Alice");

    await expect(service.createCharacter(project, "Alice")).rejects.toBeInstanceOf(
      DuplicateNameError,
    );
    // Casing and spacing are not a difference a reader can see, and the file name
    // collapses both anyway.
    await expect(
      service.createCharacter(project, "  alice  "),
    ).rejects.toBeInstanceOf(DuplicateNameError);

    // Nothing was written for either attempt.
    expect(await service.listCharacters(project)).toHaveLength(1);
    expect(fakeVault.getFileByPath(alice.path)).not.toBeNull();
  });

  it("refuses a scene taking a title another scene already has", async () => {
    const project = await service.createProject({ name: "Duplicate titles" });
    await service.createScene(project, "Arrival");

    await expect(service.createScene(project, "arrival")).rejects.toBeInstanceOf(
      DuplicateNameError,
    );

    expect(await service.listScenes(project)).toHaveLength(1);
  });

  it("refuses a rename onto a taken name without saving the rest of the form", async () => {
    const project = await service.createProject({ name: "Rename collision" });
    await service.createCharacter(project, "Alice");
    const bob = await service.createCharacter(project, { name: "Bob", goal: "Original goal" });
    const before = fakeVault.contents.get(bob.path) ?? "";

    await expect(
      service.updateCharacter(project, bob.characterId, {
        expectedRevision: bob.revision,
        name: "Alice",
        goal: "A goal that must not be saved on its own",
      }),
    ).rejects.toBeInstanceOf(DuplicateNameError);

    expect(fakeVault.contents.get(bob.path)).toBe(before);
  });

  it("lets a character keep its own name while other fields change", async () => {
    const project = await service.createProject({ name: "Same name" });
    await service.createCharacter(project, "Alice");
    const bob = await service.createCharacter(project, "Bob");

    const updated = await service.updateCharacter(project, bob.characterId, {
      expectedRevision: bob.revision,
      name: "Bob",
      goal: "Escape",
    });

    expect(updated.name).toBe("Bob");
    expect(updated.goal).toBe("Escape");
    expect(updated.path).toBe(bob.path);
  });

  // Projects written before duplicates were refused may hold a pair of them.
  // Keeping a name is not taking one, so the twin is still editable rather than
  // held to ransom for a rename the author did not ask to make.
  it("lets a character that already shares a name edit its other fields", async () => {
    const project = await service.createProject({ name: "Legacy duplicate" });
    await service.createCharacter(project, "Alice");
    const twin = await service.createCharacter(project, "Bob");
    // Renamed straight in the frontmatter, past the service, which is how a
    // project written by a version that allowed duplicates already looks.
    await service.repository.updateFrontmatter(twin.path, {
      [FRONTMATTER_KEYS.characterName]: "Alice",
    });
    const [, duplicated] = await service.listCharacters(project);
    expect(duplicated!.name).toBe("Alice");

    const updated = await service.updateCharacter(project, duplicated!.characterId, {
      expectedRevision: duplicated!.revision,
      name: "Alice",
      goal: "Escape",
    });

    expect(updated.goal).toBe("Escape");
    expect(updated.name).toBe("Alice");
  });

  it("still refuses a third character taking the name of a legacy pair", async () => {
    const project = await service.createProject({ name: "Legacy pair" });
    await service.createCharacter(project, "Alice");
    const twin = await service.createCharacter(project, "Bob");
    await service.repository.updateFrontmatter(twin.path, {
      [FRONTMATTER_KEYS.characterName]: "Alice",
    });

    await expect(service.createCharacter(project, "Alice")).rejects.toBeInstanceOf(
      DuplicateNameError,
    );
  });

  it("refuses a scene rename onto a taken title without saving the rest", async () => {
    const project = await service.createProject({ name: "Scene rename collision" });
    await service.createScene(project, "Arrival");
    const departure = await service.createScene(project, {
      title: "Departure",
      conflict: "Original conflict",
    });
    const before = fakeVault.contents.get(departure.path) ?? "";

    await expect(
      service.updateScene(project, departure.sceneId, {
        expectedRevision: departure.revision,
        title: "Arrival",
        conflict: "A conflict that must not be saved on its own",
      }),
    ).rejects.toBeInstanceOf(DuplicateNameError);

    expect(fakeVault.contents.get(departure.path)).toBe(before);
  });

  it("reports a file name that drifted from the stored name and repairs it", async () => {
    const project = await service.createProject({ name: "Drift" });
    const character = await service.createCharacter(project, "Bob");
    const scene = await service.createScene(project, {
      title: "Meeting",
      povPath: character.path,
    });
    const moved = `${project.rootPath}/20_Character/Renamed Outside.md`;
    await service.repository.renameFile(character.path, moved);

    const damaged = await service.loadProject(project.projectFile);

    expect(damaged.structureIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "mismatched-character-title",
          path: moved,
          expected: "Bob",
          stepIds: [3, 5, 7],
          repairable: true,
        }),
      ]),
    );

    await service.repairMissingStructureItem(project.projectFile, moved);

    expect(fakeVault.getFileByPath(character.path)).not.toBeNull();
    expect(fakeVault.getFileByPath(moved)).toBeNull();
    expect(
      (await service.readManagedFrontmatter(scene.path))[FRONTMATTER_KEYS.pov],
    ).toBe(`[[${linkTarget(character.path)}|Bob]]`);
  });

  it("rewrites the links older projects stored with a file extension", async () => {
    const project = await service.createProject({ name: "Legacy links" });
    const ada = await service.createCharacter(project, { name: "Ada", type: "major" });
    const scene = await service.createScene(project, {
      title: "Arrival",
      povPath: ada.path,
      characters: [ada.path],
    });
    // What every project written before the change has on disk.
    const withExtension = (path: string, alias: string): string =>
      `[[${path}|${alias}]]`;
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(scene.path)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.pov] = withExtension(ada.path, "Ada");
        frontmatter[FRONTMATTER_KEYS.sceneCharacters] = [
          withExtension(ada.path, "Ada"),
        ];
      },
    );
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(project.projectFile)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.draft] =
          `[[${project.rootPath}/50_Manuscript/Draft.md]]`;
      },
    );

    // One report for the project, counting every link across its notes, rather
    // than the same one-time change raised against each note that has one.
    const damaged = await service.loadProject(project.projectFile);
    expect(damaged.structureIssues).toContainEqual(
      expect.objectContaining({
        code: "extension-in-link",
        path: project.rootPath,
        expected: "3",
        stepIds: [],
        canOpen: false,
        repairable: true,
      }),
    );
    // Reporting writes nothing.
    expect(
      (await service.readManagedFrontmatter(scene.path))[FRONTMATTER_KEYS.pov],
    ).toBe(withExtension(ada.path, "Ada"));

    const repaired = await service.repairMissingStructureItem(
      project.projectFile,
      project.rootPath,
    );

    const frontmatter = await service.readManagedFrontmatter(scene.path);
    expect(frontmatter[FRONTMATTER_KEYS.pov]).toBe(
      `[[${linkTarget(ada.path)}|Ada]]`,
    );
    expect(frontmatter[FRONTMATTER_KEYS.sceneCharacters]).toEqual([
      `[[${linkTarget(ada.path)}|Ada]]`,
    ]);
    expect(repaired.links.draft).toBe(`${project.rootPath}/50_Manuscript/Draft.md`);
    expect(repaired.scenes[0]?.characters).toEqual([ada.path]);
    expect(repaired.structureIssues).toEqual([]);
  });

  it("leaves a point-of-view mode and an already-tidy link alone", async () => {
    const project = await service.createProject({ name: "Nothing to tidy" });
    const ada = await service.createCharacter(project, { name: "Ada", type: "major" });
    await service.createScene(project, {
      title: "Arrival",
      povPath: SCENE_POV_MULTIPLE,
      characters: [ada.path],
    });

    const snapshot = await service.loadProject(project.projectFile);

    expect(snapshot.structureIssues).toEqual([]);
  });

  // A path typed into the property editor is stored as plain text. It reaches
  // the note, so everything looks well -- but Obsidian only rewrites links it
  // can see, so the next rename leaves it pointing at where the note used to be.
  it("reports a path stored as plain text instead of a wikilink", async () => {
    const project = await service.createProject({ name: "Typed out" });
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(project.projectFile)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.draft] =
          `${project.rootPath}/50_Manuscript/Draft`;
      },
    );

    const damaged = await service.loadProject(project.projectFile);

    // It still reaches the draft, which is exactly why it needs saying.
    expect(damaged.links.draft).toBe(`${project.rootPath}/50_Manuscript/Draft.md`);
    expect(damaged.structureIssues).toContainEqual(
      expect.objectContaining({
        code: "unlinked-path",
        path: project.projectFile,
        expected: "Draft",
        repairable: true,
      }),
    );

    await service.repairMissingStructureItem(
      project.projectFile,
      project.projectFile,
    );

    expect(
      (await service.readManagedFrontmatter(project.projectFile))[
        FRONTMATTER_KEYS.draft
      ],
    ).toBe(`[[${project.rootPath}/50_Manuscript/Draft|Draft]]`);
    expect(
      (await service.loadProject(project.projectFile)).structureIssues,
    ).toEqual([]);
  });

  it("reports a scene cast entry stored as plain text instead of a wikilink", async () => {
    const project = await service.createProject({ name: "Typed cast" });
    const ada = await service.createCharacter(project, { name: "Ada", type: "major" });
    const scene = await service.createScene(project, {
      title: "Arrival",
      povPath: ada.path,
      characters: [ada.path],
    });
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(scene.path)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.sceneCharacters] = [ada.path];
        frontmatter[FRONTMATTER_KEYS.pov] = ada.path;
      },
    );

    const damaged = await service.loadProject(project.projectFile);
    expect(damaged.structureIssues).toContainEqual(
      expect.objectContaining({
        code: "unlinked-path",
        path: scene.path,
        expected: "Ada",
        repairable: true,
      }),
    );

    await service.repairMissingStructureItem(project.projectFile, scene.path);
    const frontmatter = await service.readManagedFrontmatter(scene.path);

    expect(frontmatter[FRONTMATTER_KEYS.pov]).toBe(
      `[[${linkTarget(ada.path)}|Ada]]`,
    );
    expect(frontmatter[FRONTMATTER_KEYS.sceneCharacters]).toEqual([
      `[[${linkTarget(ada.path)}|Ada]]`,
    ]);
    expect(
      (await service.loadProject(project.projectFile)).structureIssues,
    ).toEqual([]);
  });

  // A point-of-view mode is plain text on purpose and must never be reported.
  it("leaves a point-of-view mode as the plain text it is meant to be", async () => {
    const project = await service.createProject({ name: "Omniscient" });
    await service.createScene(project, {
      title: "Arrival",
      povPath: SCENE_POV_OMNISCIENT,
    });

    expect(
      (await service.loadProject(project.projectFile)).structureIssues,
    ).toEqual([]);
  });

  // Obsidian shortens a link to a bare file name while that name is the only
  // one of its kind, and a project made later with a character of the same name
  // makes the link ambiguous without either note being touched. Obsidian then
  // answers with whichever it reaches first, which is how one project's scene
  // comes to name another project's character.
  it("keeps a shortened cast link on its own project's character", async () => {
    const first = await service.createProject({ name: "First" });
    const eve = await service.createCharacter(first, { name: "Eve", type: "major" });
    const scene = await service.createScene(first, {
      title: "Arrival",
      characters: [eve.path],
    });
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(scene.path)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.sceneCharacters] = ["[[Eve|Eve]]"];
        frontmatter[FRONTMATTER_KEYS.pov] = "[[Eve|Eve]]";
      },
    );

    // The second project's Eve is the one a Vault-wide lookup finds first.
    const second = await service.createProject({ name: "Second" });
    const stranger = await service.createCharacter(second, {
      name: "Eve",
      type: "major",
    });
    expect(stranger.path).not.toBe(eve.path);

    const reloaded = await service.loadProject(first.projectFile);

    expect(reloaded.scenes[0]?.characters).toEqual([eve.path]);
    expect(reloaded.scenes[0]?.povPath).toBe(eve.path);

    // Reading it correctly is not enough: clicking the link, the backlinks and
    // the graph all follow Obsidian to the other project, so it is reported.
    expect(reloaded.structureIssues).toContainEqual(
      expect.objectContaining({
        code: "incomplete-link",
        path: scene.path,
        expected: "Eve",
        repairable: true,
      }),
    );

    await service.repairMissingStructureItem(first.projectFile, scene.path);
    const frontmatter = await service.readManagedFrontmatter(scene.path);

    expect(frontmatter[FRONTMATTER_KEYS.sceneCharacters]).toEqual([
      `[[${linkTarget(eve.path)}|Eve]]`,
    ]);
    expect(frontmatter[FRONTMATTER_KEYS.pov]).toBe(
      `[[${linkTarget(eve.path)}|Eve]]`,
    );
    expect((await service.loadProject(first.projectFile)).structureIssues).toEqual([]);
  });

  // A namesake elsewhere never stands in for the character this project lost.
  // The link now opens the other project's note, which is what it is told: the
  // one thing it must not be called is "gone", when clicking it lands on a note.
  it("calls a cast link a namesake elsewhere answers a link into another project", async () => {
    const first = await service.createProject({ name: "Only" });
    const eve = await service.createCharacter(first, { name: "Eve", type: "major" });
    const scene = await service.createScene(first, {
      title: "Arrival",
      characters: [eve.path],
      povPath: eve.path,
    });
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(scene.path)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.sceneCharacters] = ["[[Eve|Eve]]"];
      },
    );
    fakeVault.delete(eve.path);
    const elsewhere = await service.createProject({ name: "Elsewhere" });
    const stranger = await service.createCharacter(elsewhere, {
      name: "Eve",
      type: "major",
    });

    const damaged = await service.loadProject(first.projectFile);

    expect(damaged.structureIssues).toContainEqual(
      expect.objectContaining({
        code: "foreign-link",
        path: scene.path,
        expected: "Eve",
        repairable: true,
      }),
    );

    await service.repairMissingStructureItem(first.projectFile, scene.path);
    const frontmatter = await service.readManagedFrontmatter(scene.path);

    expect(frontmatter[FRONTMATTER_KEYS.sceneCharacters]).toEqual([]);
    // The other project keeps its own character; only the list entry went.
    expect(fakeVault.getFileByPath(stranger.path)).not.toBeNull();
  });

  it("calls a cast link nothing at all answers a link to a note that is gone", async () => {
    const project = await service.createProject({ name: "Vanished" });
    const eve = await service.createCharacter(project, { name: "Eve", type: "major" });
    const scene = await service.createScene(project, {
      title: "Arrival",
      characters: [eve.path],
      povPath: SCENE_POV_MULTIPLE,
    });
    fakeVault.delete(eve.path);

    const damaged = await service.loadProject(project.projectFile);

    expect(damaged.structureIssues).toContainEqual(
      expect.objectContaining({
        code: "missing-link",
        path: scene.path,
        expected: "Eve",
        repairable: true,
      }),
    );

    await service.repairMissingStructureItem(project.projectFile, scene.path);

    expect(
      (await service.readManagedFrontmatter(scene.path))[
        FRONTMATTER_KEYS.sceneCharacters
      ],
    ).toEqual([]);
  });

  // Each kind of name is reported under its own code, because the sentence the
  // checker shows has to name the thing and say where that name is changed.
  it("reports a drifted scene name under the code for a scene", async () => {
    const project = await service.createProject({ name: "Scene drift" });
    const scene = await service.createScene(project, "Meeting");
    const moved = `${project.rootPath}/40_Scene/Renamed Outside.md`;
    await service.repository.renameFile(scene.path, moved);

    const damaged = await service.loadProject(project.projectFile);

    expect(damaged.structureIssues).toContainEqual(
      expect.objectContaining({
        code: "mismatched-scene-title",
        path: moved,
        expected: "Meeting",
        stepIds: [8, 9],
        repairable: true,
      }),
    );

    await service.repairMissingStructureItem(project.projectFile, moved);
    const repaired = await service.loadProject(project.projectFile);

    expect(repaired.scenes[0]?.path).toBe(scene.path);
    expect(repaired.structureIssues).toEqual([]);
  });

  it("reports a project folder renamed outside the plugin and renames it back", async () => {
    const project = await service.createProject({ name: "Chosen Name" });
    // What renaming the folder in Obsidian's file explorer does, and no more:
    // the folder moves and the stored name is left behind.
    fakeVault.rename(project.rootPath, "Snowflake Projects/Typed In A Hurry");
    const movedFile = "Snowflake Projects/Typed In A Hurry/00_System/001_Project_Metadata.md";

    const damaged = await service.loadProject(movedFile);
    expect(damaged.title).toBe("Chosen Name");
    expect(damaged.structureIssues).toContainEqual(
      expect.objectContaining({
        code: "mismatched-project-folder",
        path: "Snowflake Projects/Typed In A Hurry",
        expected: "Chosen Name",
        canOpen: false,
        repairable: true,
      }),
    );

    const repaired = await service.repairMissingStructureItem(
      movedFile,
      "Snowflake Projects/Typed In A Hurry",
    );

    expect(repaired.rootPath).toBe("Snowflake Projects/Chosen Name");
    expect(repaired.title).toBe("Chosen Name");
    expect(repaired.structureIssues).toEqual([]);
    expect(fakeVault.getAbstractFileByPath("Snowflake Projects/Typed In A Hurry")).toBeNull();
  });

  it("leaves a project alone in the numbered folder its name had to take", async () => {
    await fakeVault.seedFile("Snowflake Projects/Taken/note.md", "Not a project");
    const project = await service.createProject({ name: "Taken" });

    expect(project.rootPath).toBe("Snowflake Projects/Taken (2)");
    expect(project.structureIssues).toEqual([]);
  });

  it("reports a project folder it cannot rename without offering the repair", async () => {
    const project = await service.createProject({ name: "Blocked" });
    fakeVault.rename(project.rootPath, "Snowflake Projects/Elsewhere");
    await fakeVault.seedFile("Snowflake Projects/Blocked/note.md", "In the way");

    const damaged = await service.loadProject(
      "Snowflake Projects/Elsewhere/00_System/001_Project_Metadata.md",
    );

    expect(damaged.structureIssues).toContainEqual(
      expect.objectContaining({
        code: "mismatched-project-folder",
        repairable: false,
      }),
    );
  });

  it("reports a heading edited on its own and restores it", async () => {
    const project = await service.createProject({ name: "Heading Drift" });
    const character = await service.createCharacter(project, "Bob");
    const before = fakeVault.contents.get(character.path) ?? "";
    fakeVault.contents.set(before ? character.path : "", "");
    fakeVault.contents.set(character.path, before.replace("# Bob", "# Bobby"));

    const damaged = await service.loadProject(project.projectFile);

    expect(damaged.structureIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "mismatched-character-title",
          path: character.path,
          expected: "Bob",
          repairable: true,
        }),
      ]),
    );

    await service.repairMissingStructureItem(project.projectFile, character.path);

    expect(fakeVault.contents.get(character.path)).toContain("# Bob");
    expect(fakeVault.contents.get(character.path)).not.toContain("# Bobby");
  });

  it("restores the heading as well as the file name in one repair", async () => {
    const project = await service.createProject({ name: "Both Drift" });
    const scene = await service.createScene(project, "Arrival");
    const moved = `${project.rootPath}/40_Scene/Something Else.md`;
    const before = fakeVault.contents.get(scene.path) ?? "";
    fakeVault.contents.set(scene.path, before.replace("# Arrival", "# Something Else"));
    await service.repository.renameFile(scene.path, moved);

    await service.repairMissingStructureItem(project.projectFile, moved);

    // The earlier repair renamed the file but left the heading behind.
    expect(fakeVault.getFileByPath(scene.path)).not.toBeNull();
    expect(fakeVault.contents.get(scene.path)).toContain("# Arrival");
    expect(fakeVault.getFileByPath(moved)).toBeNull();
  });

  it("leaves a note that has no heading alone", async () => {
    const project = await service.createProject({ name: "No Heading" });
    const character = await service.createCharacter(project, "Bob");
    const stripped = (fakeVault.contents.get(character.path) ?? "").replace(
      "# Bob\n",
      "",
    );
    fakeVault.contents.set(character.path, stripped);

    const snapshot = await service.loadProject(project.projectFile);
    expect(snapshot.structureIssues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "mismatched-character-title" }),
      ]),
    );

    // A rename must not write a heading back into a note the author cleared.
    const renamed = await service.updateCharacter(project, character.characterId, {
      expectedRevision: (await service.listCharacters(project))[0]!.revision,
      name: "Robert",
    });
    expect(fakeVault.contents.get(renamed.path)).not.toMatch(/^# /mu);
  });

  it("scaffolds a character and scene base scoped to the new project", async () => {
    const project = await service.createProject({ name: "Bases" });
    const charactersBase = `${project.rootPath}/20_Character/Characters.base`;
    const scenesBase = `${project.rootPath}/40_Scene/Scenes.base`;

    expect(fakeVault.getFileByPath(charactersBase)).not.toBeNull();
    expect(fakeVault.getFileByPath(scenesBase)).not.toBeNull();
    expect(fakeVault.contents.get(charactersBase)).toContain(
      `note["snowflake-project-id"] == "${project.id}"`,
    );
    expect(fakeVault.contents.get(scenesBase)).toContain(
      `note["snowflake-scene-id"] != "${project.id}-template-scene"`,
    );
  });

  it("localizes the generated base filenames", async () => {
    const project = await service.createProject({ name: "基地", locale: "zh-CN" });

    expect(
      fakeVault.getFileByPath(`${project.rootPath}/20_角色/角色总览.base`),
    ).not.toBeNull();
    expect(
      fakeVault.getFileByPath(`${project.rootPath}/40_场景/场景总览.base`),
    ).not.toBeNull();
  });

  it("scaffolds the worldbuilding tree with per-kind definition files and kind bases", async () => {
    const project = await service.createProject({ name: "Worlds" });
    const worldbuilding = `${project.rootPath}/60_Worldbuilding`;

    for (const folder of ["61_Time", "62_Location", "63_Item"]) {
      expect(fakeVault.nodes.has(`${worldbuilding}/${folder}`)).toBe(true);
    }
    // Every entity kind owns its own set, in the folder its notes live in.
    // Only the character files arrive seeded; the roles are whole paths.
    const characterFolder = `${project.rootPath}/20_Character`;
    const category = fakeVault.contents.get(`${characterFolder}/21_Category.md`) ?? "";
    expect(category).toContain("# Major");
    expect(category).not.toContain("# Character");
    expect(category).not.toContain("# Item");
    expect(
      fakeVault.contents.get(`${characterFolder}/22_World_Status.md`),
    ).toContain("# Injured");
    expect(
      fakeVault.contents.get(`${characterFolder}/23_Relationship.md`),
    ).toContain("# Ally");
    // Each file is numbered after its own folder, and every kind but the
    // character one starts with an intro line and no headings.
    for (const [folder, prefix] of [
      [`${project.rootPath}/40_Scene`, "4"],
      [`${worldbuilding}/61_Time`, "61"],
      [`${worldbuilding}/62_Location`, "62"],
      [`${worldbuilding}/63_Item`, "63"],
    ] as const) {
      for (const [position, stem] of [
        [1, "Category"],
        [2, "World_Status"],
        [3, "Relationship"],
      ] as const) {
        const content =
          fakeVault.contents.get(`${folder}/${prefix}${position}_${stem}.md`) ?? "";
        expect(content.trim().length).toBeGreaterThan(0);
        expect(content).not.toContain("# ");
      }
    }
    // Nothing is left at the worldbuilding root, under either name.
    for (const fileName of ["Category.md", "61_Category.md", "World_Status.md"]) {
      expect(fakeVault.contents.has(`${worldbuilding}/${fileName}`)).toBe(false);
    }
    const timeBase = fakeVault.contents.get(`${worldbuilding}/61_Time/Time.base`) ?? "";
    expect(timeBase).toContain('note["snowflake-worldbuilding-kind"] == "time"');
    expect(timeBase).toContain(`note["snowflake-project-id"] == "${project.id}"`);
    expect(
      fakeVault.getFileByPath(`${worldbuilding}/62_Location/Location.base`),
    ).not.toBeNull();
    expect(
      fakeVault.getFileByPath(`${worldbuilding}/63_Item/Item.base`),
    ).not.toBeNull();

    const zh = await service.createProject({ name: "世界", locale: "zh-CN" });
    expect(
      fakeVault.contents.get(`${zh.rootPath}/20_角色/21_类别.md`),
    ).toContain("# 主角");
    expect(
      fakeVault.getFileByPath(`${zh.rootPath}/60_世界观/61_时间/611_类别.md`),
    ).not.toBeNull();
    expect(
      fakeVault.getFileByPath(`${zh.rootPath}/60_世界观/61_时间/时间总览.base`),
    ).not.toBeNull();
  });

  it("keeps an edited base when the project is repaired again", async () => {
    const project = await service.createProject({ name: "Edited Base" });
    const charactersBase = `${project.rootPath}/20_Character/Characters.base`;
    const customized = `${fakeVault.contents.get(charactersBase) ?? ""}  - type: cards\n    name: Gallery\n`;
    fakeVault.contents.set(charactersBase, customized);

    const repaired = await service.repairProject(project.rootPath);

    // Authors own the views and Obsidian rewrites the file on a column resize,
    // so only a missing base is a defect.
    expect(fakeVault.contents.get(charactersBase)).toBe(customized);
    expect(repaired.created).not.toContain(charactersBase);
    expect(repaired.unchanged).toContain(charactersBase);
  });

  it("recreates a base that was deleted", async () => {
    const project = await service.createProject({ name: "Deleted Base" });
    const scenesBase = `${project.rootPath}/40_Scene/Scenes.base`;
    const original = fakeVault.contents.get(scenesBase);
    fakeVault.delete(scenesBase);
    expect(fakeVault.getFileByPath(scenesBase)).toBeNull();

    const repaired = await service.repairProject(project.rootPath);

    expect(repaired.created).toContain(scenesBase);
    expect(fakeVault.contents.get(scenesBase)).toBe(original);
  });

  it("opens an existing base without rewriting it", async () => {
    const project = await service.createProject({ name: "Open Base" });
    const scenesBase = `${project.rootPath}/40_Scene/Scenes.base`;
    fakeVault.contents.set(scenesBase, "filters:\n  and: []\nviews: []\n");

    const path = await service.openProjectBase(project, "scenes");

    expect(path).toBe(scenesBase);
    expect(fakeVault.contents.get(scenesBase)).toBe(
      "filters:\n  and: []\nviews: []\n",
    );
  });

  it("reports a missing base and repairs it on request", async () => {
    const project = await service.createProject({ name: "Base Health" });
    const charactersBase = `${project.rootPath}/20_Character/Characters.base`;
    const scenesBase = `${project.rootPath}/40_Scene/Scenes.base`;
    const original = fakeVault.contents.get(charactersBase);
    fakeVault.delete(charactersBase);

    const damaged = await service.loadProject(project.projectFile);

    expect(damaged.structureIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-base",
          path: charactersBase,
          stepIds: [3, 5, 7],
          repairable: true,
        }),
      ]),
    );
    // The scene base is untouched, so it must not be reported.
    expect(damaged.structureIssues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-base", path: scenesBase }),
      ]),
    );

    const repaired = await service.repairMissingStructureItem(
      project.projectFile,
      charactersBase,
    );

    expect(fakeVault.contents.get(charactersBase)).toBe(original);
    expect(repaired.structureIssues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "missing-base" })]),
    );
  });

  it("reports no base issue for a healthy project", async () => {
    const project = await service.createProject({ name: "Healthy Bases" });

    const snapshot = await service.loadProject(project.projectFile);

    expect(snapshot.structureIssues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "missing-base" })]),
    );
  });

  it("writes a missing base when it is opened", async () => {
    const project = await service.createProject({ name: "Missing Base" });
    const charactersBase = `${project.rootPath}/20_Character/Characters.base`;
    fakeVault.delete(charactersBase);

    const path = await service.openProjectBase(project, "characters");

    expect(path).toBe(charactersBase);
    expect(fakeVault.contents.get(charactersBase)).toContain(
      `note["snowflake-project-id"] == "${project.id}"`,
    );
  });

  it("restores a base to the current template, and writes a missing one", async () => {
    const project = await service.createProject({ name: "Base restore" });
    const path = `${project.rootPath}/40_Scene/Scenes.base`;
    const pristine = fakeVault.contents.get(path);
    fakeVault.contents.set(path, "filters:\n  and: []\nviews: []\n");

    expect(await service.restoreProjectBase(project, "scenes")).toBe(path);
    expect(fakeVault.contents.get(path)).toBe(pristine);

    fakeVault.delete(path);
    expect(await service.restoreProjectBase(project, "scenes")).toBe(path);
    expect(fakeVault.contents.get(path)).toBe(pristine);
  });

  it("grows an open base with member properties it does not list yet", async () => {
    const project = await service.createProject({ name: "Base growth" });
    await service.createScene(project, {
      title: "Arrival",
      conflict: "The gate is shut.",
    });
    const path = await service.openProjectBase(project, "scenes");
    const created = fakeVault.contents.get(path) ?? "";
    expect(created).toContain("snowflake-conflict");

    // A property the author invents appears the next time the base opens.
    const [scene] = (await service.loadProject(project)).scenes;
    await service.repository.updateFrontmatter(scene!.path, { status: "draft" });
    await service.openProjectBase(project, "scenes");
    const grown = fakeVault.contents.get(path) ?? "";
    expect(grown).toContain("note.status");
    // Never the bookkeeping keys.
    expect(grown).not.toContain("note.snowflake-schema");
    expect(grown).not.toContain("note.snowflake-scene-id");

    // Opening again with nothing new leaves the file byte for byte, so an
    // author's own arrangement is never churned.
    const customized = `${grown}  - type: table\n    name: Mine\n    order:\n      - formula.scene\n    sort: []\n`;
    fakeVault.contents.set(path, customized);
    await service.openProjectBase(project, "scenes");
    expect(fakeVault.contents.get(path)).toBe(customized);

    // The next new key grows every view, the author's included.
    await service.repository.updateFrontmatter(scene!.path, { color: "red" });
    await service.openProjectBase(project, "scenes");
    const recolored = fakeVault.contents.get(path) ?? "";
    expect(recolored).toContain("note.color");
    expect(recolored).toContain("Mine");
  });

  it("reports a scene cast entry whose character note is gone, and drops only that entry", async () => {
    const project = await service.createProject({ name: "Dangling cast" });
    const kept = await service.createCharacter(project, { name: "Ada", type: "major" });
    const deleted = await service.createCharacter(project, { name: "Bram", type: "major" });
    const scene = await service.createScene(project, {
      title: "Arrival",
      characters: [kept.path, deleted.path],
      povPath: kept.path,
      conflict: "A standoff",
    });

    const bodyBeforeRepair = parseMarkdownFrontmatter(
      fakeVault.contents.get(scene.path) ?? "",
    ).body;

    fakeVault.delete(deleted.path);
    const damaged = await service.loadProject(project.projectFile);

    expect(damaged.structureIssues).toContainEqual(
      expect.objectContaining({
        code: "missing-link",
        path: scene.path,
        expected: "Bram",
        stepIds: [8, 9],
        repairable: true,
      }),
    );

    await service.repairMissingStructureItem(project.projectFile, scene.path);
    const frontmatter = await service.readManagedFrontmatter(scene.path);

    // The surviving cast member and every other field are left untouched.
    expect(frontmatter[FRONTMATTER_KEYS.sceneCharacters]).toEqual([
      expect.stringContaining(linkTarget(kept.path)),
    ]);
    expect(frontmatter[FRONTMATTER_KEYS.pov]).toContain(linkTarget(kept.path));
    expect(frontmatter[FRONTMATTER_KEYS.sceneTitle]).toBe("Arrival");
    // The repair touches frontmatter only; the scene's prose is not rewritten.
    expect(
      parseMarkdownFrontmatter(fakeVault.contents.get(scene.path) ?? "").body,
    ).toBe(bodyBeforeRepair);

    const repaired = await service.loadProject(project.projectFile);
    expect(repaired.structureIssues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-link" }),
      ]),
    );
  });

  it("reports a scene point of view whose character is gone but never picks a replacement", async () => {
    const project = await service.createProject({ name: "Dangling pov" });
    const pov = await service.createCharacter(project, { name: "Ada", type: "major" });
    const scene = await service.createScene(project, {
      title: "Arrival",
      povPath: pov.path,
    });

    fakeVault.delete(pov.path);
    const damaged = await service.loadProject(project.projectFile);

    expect(damaged.structureIssues).toContainEqual(
      expect.objectContaining({
        code: "dangling-scene-pov",
        path: scene.path,
        expected: "Ada",
        canOpen: true,
        repairable: false,
      }),
    );
  });

  it("leaves a scene alone while its cast and point of view still resolve", async () => {
    const project = await service.createProject({ name: "Intact links" });
    const character = await service.createCharacter(project, { name: "Ada", type: "major" });
    await service.createScene(project, {
      title: "Arrival",
      characters: [character.path],
      povPath: character.path,
    });

    const snapshot = await service.loadProject(project.projectFile);

    expect(
      snapshot.structureIssues.filter(
        (issue) =>
          issue.code === "missing-link" ||
          issue.code === "dangling-scene-pov",
      ),
    ).toEqual([]);
  });

  it("treats an omniscient or multiple point of view as a mode, not a broken link", async () => {
    const project = await service.createProject({ name: "Pov modes" });
    const scene = await service.createScene(project, { title: "Arrival" });

    const snapshot = await service.loadProject(project.projectFile);
    const sceneIssues = snapshot.structureIssues.filter(
      (issue) => issue.path === scene.path,
    );

    expect(sceneIssues).toEqual([]);
  });

  it("drops a deleted character from every scene cast but leaves points of view alone", async () => {
    const project = await service.createProject({ name: "Cast cleanup" });
    const doomed = await service.createCharacter(project, { name: "Bram", type: "major" });
    const kept = await service.createCharacter(project, { name: "Ada", type: "major" });
    const castScene = await service.createScene(project, {
      title: "Arrival",
      characters: [doomed.path, kept.path],
      povPath: kept.path,
    });
    const povScene = await service.createScene(project, {
      title: "Departure",
      characters: [doomed.path],
      povPath: doomed.path,
    });

    await service.removeCharacterFromScenes(project.projectFile, doomed.path);

    const castFrontmatter = await service.readManagedFrontmatter(castScene.path);
    const povFrontmatter = await service.readManagedFrontmatter(povScene.path);

    // The cast loses only the deleted character; the survivor stays.
    expect(castFrontmatter[FRONTMATTER_KEYS.sceneCharacters]).toEqual([
      expect.stringContaining(linkTarget(kept.path)),
    ]);
    expect(povFrontmatter[FRONTMATTER_KEYS.sceneCharacters]).toEqual([]);
    // The point of view is the author's decision, so it is left broken on purpose
    // for the health check to report.
    expect(povFrontmatter[FRONTMATTER_KEYS.pov]).toContain(linkTarget(doomed.path));
    expect(castFrontmatter[FRONTMATTER_KEYS.pov]).toContain(linkTarget(kept.path));
  });

  // Renaming a project renames its folder, which sets Obsidian rewriting every
  // link inside it. What it writes back carries no ".md" and is shortened to
  // whatever tail of the path is unambiguous -- often the file name alone. A
  // scene holds its cast as character paths, so a cast read straight from that
  // text matches no character the project has, and the scene form drops the
  // whole cast the next time it opens.
  const shorten = (path: string): string =>
    `[[${path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/u, "")}]]`;

  it("reads a scene cast Obsidian shortened back to the characters it names", async () => {
    const project = await service.createProject({ name: "Shortened cast" });
    const pov = await service.createCharacter(project, { name: "Ada", type: "major" });
    const supporting = await service.createCharacter(project, {
      name: "Bram",
      type: "supporting",
    });
    const scene = await service.createScene(project, {
      title: "Arrival",
      povPath: pov.path,
      characters: [pov.path, supporting.path],
    });
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(scene.path)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.pov] = shorten(pov.path);
        frontmatter[FRONTMATTER_KEYS.sceneCharacters] = [
          shorten(pov.path),
          shorten(supporting.path),
        ];
      },
    );

    const [reloaded] = await service.listScenes(project.projectFile);

    expect(reloaded?.povPath).toBe(pov.path);
    expect(reloaded?.characters).toEqual([pov.path, supporting.path]);
  });

  it("refreshes a shortened link when the character it names is renamed", async () => {
    const project = await service.createProject({ name: "Shortened rename" });
    const character = await service.createCharacter(project, {
      name: "Bob",
      type: "major",
    });
    const scene = await service.createScene(project, {
      title: "Meeting",
      povPath: character.path,
      characters: [character.path],
    });
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(scene.path)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.pov] = shorten(character.path);
        frontmatter[FRONTMATTER_KEYS.sceneCharacters] = [shorten(character.path)];
      },
    );

    const renamed = await service.updateCharacter(project, character.characterId, {
      expectedRevision: character.revision,
      name: "Robert",
    });
    const [reloaded] = await service.listScenes(project.projectFile);

    expect(reloaded?.povPath).toBe(renamed.path);
    expect(reloaded?.characters).toEqual([renamed.path]);
    const frontmatter = await service.readManagedFrontmatter(scene.path);
    expect(frontmatter[FRONTMATTER_KEYS.pov]).toContain("Robert");
  });

  it("drops a shortened link from a cast when the character it names is deleted", async () => {
    const project = await service.createProject({ name: "Shortened delete" });
    const doomed = await service.createCharacter(project, { name: "Bram", type: "major" });
    const kept = await service.createCharacter(project, { name: "Ada", type: "major" });
    const scene = await service.createScene(project, {
      title: "Arrival",
      povPath: kept.path,
      characters: [doomed.path, kept.path],
    });
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(scene.path)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.sceneCharacters] = [
          shorten(doomed.path),
          shorten(kept.path),
        ];
      },
    );

    fakeVault.delete(doomed.path);
    await service.removeCharacterFromScenes(project.projectFile, doomed.path);

    const frontmatter = await service.readManagedFrontmatter(scene.path);
    expect(frontmatter[FRONTMATTER_KEYS.sceneCharacters]).toEqual([
      shorten(kept.path),
    ]);
  });

  const statusRecord = (heading: string): RecordLine => ({
    label: { path: "Def/World_Status", heading, display: heading },
    target: null,
    location: null,
    time: null,
  });

  const relationRecord = (heading: string, target: string): RecordLine => ({
    label: { path: "Def/Relationship", heading, display: heading },
    target: { kind: "link", path: target, name: target.split("/").pop() ?? target },
    location: null,
    time: null,
  });

  it("creates a worldbuilding entity with its frontmatter, callout, and records", async () => {
    const project = await service.createProject({ name: "Worlds CRUD" });
    const start = await service.createEntity(project, {
      kind: "time",
      name: "1024-03",
      timeKind: "point",
    });
    const famine = await service.createEntity(project, {
      kind: "time",
      name: "The Long Famine",
      timeKind: "period",
      timeStart: `[[${linkTarget(start.path)}]]`,
      timeEnd: "[[1024-06]]",
      description: "Three hungry months.",
      aliases: ["The Hunger"],
      categoryPaths: ["Time/Era"],
      worldStatus: [statusRecord("Ongoing")],
    });

    expect(famine.path).toContain("60_Worldbuilding/61_Time/");
    expect(famine.kind).toBe("time");
    expect(famine.timeKind).toBe("period");
    expect(famine.aliases).toEqual(["The Hunger"]);
    expect(famine.categories).toEqual([
      expect.stringContaining("Category#Era|Time/Era"),
    ]);
    expect(famine.worldStatus).toHaveLength(1);

    const content = fakeVault.contents.get(famine.path) ?? "";
    const frontmatter = parseMarkdownFrontmatter(content).frontmatter;
    expect(frontmatter[FRONTMATTER_KEYS.schema]).toBe(SCHEMA_VERSION);
    expect(frontmatter[FRONTMATTER_KEYS.document]).toBe("worldbuilding");
    expect(frontmatter[FRONTMATTER_KEYS.worldbuildingKind]).toBe("time");
    expect(frontmatter["aliases"]).toEqual(["The Hunger"]);
    const block = readMarkedSection(content, "entity-fields");
    expect(block).toContain("> [!info] Time overview");
    expect(block).toContain("> **Type**: Period");
    expect(block).toContain("> **Start**: ");
    expect(block).toContain("> **Description**: Three hungry months.");
    expect(readMarkedSection(content, "world-status")).toContain(
      "- [[Def/World_Status#Ongoing|Ongoing]]",
    );
    expect(content).toContain("## World Status");
    // Empty record sections stay deferred out of the note.
    expect(content).not.toContain("snowflake:section:relationships");

    const snapshot = await service.loadProject(project.projectFile);
    expect(snapshot.worldbuilding.time.map((entity) => entity.name)).toEqual([
      "1024-03",
      "The Long Famine",
    ]);
    expect(snapshot.worldbuilding.location).toEqual([]);
  });

  it("requires both ends of a period, or neither", async () => {
    const project = await service.createProject({ name: "Half period" });
    await expect(
      service.createEntity(project, {
        kind: "time",
        name: "Broken",
        timeKind: "period",
        timeStart: "[[Somewhere]]",
      }),
    ).rejects.toThrow(/both its start and its end/u);
  });

  it("updates entity records and removes an emptied record section", async () => {
    const project = await service.createProject({ name: "Entity update" });
    const keep = await service.createEntity(project, {
      kind: "location",
      name: "Royal Capital",
      worldStatus: [statusRecord("Standing")],
    });

    const emptied = await service.updateEntity(project, keep.entityId, {
      expectedRevision: keep.revision,
      worldStatus: [],
      relationships: [relationRecord("Ally", "Elf Kingdom")],
      description: "The seat of the crown.",
    });
    const content = fakeVault.contents.get(emptied.path) ?? "";
    expect(content).not.toContain("snowflake:section:world-status");
    expect(content).not.toContain("## World Status");
    expect(readMarkedSection(content, "relationships")).toContain(
      "-> [[Elf Kingdom]]",
    );
    expect(readMarkedSection(content, "entity-fields")).toContain(
      "> **Description**: The seat of the crown.",
    );
    expect(emptied.worldStatus).toEqual([]);
    expect(emptied.relationships).toHaveLength(1);

    await expect(
      service.updateEntity(project, keep.entityId, {
        expectedRevision: keep.revision,
        description: "stale",
      }),
    ).rejects.toThrow(ConcurrentChangeError);
  });

  it("renames an entity and follows the time links other notes store", async () => {
    const project = await service.createProject({ name: "Entity rename" });
    const point = await service.createEntity(project, {
      kind: "time",
      name: "Year 1023",
      timeKind: "point",
    });
    const era = await service.createEntity(project, {
      kind: "time",
      name: "The Silver Era",
      timeKind: "period",
      timeStart: `[[${linkTarget(point.path)}|Year 1023]]`,
      timeEnd: `[[${linkTarget(point.path)}|Year 1023]]`,
    });

    const renamed = await service.updateEntity(project, point.entityId, {
      expectedRevision: point.revision,
      name: "Imperial Year 1023",
    });
    expect(renamed.name).toBe("Imperial Year 1023");
    expect(renamed.path).toContain("Imperial Year 1023.md");
    const eraFrontmatter = parseMarkdownFrontmatter(
      fakeVault.contents.get(era.path) ?? "",
    ).frontmatter;
    // The alias matches the note name, so the normalized link drops it.
    expect(eraFrontmatter[FRONTMATTER_KEYS.timeStart]).toBe(
      `[[${linkTarget(renamed.path)}]]`,
    );
    expect(eraFrontmatter[FRONTMATTER_KEYS.timeEnd]).toBe(
      `[[${linkTarget(renamed.path)}]]`,
    );
  });

  it("keeps a character's age and records in their sections", async () => {
    const project = await service.createProject({ name: "Character records" });
    const ada = await service.createCharacter(project, {
      name: "Ada",
      type: "major",
      age: {
        property: "age",
        value: { kind: "text", text: "23" },
        location: null,
        time: null,
      },
      worldStatus: [statusRecord("Missing")],
    });
    const created = fakeVault.contents.get(ada.path) ?? "";
    expect(created).toContain("## Details");
    expect(readMarkedSection(created, "details")).toBe("- **Age**: 23");
    expect(readMarkedSection(created, "world-status")).toContain("Missing");
    expect(ada.details).toHaveLength(1);

    const cleared = await service.updateCharacter(project, ada.characterId, {
      expectedRevision: ada.revision,
      age: null,
      worldStatus: [],
      relationships: [relationRecord("Enemy", "Demon Empire")],
    });
    const content = fakeVault.contents.get(cleared.path) ?? "";
    expect(content).not.toContain("snowflake:section:details");
    expect(content).not.toContain("## Details");
    expect(content).not.toContain("snowflake:section:world-status");
    expect(readMarkedSection(content, "relationships")).toContain(
      "[[Def/Relationship#Enemy|Enemy]] -> [[Demon Empire]]",
    );
    expect(cleared.details).toEqual([]);
    expect(cleared.relationships).toHaveLength(1);
  });

  it("keeps the category picker's list and the role link together", async () => {
    const project = await service.createProject({ name: "Category picker" });
    const ada = await service.createCharacter(project, {
      name: "Ada",
      type: "major",
      categoryPaths: ["Race/Elf"],
    });
    // Category links point into the character kind's own file, and the role
    // is a whole path there.
    expect(ada.categories).toEqual([
      expect.stringContaining("20_Character/21_Category#Major|Major]]"),
      expect.stringContaining("20_Character/21_Category#Elf|Race/Elf]]"),
    ]);

    const repicked = await service.updateCharacter(project, ada.characterId, {
      expectedRevision: ada.revision,
      type: "supporting",
      categoryPaths: ["Gender/Female"],
    });
    expect(repicked.type).toBe("supporting");
    expect(repicked.categories).toEqual([
      expect.stringContaining("|Supporting]]"),
      expect.stringContaining("|Gender/Female]]"),
    ]);
  });

  it("scopes definition vocabularies to the kind that owns the file", async () => {
    const project = await service.createProject({ name: "Scoped vocab" });

    // A path added for one kind lands in that kind's file and nowhere else.
    const added = await service.addDefinitionPath(
      project,
      "item",
      "world-status",
      "Cursed",
    );
    expect(added.ok).toBe(true);
    expect(
      await service.listDefinitionPaths(project, "item", "world-status"),
    ).toEqual(["Cursed"]);
    expect(
      await service.listDefinitionPaths(project, "character", "world-status"),
    ).toEqual(["Injured", "Missing", "Deceased"]);

    // Heading uniqueness holds per file, so two kinds may share a name.
    for (const kind of ["location", "item"] as const) {
      const result = await service.addDefinitionPath(
        project,
        kind,
        "category",
        "Origin",
      );
      expect(result.ok).toBe(true);
    }
    expect(await service.listDefinitionPaths(project, "location", "category")).toEqual([
      "Origin",
    ]);
    expect(await service.listDefinitionPaths(project, "item", "category")).toEqual([
      "Origin",
    ]);
  });

  it("stamps schema 2 across the project when migrating and restores the worldbuilding tree", async () => {
    const project = await service.createProject({ name: "Schema stamp" });
    const ada = await service.createCharacter(project, { name: "Ada", type: "major" });
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(ada.path)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.schema] = 1;
        frontmatter[FRONTMATTER_KEYS.characterType] = "major";
        delete frontmatter[FRONTMATTER_KEYS.category];
      },
    );
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(project.projectFile)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.schema] = 1;
      },
    );
    fakeVault.delete(`${project.rootPath}/20_Character/21_Category.md`);
    // The system templates are stamped too, so a migrated project is not
    // left with a page of repairable template flags.
    const templatePath = `${project.rootPath}/00_System/011_Template_One_Sentence_Summary.md`;
    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(templatePath)!,
      (frontmatter) => {
        frontmatter[FRONTMATTER_KEYS.schema] = 1;
      },
    );

    const result = await service.migrateMemberNotes(project.projectFile);
    expect(result.skipped).toBe(0);

    const templateFrontmatter = parseMarkdownFrontmatter(
      fakeVault.contents.get(templatePath) ?? "",
    ).frontmatter;
    expect(templateFrontmatter[FRONTMATTER_KEYS.schema]).toBe(SCHEMA_VERSION);
    const migratedSnapshot = await service.loadProject(project.projectFile);
    expect(migratedSnapshot.structureIssues).toEqual([]);

    const characterFrontmatter = parseMarkdownFrontmatter(
      fakeVault.contents.get(ada.path) ?? "",
    ).frontmatter;
    expect(characterFrontmatter[FRONTMATTER_KEYS.schema]).toBe(SCHEMA_VERSION);
    expect(characterFrontmatter[FRONTMATTER_KEYS.characterType]).toBeUndefined();
    expect(characterFrontmatter[FRONTMATTER_KEYS.category]).toEqual([
      expect.stringContaining("20_Character/21_Category#Major|Major]]"),
    ]);
    const projectFrontmatter = await service.readManagedFrontmatter(project.projectFile);
    expect(projectFrontmatter[FRONTMATTER_KEYS.schema]).toBe(SCHEMA_VERSION);
    expect(
      fakeVault.contents.get(`${project.rootPath}/20_Character/21_Category.md`),
    ).toContain("# Major");
  });
});
