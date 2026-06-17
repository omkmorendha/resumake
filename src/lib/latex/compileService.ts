/**
 * CompileService — compiles a LaTeX document to PDF via `latexmk` inside a
 * full TeX Live environment, using a swappable {@link CompileTransport}.
 *
 * Per spec §11 / §2 (locked): `latexmk -pdf -interaction=nonstopmode
 * -halt-on-error`, 30s configurable timeout + kill, first error+line parsed
 * from the log on failure. The transport (docker run vs docker exec vs a
 * future host-native latexmk) is injected, so this service contains no
 * Docker-specific logic.
 *
 * The compile runs in an isolated temp working directory so concurrent
 * compiles and aux/log clutter never touch the project store; callers copy
 * `resume.pdf` / `compile.log` into the project dir afterwards.
 */

import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { parseFirstLatexError, type LatexError } from "./parseLog";
import { DockerRunTransport, type CompileTransport } from "./transport";

/** Default compile timeout (spec §2: 30s, configurable). */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Base name of the main `.tex` file inside the compile workdir. */
const MAIN_TEX = "resume.tex";

export interface CompileServiceOptions {
  /** Transport used to run `latexmk`. Defaults to {@link DockerRunTransport}. */
  transport?: CompileTransport;
  /** Compile timeout in milliseconds. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * Parent directory for ephemeral compile workdirs. Defaults to the OS temp
   * dir. On macOS this should be a path Docker Desktop can bind-mount (the
   * default `/var/folders/...` works; a custom path must be in Docker's file
   * sharing list).
   */
  tmpRoot?: string;
}

export interface CompileInput {
  /** LaTeX source as a string. Mutually exclusive with {@link texPath}. */
  tex?: string;
  /** Path to an existing `.tex` file on the host. Mutually exclusive with {@link tex}. */
  texPath?: string;
}

export interface CompileResult {
  /** True when a non-empty PDF was produced. */
  ok: boolean;
  /** Absolute host path to the produced PDF (only when `ok`). */
  pdfPath?: string;
  /** Full combined compiler output (stdout+stderr+`.log`), as written to compile.log. */
  log: string;
  /** First parsed LaTeX error + line, when the compile failed. */
  firstError?: LatexError;
  /** True when the compile was killed for exceeding the timeout. */
  timedOut: boolean;
}

export class CompileService {
  private readonly transport: CompileTransport;
  private readonly timeoutMs: number;
  private readonly tmpRoot: string;

  constructor(opts: CompileServiceOptions = {}) {
    this.transport = opts.transport ?? new DockerRunTransport();
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.tmpRoot = opts.tmpRoot ?? tmpdir();
  }

  /** The transport kind in use (for diagnostics/logging). */
  get transportKind(): string {
    return this.transport.kind;
  }

  /**
   * Compile a LaTeX document to PDF.
   *
   * @param input    `.tex` source string or path to a `.tex` file.
   * @param workdir  Optional host directory to compile in. When supplied, it
   *                 is used as-is and left in place (caller owns cleanup);
   *                 this is how the long-lived `docker exec` transport shares
   *                 a bind-mounted directory. When omitted, an ephemeral temp
   *                 dir is created and removed afterwards.
   * @param signal   Optional abort signal.
   */
  async compile(
    input: CompileInput,
    opts: { workdir?: string; signal?: AbortSignal } = {},
  ): Promise<CompileResult> {
    if ((input.tex === undefined) === (input.texPath === undefined)) {
      throw new Error("CompileService.compile requires exactly one of { tex, texPath }.");
    }

    const ephemeral = opts.workdir === undefined;
    const workdir = opts.workdir ?? (await this.makeWorkdir());

    try {
      await this.stageSource(workdir, input);

      const result = await this.transport.run({
        hostWorkdir: workdir,
        command: latexmkCommand(MAIN_TEX),
        timeoutMs: this.timeoutMs,
        signal: opts.signal,
      });

      // latexmk writes resume.log alongside the pdf; fold it into the log we
      // return/persist so error parsing sees the richest output.
      const texLog = await readIfExists(join(workdir, "resume.log"));
      const log = [
        result.stdout,
        result.stderr,
        texLog ? `\n=== resume.log ===\n${texLog}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const builtPdf = join(workdir, "resume.pdf");
      const pdfOk = !result.timedOut && (await isNonEmptyFile(builtPdf));

      if (pdfOk) {
        // In ephemeral mode the workdir is removed in `finally`, so a path into
        // it would dangle. Copy the PDF to a stable temp file the caller can
        // read (and is responsible for relocating/cleaning, per spec §11).
        const pdfPath = ephemeral
          ? await this.stablePdfCopy(builtPdf)
          : builtPdf;
        return { ok: true, pdfPath, log, timedOut: false };
      }

      return {
        ok: false,
        log,
        firstError: result.timedOut
          ? { message: `Compile timed out after ${this.timeoutMs}ms`, raw: "" }
          : parseFirstLatexError(log),
        timedOut: result.timedOut,
      };
    } finally {
      if (ephemeral) {
        await rm(workdir, { recursive: true, force: true });
      }
    }
  }

  private async makeWorkdir(): Promise<string> {
    if (!existsSync(this.tmpRoot)) {
      await mkdir(this.tmpRoot, { recursive: true });
    }
    const dir = await mkdtemp(join(this.tmpRoot, "resumake-compile-"));
    // Resolve symlinks (e.g. macOS /var -> /private/var) so the literal path
    // handed to a Docker bind mount is one the daemon's file sharing accepts.
    return realpath(dir);
  }

  /**
   * Copy a freshly built PDF out of an ephemeral workdir into a stable temp
   * file so the returned path survives workdir cleanup. The caller owns the
   * returned file (relocate into the project dir, then it may be removed).
   */
  private async stablePdfCopy(builtPdf: string): Promise<string> {
    if (!existsSync(this.tmpRoot)) {
      await mkdir(this.tmpRoot, { recursive: true });
    }
    const dir = await mkdtemp(join(this.tmpRoot, "resumake-pdf-"));
    const dest = join(await realpath(dir), "resume.pdf");
    await copyFile(builtPdf, dest);
    return dest;
  }

  private async stageSource(workdir: string, input: CompileInput): Promise<void> {
    const dest = join(workdir, MAIN_TEX);
    if (input.tex !== undefined) {
      await writeFile(dest, input.tex, "utf8");
      return;
    }
    // texPath provided: read and re-stage under the canonical main name so
    // the compile command is stable regardless of the source filename.
    const source = await readFile(input.texPath as string, "utf8");
    await writeFile(dest, source, "utf8");
  }
}

/**
 * The locked latexmk invocation (spec §2/§11). `-cd` is unnecessary because
 * the transport sets cwd to {@link WORK_DIR}, but `-jobname` pins the output
 * name to `resume.pdf` regardless of the input basename.
 */
function latexmkCommand(mainTex: string): readonly string[] {
  return [
    "latexmk",
    "-pdf",
    "-interaction=nonstopmode",
    "-halt-on-error",
    `-jobname=resume`,
    basename(mainTex),
  ];
}

async function isNonEmptyFile(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

// Re-exports for ergonomic single-import consumption by callers/routes.
export {
  DockerRunTransport,
  DockerExecTransport,
  WORK_DIR,
  type CompileTransport,
} from "./transport";
export { parseFirstLatexError, type LatexError } from "./parseLog";
