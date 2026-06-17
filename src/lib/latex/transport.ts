/**
 * CompileTransport — runs a command inside the full TeX Live environment.
 *
 * The compile service is transport-agnostic: it asks a transport to run
 * `latexmk` against a host working directory mounted/visible as `/work`
 * inside the TeX Live environment, and inspects the produced files on the
 * host afterwards.
 *
 * Two concrete transports are provided:
 *   - {@link DockerRunTransport}: `docker run --rm -v <workdir>:/work ...`
 *     (ephemeral container per compile — the default).
 *   - {@link DockerExecTransport}: `docker exec <container> ...` into a
 *     long-lived TeX Live container whose `/work` is bind-mounted to the
 *     same host directory (a drop-in alternative for lower per-compile
 *     latency).
 *
 * A future host-native `latexmk` transport can implement the same
 * interface without touching the service.
 */

import { spawn } from "node:child_process";

/** Mount point of the working directory inside the TeX Live environment. */
export const WORK_DIR = "/work";

export interface TransportRunOptions {
  /**
   * Host directory that must be visible at {@link WORK_DIR} inside the TeX
   * Live environment. It contains the input `.tex` and receives all build
   * artifacts (PDF, log, aux files).
   */
  hostWorkdir: string;
  /**
   * Command + args to execute, with {@link WORK_DIR} as the cwd inside the
   * environment (e.g. `["latexmk", "-pdf", ...]`).
   */
  command: readonly string[];
  /** Hard wall-clock timeout in milliseconds; the process is killed on overrun. */
  timeoutMs: number;
  /** Optional abort signal to cancel the run cooperatively. */
  signal?: AbortSignal;
}

export interface TransportRunResult {
  /** Process exit code, or null if the process was killed (timeout/signal). */
  exitCode: number | null;
  /** Combined stdout captured from the transport process. */
  stdout: string;
  /** Combined stderr captured from the transport process. */
  stderr: string;
  /** True when the run was terminated because it exceeded {@link TransportRunOptions.timeoutMs}. */
  timedOut: boolean;
}

/**
 * Abstraction over "run this command in the TeX Live environment against a
 * host working directory". Implementations decide how the host directory is
 * made available at {@link WORK_DIR} and how the process is launched.
 */
export interface CompileTransport {
  /** Human-readable transport id, for logs/diagnostics. */
  readonly kind: string;
  run(options: TransportRunOptions): Promise<TransportRunResult>;
}

/**
 * Spawns a host process, captures stdout/stderr, and enforces a wall-clock
 * timeout (SIGKILL on overrun). Shared by the docker transports.
 */
function spawnWithTimeout(
  file: string,
  args: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<TransportRunResult> {
  return new Promise<TransportRunResult>((resolve, reject) => {
    const child = spawn(file, [...args], { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const onAbort = () => {
      child.kill("SIGKILL");
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    const cleanup = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

export interface DockerRunTransportOptions {
  /** TeX Live image reference. Defaults to `texlive/texlive:latest`. */
  image?: string;
  /** `docker` executable. Defaults to `docker`. */
  dockerPath?: string;
  /**
   * Run the container as the host uid:gid so artifacts written to the
   * bind-mounted workdir are owned by the host user rather than root.
   * Defaults to true on POSIX hosts.
   */
  mapHostUser?: boolean;
}

/**
 * Ephemeral-container transport: each run spins up a fresh TeX Live
 * container with the host workdir bind-mounted at {@link WORK_DIR}, runs the
 * command, and removes the container (`--rm`).
 */
export class DockerRunTransport implements CompileTransport {
  readonly kind = "docker-run";
  private readonly image: string;
  private readonly dockerPath: string;
  private readonly mapHostUser: boolean;

  constructor(opts: DockerRunTransportOptions = {}) {
    this.image = opts.image ?? "texlive/texlive:latest";
    this.dockerPath = opts.dockerPath ?? "docker";
    this.mapHostUser = opts.mapHostUser ?? process.platform !== "win32";
  }

  async run(options: TransportRunOptions): Promise<TransportRunResult> {
    const args: string[] = [
      "run",
      "--rm",
      "-v",
      `${options.hostWorkdir}:${WORK_DIR}`,
      "-w",
      WORK_DIR,
    ];

    if (
      this.mapHostUser &&
      typeof process.getuid === "function" &&
      typeof process.getgid === "function"
    ) {
      args.push("-u", `${process.getuid()}:${process.getgid()}`);
      // latexmk/texlive need a writable HOME for kpathsea caches when the
      // container uid is unknown to /etc/passwd.
      args.push("-e", `HOME=${WORK_DIR}`);
    }

    args.push(this.image, ...options.command);

    return spawnWithTimeout(this.dockerPath, args, options.timeoutMs, options.signal);
  }
}

export interface DockerExecTransportOptions {
  /**
   * Name/id of the long-lived TeX Live container. Its `/work` must be
   * bind-mounted to the same host directory the service writes to, since
   * `docker exec` cannot add mounts.
   */
  container: string;
  /** `docker` executable. Defaults to `docker`. */
  dockerPath?: string;
}

/**
 * Long-lived-container transport: execs the command inside an already
 * running TeX Live container via `docker exec`. The container is expected to
 * bind-mount the host workdir at {@link WORK_DIR} so artifacts land on the
 * host filesystem the service inspects. Drop-in alternative to
 * {@link DockerRunTransport} for avoiding per-compile container startup cost.
 */
export class DockerExecTransport implements CompileTransport {
  readonly kind = "docker-exec";
  private readonly container: string;
  private readonly dockerPath: string;

  constructor(opts: DockerExecTransportOptions) {
    if (!opts.container) {
      throw new Error("DockerExecTransport requires a container name/id.");
    }
    this.container = opts.container;
    this.dockerPath = opts.dockerPath ?? "docker";
  }

  async run(options: TransportRunOptions): Promise<TransportRunResult> {
    const args: string[] = ["exec", "-w", WORK_DIR, this.container, ...options.command];
    return spawnWithTimeout(this.dockerPath, args, options.timeoutMs, options.signal);
  }
}
