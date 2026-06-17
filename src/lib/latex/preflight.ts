/**
 * Docker preflight — checks that the host has everything the LaTeX compile
 * pipeline needs before the app tries to compile anything (spec §11 / §2,
 * Task 0.3). Three gates, in order: the `docker` CLI is on PATH, the daemon
 * is reachable, and the TeX Live image is pulled.
 *
 * The result is a structured status plus a friendly, actionable setup guide
 * so the UI can show "here's how to fix it" instead of crashing.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** TeX Live image the compile pipeline runs against (matches the transports). */
export const TEXLIVE_IMAGE = "texlive/texlive:latest";

export type PreflightStage = "cli" | "daemon" | "image";

export interface PreflightResult {
  /** True only when every gate passed — the compile pipeline is ready. */
  ok: boolean;
  /** The first gate that failed, or null when ready. */
  failedStage: PreflightStage | null;
  /** Per-gate outcomes, for diagnostics/UI detail. */
  checks: {
    cliInstalled: boolean;
    daemonRunning: boolean;
    imageAvailable: boolean;
  };
  /** Human-readable, actionable guidance when not ready; empty when ok. */
  guide: string;
}

interface PreflightOptions {
  dockerPath?: string;
  image?: string;
  /** Per-command timeout. Docker calls should be near-instant; cap them. */
  timeoutMs?: number;
}

async function tryExec(
  file: string,
  args: string[],
  timeoutMs: number,
): Promise<{ ok: boolean }> {
  try {
    await exec(file, args, { timeout: timeoutMs });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

function guideFor(stage: PreflightStage, image: string): string {
  switch (stage) {
    case "cli":
      return [
        "Docker isn't installed (the `docker` command was not found).",
        "Resumake compiles LaTeX inside a TeX Live container, so Docker is required.",
        "Install Docker Desktop from https://www.docker.com/products/docker-desktop/",
        "then restart Resumake.",
      ].join(" ");
    case "daemon":
      return [
        "Docker is installed but the daemon isn't running.",
        "Start Docker Desktop (or your Docker service) and wait until it reports",
        '"running", then reload this page.',
      ].join(" ");
    case "image":
      return [
        `The TeX Live image (${image}) isn't available yet.`,
        `Pull it once with:  docker pull ${image}`,
        "(it is large — several GB — and only needs to be pulled once).",
      ].join(" ");
  }
}

/**
 * Run the preflight gates in order. Short-circuits at the first failure: a
 * missing daemon makes the image check meaningless, so we don't run it.
 */
export async function dockerPreflight(
  opts: PreflightOptions = {},
): Promise<PreflightResult> {
  const dockerPath = opts.dockerPath ?? "docker";
  const image = opts.image ?? TEXLIVE_IMAGE;
  const timeoutMs = opts.timeoutMs ?? 5_000;

  const checks = {
    cliInstalled: false,
    daemonRunning: false,
    imageAvailable: false,
  };

  // Gate 1: docker CLI present.
  const cli = await tryExec(dockerPath, ["--version"], timeoutMs);
  checks.cliInstalled = cli.ok;
  if (!cli.ok) {
    return { ok: false, failedStage: "cli", checks, guide: guideFor("cli", image) };
  }

  // Gate 2: daemon reachable.
  const daemon = await tryExec(dockerPath, ["info", "--format", "{{.ServerVersion}}"], timeoutMs);
  checks.daemonRunning = daemon.ok;
  if (!daemon.ok) {
    return { ok: false, failedStage: "daemon", checks, guide: guideFor("daemon", image) };
  }

  // Gate 3: TeX Live image pulled.
  const img = await tryExec(dockerPath, ["image", "inspect", image], timeoutMs);
  checks.imageAvailable = img.ok;
  if (!img.ok) {
    return { ok: false, failedStage: "image", checks, guide: guideFor("image", image) };
  }

  return { ok: true, failedStage: null, checks, guide: "" };
}
