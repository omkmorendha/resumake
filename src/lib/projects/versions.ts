/**
 * Version snapshots (spec §5, Tasks 4.4/4.6). Before any edit overwrites
 * resume.tex we snapshot the CURRENT source to versions/NNNN.tex and record it
 * in versions/index.json. The index is rebuilt from disk if stale/missing, so a
 * crash between writing a snapshot and updating the index never loses a version.
 *
 * Numbering: zero-padded, monotonically increasing from the highest existing
 * snapshot on disk (not just the index), so concurrent/edge cases can't reuse a
 * number.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  PROJECT_FILENAMES,
  atomicWrite,
  atomicWriteJson,
  getDataRoot,
  getProjectDir,
} from "@/lib/storage";

export interface VersionEntry {
  version: number;
  ts: string;
  summary: string;
}

function versionsDir(projectId: string, dataRoot: string): string {
  return join(getProjectDir(projectId, dataRoot), PROJECT_FILENAMES.versionsDir);
}

function indexPath(projectId: string, dataRoot: string): string {
  return join(getProjectDir(projectId, dataRoot), PROJECT_FILENAMES.versionsIndex);
}

function fileFor(version: number): string {
  return `${String(version).padStart(4, "0")}.tex`;
}

/** Highest snapshot number present on disk (0 if none). */
async function highestOnDisk(projectId: string, dataRoot: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(versionsDir(projectId, dataRoot));
  } catch {
    return 0;
  }
  let max = 0;
  for (const name of entries) {
    const m = name.match(/^(\d+)\.tex$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Read the index, rebuilding from on-disk snapshots if missing/stale. */
export async function readVersionIndex(
  projectId: string,
  dataRoot: string = getDataRoot(),
): Promise<VersionEntry[]> {
  let index: VersionEntry[] = [];
  try {
    index = JSON.parse(
      await readFile(indexPath(projectId, dataRoot), "utf8"),
    ) as VersionEntry[];
  } catch {
    index = [];
  }
  // Reconcile against disk: ensure every on-disk snapshot has an entry.
  let entries: string[] = [];
  try {
    entries = await readdir(versionsDir(projectId, dataRoot));
  } catch {
    return index.sort((a, b) => a.version - b.version);
  }
  const known = new Set(index.map((e) => e.version));
  for (const name of entries) {
    const m = name.match(/^(\d+)\.tex$/);
    if (m) {
      const v = Number(m[1]);
      if (!known.has(v)) {
        index.push({ version: v, ts: new Date(0).toISOString(), summary: "(recovered)" });
      }
    }
  }
  return index.sort((a, b) => a.version - b.version);
}

/**
 * Snapshot the given source as the next version. Writes the `.tex` FIRST (so a
 * crash leaves a recoverable file), then updates the index. Returns the new
 * version number.
 */
export async function snapshotVersion(
  projectId: string,
  source: string,
  summary: string,
  now: string,
  dataRoot: string = getDataRoot(),
): Promise<number> {
  const next = (await highestOnDisk(projectId, dataRoot)) + 1;
  const dir = versionsDir(projectId, dataRoot);
  await atomicWrite(join(dir, fileFor(next)), source);

  const index = await readVersionIndex(projectId, dataRoot);
  if (!index.some((e) => e.version === next)) {
    index.push({ version: next, ts: now, summary });
  }
  await atomicWriteJson(indexPath(projectId, dataRoot), index);
  return next;
}

/** Read a snapshot's source. */
export async function readVersionSource(
  projectId: string,
  version: number,
  dataRoot: string = getDataRoot(),
): Promise<string> {
  return readFile(join(versionsDir(projectId, dataRoot), fileFor(version)), "utf8");
}
