import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PROJECT_FILENAMES,
  createProject,
  deleteProject,
  listProjects,
  readProject,
} from "./project";

describe("project CRUD", () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), "resumake-projects-"));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it("create → read round-trips metadata and scaffolds the dir layout", async () => {
    const created = await createProject({
      name: "My Resume",
      provider: "openai",
      resumeTex: "\\documentclass{article}\\begin{document}hi\\end{document}",
      dataRoot,
    });

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.name).toBe("My Resume");
    expect(created.provider).toBe("openai");
    expect(created.currentVersion).toBe(0);
    expect(created.sessionToken).toBeNull();
    expect(() => new Date(created.createdAt).toISOString()).not.toThrow();

    const read = await readProject(created.id, dataRoot);
    expect(read).toEqual(created);

    const projectDir = join(dataRoot, "projects", created.id);
    await expect(
      access(join(projectDir, PROJECT_FILENAMES.meta)),
    ).resolves.toBeUndefined();
    await expect(
      access(join(projectDir, PROJECT_FILENAMES.versionsDir)),
    ).resolves.toBeUndefined();
    await expect(
      access(join(projectDir, PROJECT_FILENAMES.conversationsDir)),
    ).resolves.toBeUndefined();

    const tex = await readFile(
      join(projectDir, PROJECT_FILENAMES.resumeTex),
      "utf8",
    );
    expect(tex).toContain("\\documentclass{article}");
  });

  it("defaults provider to claude and generates a uuid id", async () => {
    const p = await createProject({ name: "X", dataRoot });
    expect(p.provider).toBe("claude");
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("honors an explicit id", async () => {
    const p = await createProject({ name: "X", id: "abc_123-XYZ", dataRoot });
    expect(p.id).toBe("abc_123-XYZ");
    expect(await readProject("abc_123-XYZ", dataRoot)).not.toBeNull();
  });

  it("rejects an unsafe projectId", async () => {
    await expect(
      createProject({ name: "X", id: "../escape", dataRoot }),
    ).rejects.toThrow(/Invalid projectId/);
  });

  it("refuses to create over an existing project", async () => {
    await createProject({ name: "X", id: "dup", dataRoot });
    await expect(
      createProject({ name: "Y", id: "dup", dataRoot }),
    ).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("readProject returns null for a missing project", async () => {
    expect(await readProject("nope", dataRoot)).toBeNull();
  });

  it("delete removes the project; idempotent on missing", async () => {
    await createProject({ name: "X", id: "todelete", dataRoot });
    expect(await readProject("todelete", dataRoot)).not.toBeNull();

    await deleteProject("todelete", dataRoot);
    expect(await readProject("todelete", dataRoot)).toBeNull();

    // Deleting again must not throw.
    await expect(deleteProject("todelete", dataRoot)).resolves.toBeUndefined();
  });

  it("list returns sorted ids of valid projects only", async () => {
    await createProject({ name: "B", id: "bbb", dataRoot });
    await createProject({ name: "A", id: "aaa", dataRoot });
    await createProject({ name: "C", id: "ccc", dataRoot });

    // A stray directory without project.json must be ignored.
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dataRoot, "projects", "junkdir"), { recursive: true });
    await writeFile(join(dataRoot, "projects", "junkdir", "note.txt"), "x");

    expect(await listProjects(dataRoot)).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("list returns [] when no projects dir exists yet", async () => {
    const empty = await mkdtemp(join(tmpdir(), "resumake-empty-"));
    try {
      expect(await listProjects(empty)).toEqual([]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("rejects corrupt project.json on read (Zod-validated boundary)", async () => {
    const p = await createProject({ name: "X", id: "corrupt", dataRoot });
    const metaPath = join(dataRoot, "projects", p.id, PROJECT_FILENAMES.meta);
    await writeFile(metaPath, JSON.stringify({ id: "corrupt" }));
    await expect(readProject("corrupt", dataRoot)).rejects.toThrow();
  });
});
