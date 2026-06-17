import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  mkdir,
  open,
  rename,
  rm,
} from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Durably write `data` to `filePath` so a concurrent reader (or a crash) never
 * observes a torn / partially-written file.
 *
 * Strategy (POSIX-durable write-temp-then-rename):
 *   1. Write the full payload to a uniquely-named temp file in the SAME
 *      directory (so the final `rename` is atomic — same filesystem).
 *   2. `fsync` the temp file's data + metadata to stable storage.
 *   3. `rename` the temp file over the target. `rename(2)` is atomic on POSIX,
 *      so any reader sees either the old file or the new file in full — never a
 *      mix. Concurrent writers therefore each produce a complete file and the
 *      last `rename` to land wins; there is no interleaving of bytes.
 *   4. `fsync` the containing directory so the rename itself survives a crash.
 *
 * The temp file is cleaned up on any failure before the rename.
 */
export async function atomicWrite(
  filePath: string,
  data: string | Uint8Array,
): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  // Unique temp name in the same dir: a leading dot keeps it hidden-ish, the
  // random suffix prevents collisions between concurrent writers to the same
  // target path.
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;

  const payload = typeof data === "string" ? Buffer.from(data, "utf8") : data;

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(tmpPath, "wx", 0o600);
    await handle.writeFile(payload);
    // Flush file contents + metadata to disk before exposing it via rename.
    await handle.sync();
    await handle.close();
    handle = undefined;

    await rename(tmpPath, filePath);

    await fsyncDir(dir);
  } catch (err) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    // Best-effort cleanup of the orphaned temp file; never mask the real error.
    await rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Serialize `value` as pretty JSON and atomically write it to `filePath`.
 */
export async function atomicWriteJson(
  filePath: string,
  value: unknown,
): Promise<void> {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * fsync a directory so a contained file's creation/rename is durable.
 * Some platforms (notably Windows) cannot open a directory for fsync — those
 * cases are treated as best-effort and ignored.
 */
async function fsyncDir(dir: string): Promise<void> {
  let dirHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    dirHandle = await open(dir, constants.O_RDONLY);
    await dirHandle.sync();
  } catch {
    // Directory fsync is a durability nicety, not a correctness requirement for
    // the atomicity guarantee (rename already gives that). Ignore unsupported
    // platforms / EISDIR-style errors.
  } finally {
    if (dirHandle) {
      await dirHandle.close().catch(() => {});
    }
  }
}
