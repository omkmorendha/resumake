import { randomUUID } from "node:crypto";
import { readFile, readdir, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { atomicWrite, atomicWriteJson } from "./atomicWrite";
import {
  assertValidProjectId,
  getDataRoot,
  getProjectDir,
  getProjectsRoot,
} from "./paths";

/**
 * `project.json` — per spec §5. The LLM provider is recorded so a project can
 * be reopened with the same backend. `currentVersion` indexes `versions/`.
 */
export const ProjectMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.enum(["claude", "openai"]),
  createdAt: z.string(), // ISO-8601
  currentVersion: z.number().int().nonnegative(),
  sessionToken: z.string().nullable(),
});

export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;

export const PROJECT_FILENAMES = {
  meta: "project.json",
  resumeTex: "resume.tex",
  resumePdf: "resume.pdf",
  compileLog: "compile.log",
  jobposting: "jobposting.json",
  feedback: "feedback.json",
  versionsDir: "versions",
  versionsIndex: join("versions", "index.json"),
  conversationsDir: "conversations",
} as const;

export interface CreateProjectInput {
  name: string;
  provider?: ProjectMeta["provider"];
  /** Optional explicit id; otherwise a UUID is generated. */
  id?: string;
  /** Initial `resume.tex` contents, if known at creation. */
  resumeTex?: string;
  /** Override the data root (defaults to `getDataRoot()`). */
  dataRoot?: string;
}

/**
 * Create a new project directory with `project.json` (and optionally
 * `resume.tex`). Fails if the project already exists.
 */
export async function createProject(
  input: CreateProjectInput,
): Promise<ProjectMeta> {
  const dataRoot = input.dataRoot ?? getDataRoot();
  const id = input.id ?? randomUUID();
  assertValidProjectId(id);

  const dir = getProjectDir(id, dataRoot);

  // `mkdir` without recursive on the leaf fails (EEXIST) if the project dir is
  // already present — that's our "already exists" guard. Ensure the parents
  // exist first.
  await mkdir(getProjectsRoot(dataRoot), { recursive: true });
  await mkdir(dir); // throws EEXIST if the project already exists
  await mkdir(join(dir, PROJECT_FILENAMES.versionsDir), { recursive: true });
  await mkdir(join(dir, PROJECT_FILENAMES.conversationsDir), {
    recursive: true,
  });

  const meta: ProjectMeta = {
    id,
    name: input.name,
    provider: input.provider ?? "claude",
    createdAt: new Date().toISOString(),
    currentVersion: 0,
    sessionToken: null,
  };

  await atomicWriteJson(join(dir, PROJECT_FILENAMES.meta), meta);

  if (input.resumeTex !== undefined) {
    await atomicWrite(join(dir, PROJECT_FILENAMES.resumeTex), input.resumeTex);
  }

  return meta;
}

/**
 * Read and validate a project's `project.json`. Returns `null` if the project
 * directory or metadata file does not exist.
 */
export async function readProject(
  projectId: string,
  dataRoot: string = getDataRoot(),
): Promise<ProjectMeta | null> {
  const dir = getProjectDir(projectId, dataRoot);
  let raw: string;
  try {
    raw = await readFile(join(dir, PROJECT_FILENAMES.meta), "utf8");
  } catch (err) {
    if (isErrno(err, "ENOENT")) return null;
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  return ProjectMetaSchema.parse(parsed);
}

/**
 * Recursively delete a project directory. Idempotent: deleting a missing
 * project is a no-op.
 */
export async function deleteProject(
  projectId: string,
  dataRoot: string = getDataRoot(),
): Promise<void> {
  const dir = getProjectDir(projectId, dataRoot);
  await rm(dir, { recursive: true, force: true });
}

/**
 * List all project ids present on disk (directories under `data/projects` that
 * contain a `project.json`).
 */
export async function listProjects(
  dataRoot: string = getDataRoot(),
): Promise<string[]> {
  const root = getProjectsRoot(dataRoot);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if (isErrno(err, "ENOENT")) return [];
    throw err;
  }

  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await readFile(join(root, entry.name, PROJECT_FILENAMES.meta), "utf8");
      ids.push(entry.name);
    } catch (err) {
      if (isErrno(err, "ENOENT")) continue; // dir without metadata — skip
      throw err;
    }
  }
  ids.sort();
  return ids;
}

/** Narrow an unknown thrown value to a Node `errno` exception with a given code. */
function isErrno(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === code
  );
}
