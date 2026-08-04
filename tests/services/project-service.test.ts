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
  FRONTMATTER_KEYS,
  ProjectCreationInterruptedError,
  SnowflakeProjectService,
  type ProjectSnapshot,
} from "../../src/services";
import { getSystemTemplates, readMarkedSection } from "../../src/templates";
import { createFakeEnvironment, type FakeFileManager, type FakeVault } from "../helpers/fake-vault";

const STEP_ONE_RELATIVE_PATH = "10_Summary/11_One_Sentence_Summary.md";

describe("SnowflakeProjectService", () => {
  let fakeVault: FakeVault;
  let fakeFileManager: FakeFileManager;
  let service: SnowflakeProjectService;

  beforeEach(() => {
    const environment = createFakeEnvironment();
    fakeVault = environment.fakeVault;
    fakeFileManager = environment.fakeFileManager;
    service = new SnowflakeProjectService(environment.vault, environment.fileManager);
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
    expect(repaired.frontmatter[FRONTMATTER_KEYS.characterType]).toBe("major");

    await fakeFileManager.processFrontMatter(
      fakeVault.getFileByPath(character.path)!,
      (frontmatter) => {
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
    const second = await service.createProject({ name: "Novel" });
    expect(first.rootPath).toBe("Snowflake Projects/Novel");
    expect(second.rootPath).toBe("Snowflake Projects/Novel (2)");

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

  it("creates and discovers projects directly below the Vault root", async () => {
    const rootService = new SnowflakeProjectService(
      fakeVault.asVault(),
      fakeFileManager.asFileManager(),
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
    expect(characters[0]).toMatchObject({
      name: "Ada",
      type: "supporting",
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
    const duplicate = await service.createCharacter(project, "Ada", "supporting");
    expect(ada.path).toMatch(/20_Character\/Ada\.md$/u);
    expect(duplicate.path).toMatch(/20_Character\/Ada \(2\)\.md$/u);

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
      duplicate.characterId,
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
    const first = await service.createScene(project, { title: "First", conflict: "One" });
	expect(first.povPath).toBe(SCENE_POV_OMNISCIENT);
    const second = await service.createScene(project, {
      title: "Second",
      povPath: "People/Ada.md",
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
    expect(reordered[2]?.povPath).toBe("People/Ada.md");
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
    const scene = await service.createScene(project, {
      title: "Midnight meeting",
      time: "Midnight",
      location: "Old station",
      characters: ["People/Ada.md", "People/Lin.md"],
      conflict: "Ada must choose whom to trust.",
      povPath: "People/Ada.md",
      events: "A coded message arrives and the lights go out.",
    });

    expect(scene.time).toBe("Midnight");
    expect(scene.location).toBe("Old station");
    expect(scene.characters).toEqual(["People/Ada.md", "People/Lin.md"]);
    const sceneFrontmatter = parseMarkdownFrontmatter(
      fakeVault.contents.get(scene.path) ?? "",
    ).frontmatter;
    expect(sceneFrontmatter[FRONTMATTER_KEYS.sceneCharacters]).toEqual([
      "[[People/Ada.md|Ada]]",
      "[[People/Lin.md|Lin]]",
    ]);
    expect(sceneFrontmatter[FRONTMATTER_KEYS.pov]).toBe(
      "[[People/Ada.md|Ada]]",
    );
    expect(scene.conflict).toBe("Ada must choose whom to trust.");
    expect(scene.povPath).toBe("People/Ada.md");
    expect(scene.events).toBe("A coded message arrives and the lights go out.");
    expect(readMarkedSection(fakeVault.contents.get(scene.path) ?? "", "scene-conflict")).toBe(
      "Ada must choose whom to trust.",
    );
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
    expect(readMarkedSection(original, "scene-conflict")).toBe(
      "Ada cannot enter the city.",
    );
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
    expect(frontmatter[FRONTMATTER_KEYS.pov]).toBe(`[[${renamed.path}|Robert]]`);
    expect(frontmatter[FRONTMATTER_KEYS.sceneCharacters]).toEqual([
      `[[${renamed.path}|Robert]]`,
      `[[${alice.path}|Alice]]`,
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

  it("keeps a rename that collides with another note on a distinct file", async () => {
    const project = await service.createProject({ name: "Collision" });
    const alice = await service.createCharacter(project, "Alice");
    const bob = await service.createCharacter(project, "Bob");

    const renamed = await service.updateCharacter(project, bob.characterId, {
      expectedRevision: bob.revision,
      name: "Alice",
    });

    expect(renamed.path).toBe(`${project.rootPath}/20_Character/Alice (2).md`);
    expect(fakeVault.getFileByPath(alice.path)).not.toBeNull();
    expect(renamed.name).toBe("Alice");
  });

  it("accepts a numbered file name for a duplicated title", async () => {
    const project = await service.createProject({ name: "Duplicates" });
    await service.createCharacter(project, "Alice");
    await service.createCharacter(project, "Alice");

    const snapshot = await service.loadProject(project.projectFile);

    // Two characters may share a name, so the numbered file is not drift.
    expect(snapshot.structureIssues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "mismatched-note-title" }),
      ]),
    );
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
          code: "mismatched-note-title",
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
    ).toBe(`[[${character.path}|Bob]]`);
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
          code: "mismatched-note-title",
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
        expect.objectContaining({ code: "mismatched-note-title" }),
      ]),
    );

    // A rename must not write a heading back into a note the author cleared.
    const renamed = await service.updateCharacter(project, character.characterId, {
      expectedRevision: (await service.listCharacters(project))[0]!.revision,
      name: "Robert",
    });
    expect(fakeVault.contents.get(renamed.path)).not.toMatch(/^# /mu);
  });
});
