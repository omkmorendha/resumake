import { isAbsolute, join, resolve } from "node:path";

/**
 * Resolve the on-disk data root. Configurable via `RESUMAKE_DATA_DIR`
 * (absolute, or relative to cwd); defaults to `./data` per spec §5.
 */
export function getDataRoot(): string {
  const fromEnv = process.env.RESUMAKE_DATA_DIR;
  if (fromEnv && fromEnv.trim() !== "") {
    return isAbsolute(fromEnv) ? fromEnv : resolve(process.cwd(), fromEnv);
  }
  return resolve(process.cwd(), "data");
}

/** Absolute path to `data/projects` under the given (or default) data root. */
export function getProjectsRoot(dataRoot: string = getDataRoot()): string {
  return join(dataRoot, "projects");
}

/**
 * A projectId must be a safe directory name: no path separators, no traversal,
 * no leading dot. We accept the slug/UUID shape the app generates and reject
 * anything that could escape `data/projects/`.
 */
const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function isValidProjectId(projectId: string): boolean {
  return PROJECT_ID_RE.test(projectId);
}

export function assertValidProjectId(projectId: string): void {
  if (!isValidProjectId(projectId)) {
    throw new Error(`Invalid projectId: ${JSON.stringify(projectId)}`);
  }
}

/** Absolute path to a single project's directory. */
export function getProjectDir(
  projectId: string,
  dataRoot: string = getDataRoot(),
): string {
  assertValidProjectId(projectId);
  return join(getProjectsRoot(dataRoot), projectId);
}
