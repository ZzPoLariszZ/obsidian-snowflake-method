import type { FileManager, TAbstractFile, TFile, TFolder, Vault } from "obsidian";

export interface FakeFile extends TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  parent: FakeFolder | null;
}

export interface FakeFolder extends TFolder {
  path: string;
  name: string;
  parent: FakeFolder | null;
  children: Array<FakeFile | FakeFolder>;
}

export function normalizeFakePath(path: string): string {
  return path
    .replace(/\\/gu, "/")
    .replace(/\/{2,}/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/^\/+|\/+$/gu, "");
}

export function parseFakeYaml(source: string): unknown {
  const trimmed = source.trim();
  return trimmed ? JSON.parse(trimmed) : {};
}

export class FakeVault {
  readonly nodes = new Map<string, FakeFile | FakeFolder>();
  readonly contents = new Map<string, string>();
  readonly processCalls: string[] = [];
  readonly createCalls: string[] = [];
  failNextCreatePath: string | null = null;

  private readonly root: FakeFolder;

  constructor() {
    this.root = fakeFolder("", null);
    this.nodes.set("", this.root);
  }

  asVault(): Vault {
    return this as unknown as Vault;
  }

  getRoot(): TFolder {
    return this.root;
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return (this.nodes.get(normalizeFakePath(path)) as TAbstractFile | undefined) ?? null;
  }

  getFileByPath(path: string): TFile | null {
    const node = this.nodes.get(normalizeFakePath(path));
    return node && "extension" in node ? node : null;
  }

  async createFolder(path: string): Promise<TFolder> {
    const normalized = normalizeFakePath(path);
    if (this.nodes.has(normalized)) throw new Error(`Already exists: ${normalized}`);
    const parent = this.requireFolder(parentOf(normalized));
    const folder = fakeFolder(normalized, parent);
    parent.children.push(folder);
    this.nodes.set(normalized, folder);
    return folder;
  }

  async create(path: string, content: string): Promise<TFile> {
    const normalized = normalizeFakePath(path);
    if (this.failNextCreatePath === normalized) {
      this.failNextCreatePath = null;
      throw new Error(`Simulated create failure: ${normalized}`);
    }
    if (this.nodes.has(normalized)) throw new Error(`Already exists: ${normalized}`);
    const parent = this.requireFolder(parentOf(normalized));
    const file = fakeFile(normalized, parent);
    parent.children.push(file);
    this.nodes.set(normalized, file);
    this.contents.set(normalized, content);
    this.createCalls.push(normalized);
    return file;
  }

  async read(file: TFile): Promise<string> {
    const content = this.contents.get(file.path);
    if (content === undefined) throw new Error(`Missing content: ${file.path}`);
    return content;
  }

  async process(file: TFile, callback: (data: string) => string): Promise<string> {
    const current = await this.read(file);
    const next = callback(current);
    this.contents.set(file.path, next);
    this.processCalls.push(file.path);
    return next;
  }

  async seedFile(path: string, content: string): Promise<TFile> {
    await this.ensureFolders(parentOf(path));
    return this.create(path, content);
  }

  async ensureFolders(path: string): Promise<void> {
    const pieces = normalizeFakePath(path).split("/").filter(Boolean);
    let current = "";
    for (const piece of pieces) {
      current = current ? `${current}/${piece}` : piece;
      if (!this.nodes.has(current)) await this.createFolder(current);
    }
  }

  rename(oldPath: string, newPath: string): void {
    const oldNormalized = normalizeFakePath(oldPath);
    const newNormalized = normalizeFakePath(newPath);
    const node = this.nodes.get(oldNormalized);
    if (!node || oldNormalized.length === 0) throw new Error(`Missing file: ${oldNormalized}`);
    if (this.nodes.has(newNormalized)) throw new Error(`Already exists: ${newNormalized}`);
    const nextParent = this.requireFolder(parentOf(newNormalized));
    const moving = [...this.nodes.entries()]
      .filter(([path]) => path === oldNormalized || path.startsWith(`${oldNormalized}/`))
      .sort(([left], [right]) => left.length - right.length);

    if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node);
    nextParent.children.push(node);
    node.parent = nextParent;

    for (const [path] of moving) this.nodes.delete(path);
    for (const [path, movingNode] of moving) {
      const destination = `${newNormalized}${path.slice(oldNormalized.length)}`;
      const content = this.contents.get(path);
      this.contents.delete(path);
      movingNode.path = destination;
      movingNode.name = basename(destination);
      if ("extension" in movingNode) movingNode.basename = stem(destination);
      this.nodes.set(destination, movingNode);
      if (content !== undefined) this.contents.set(destination, content);
    }
  }

  delete(path: string): void {
    const normalized = normalizeFakePath(path);
    const node = this.nodes.get(normalized);
    if (!node) return;
    if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node);
    this.nodes.delete(normalized);
    this.contents.delete(normalized);
  }

  private requireFolder(path: string): FakeFolder {
    const node = this.nodes.get(normalizeFakePath(path));
    if (!node || !("children" in node)) throw new Error(`Missing folder: ${path}`);
    return node;
  }
}

export class FakeFileManager {
  readonly frontmatterCalls: string[] = [];
  readonly renameCalls: Array<{ from: string; to: string }> = [];
  readonly trashCalls: string[] = [];
  failNextFrontmatterPath: string | null = null;
  beforeNextFrontmatterProcess:
    | ((file: TFile) => void | Promise<void>)
    | null = null;

  constructor(readonly vault: FakeVault) {}

  asFileManager(): FileManager {
    return this as unknown as FileManager;
  }

  async processFrontMatter(
    file: TFile,
    callback: (frontmatter: Record<string, unknown>) => void,
  ): Promise<void> {
    if (this.failNextFrontmatterPath === file.path) {
      this.failNextFrontmatterPath = null;
      throw new Error(`Simulated frontmatter failure: ${file.path}`);
    }
    const beforeProcess = this.beforeNextFrontmatterProcess;
    this.beforeNextFrontmatterProcess = null;
    await beforeProcess?.(file);
    const current = await this.vault.read(file);
    const { frontmatter, body } = splitFrontmatter(current);
    callback(frontmatter);
    this.vault.contents.set(file.path, `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n${body}`);
    this.frontmatterCalls.push(file.path);
  }

  async renameFile(file: TAbstractFile, newPath: string): Promise<void> {
    const from = file.path;
    this.vault.rename(from, newPath);
    this.renameCalls.push({ from, to: normalizeFakePath(newPath) });
  }

  async trashFile(file: TAbstractFile): Promise<void> {
    this.trashCalls.push(file.path);
    this.vault.delete(file.path);
  }
}

export function createFakeEnvironment(): {
  fakeVault: FakeVault;
  fakeFileManager: FakeFileManager;
  vault: Vault;
  fileManager: FileManager;
} {
  const fakeVault = new FakeVault();
  const fakeFileManager = new FakeFileManager(fakeVault);
  return {
    fakeVault,
    fakeFileManager,
    vault: fakeVault.asVault(),
    fileManager: fakeFileManager.asFileManager(),
  };
}

function splitFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u.exec(content);
  if (!match) return { frontmatter: {}, body: content };
  const parsed = parseFakeYaml(match[1] ?? "");
  return {
    frontmatter:
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {},
    body: content.slice(match[0].length),
  };
}

function fakeFolder(path: string, parent: FakeFolder | null): FakeFolder {
  return {
    path,
    name: basename(path),
    parent,
    children: [],
    vault: {} as Vault,
    isRoot: () => path === "",
  };
}

function fakeFile(path: string, parent: FakeFolder): FakeFile {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return {
    path,
    name,
    basename: dot > 0 ? name.slice(0, dot) : name,
    extension: dot > 0 ? name.slice(dot + 1) : "",
    parent,
    vault: {} as Vault,
    stat: { ctime: 0, mtime: 0, size: 0 },
  };
}

function parentOf(path: string): string {
  const normalized = normalizeFakePath(path);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

function basename(path: string): string {
  const normalized = normalizeFakePath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function stem(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
