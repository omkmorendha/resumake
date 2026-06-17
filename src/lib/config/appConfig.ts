/**
 * App config persistence (spec §5/§14). `data/config.json` holds provider
 * selection and the OpenAI API key. The key is SERVER-ONLY: never sent to the
 * browser, never logged. The file is written with mode 0600.
 */
import { chmod, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { atomicWrite, getDataRoot } from "@/lib/storage";

export const AppConfigSchema = z.object({
  provider: z.enum(["claude", "openai"]).default("claude"),
  openaiApiKey: z.string().nullable().default(null),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

/** Config as exposed to the browser — the key presence only, never its value. */
export interface PublicConfig {
  provider: AppConfig["provider"];
  hasOpenaiKey: boolean;
}

const DEFAULT_CONFIG: AppConfig = { provider: "claude", openaiApiKey: null };

function configPath(dataRoot: string = getDataRoot()): string {
  return join(dataRoot, "config.json");
}

export async function readConfig(
  dataRoot: string = getDataRoot(),
): Promise<AppConfig> {
  try {
    const raw = await readFile(configPath(dataRoot), "utf8");
    return AppConfigSchema.parse(JSON.parse(raw));
  } catch (err) {
    if (isErrno(err, "ENOENT")) return { ...DEFAULT_CONFIG };
    throw err;
  }
}

/**
 * Atomically write config and enforce 0600. atomicWrite already creates the
 * temp file as 0600, but the final rename target's mode is set explicitly here
 * so an existing file is tightened too.
 */
export async function writeConfig(
  config: AppConfig,
  dataRoot: string = getDataRoot(),
): Promise<void> {
  const path = configPath(dataRoot);
  await atomicWrite(path, `${JSON.stringify(config, null, 2)}\n`);
  await chmod(path, 0o600);
}

/** Update only the fields provided; leaves the rest (incl. the key) intact. */
export async function patchConfig(
  patch: Partial<AppConfig>,
  dataRoot: string = getDataRoot(),
): Promise<AppConfig> {
  const current = await readConfig(dataRoot);
  const next = AppConfigSchema.parse({ ...current, ...patch });
  await writeConfig(next, dataRoot);
  return next;
}

/** The browser-safe projection: provider + whether a key exists (never the key). */
export function toPublicConfig(config: AppConfig): PublicConfig {
  return { provider: config.provider, hasOpenaiKey: config.openaiApiKey !== null };
}

/** Octal file mode (e.g. 0o600) of the config file, for tests/diagnostics. */
export async function configMode(
  dataRoot: string = getDataRoot(),
): Promise<number> {
  const s = await stat(configPath(dataRoot));
  return s.mode & 0o777;
}

function isErrno(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === code
  );
}
