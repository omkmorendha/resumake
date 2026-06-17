/**
 * Preflight gate tests (Task 0.3). Drives the gates by pointing `dockerPath`
 * at small shims so we can simulate "no CLI", "daemon down", "image missing",
 * and "all good" without depending on the host's real Docker state.
 */
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { dockerPreflight } from "./preflight";

const tmpDirs: string[] = [];

afterEach(() => {
  // dirs are in the OS temp space; leave cleanup to the OS to keep tests fast.
  tmpDirs.length = 0;
});

/**
 * Write an executable shell shim that simulates `docker`. `behavior` maps the
 * first arg ("--version", "info", "image") to an exit code; unmatched → 0.
 */
async function makeDockerShim(behavior: Record<string, number>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "resumake-preflight-"));
  tmpDirs.push(dir);
  const path = join(dir, "docker");
  const cases = Object.entries(behavior)
    .map(([arg, code]) => `  ${arg}) exit ${code};;`)
    .join("\n");
  const script = `#!/bin/sh
case "$1" in
${cases}
  *) exit 0;;
esac
`;
  await writeFile(path, script, "utf8");
  await chmod(path, 0o755);
  return path;
}

describe("dockerPreflight", () => {
  it("reports cli-missing when docker is not found", async () => {
    const res = await dockerPreflight({ dockerPath: "/nonexistent/docker-xyz" });
    expect(res.ok).toBe(false);
    expect(res.failedStage).toBe("cli");
    expect(res.checks.cliInstalled).toBe(false);
    expect(res.guide).toMatch(/install/i);
  });

  it("reports daemon-down when info fails", async () => {
    const docker = await makeDockerShim({ "--version": 0, info: 1 });
    const res = await dockerPreflight({ dockerPath: docker });
    expect(res.ok).toBe(false);
    expect(res.failedStage).toBe("daemon");
    expect(res.checks.cliInstalled).toBe(true);
    expect(res.checks.daemonRunning).toBe(false);
    expect(res.guide).toMatch(/daemon/i);
  });

  it("reports image-missing when inspect fails", async () => {
    const docker = await makeDockerShim({ "--version": 0, info: 0, image: 1 });
    const res = await dockerPreflight({ dockerPath: docker });
    expect(res.ok).toBe(false);
    expect(res.failedStage).toBe("image");
    expect(res.checks.daemonRunning).toBe(true);
    expect(res.checks.imageAvailable).toBe(false);
    expect(res.guide).toMatch(/pull/i);
  });

  it("is ok when all gates pass", async () => {
    const docker = await makeDockerShim({ "--version": 0, info: 0, image: 0 });
    const res = await dockerPreflight({ dockerPath: docker });
    expect(res.ok).toBe(true);
    expect(res.failedStage).toBeNull();
    expect(res.guide).toBe("");
  });
});
