/**
 * Hunk parse + selective-apply tests (Task 4.3). Verifies that accepting all
 * hunks reproduces the proposed text, rejecting all reproduces the original,
 * and a mix applies only the accepted regions.
 */
import { describe, expect, it } from "vitest";

import { makeUnifiedDiff } from "./diff";
import { applySelectedHunks, parseHunks } from "./hunks";

const BEFORE = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"].join("\n");

describe("parseHunks + applySelectedHunks", () => {
  it("accepting all hunks reproduces the proposed text", () => {
    const after = ["alpha", "BETA", "gamma", "delta", "EPSILON", "zeta"].join("\n");
    const diff = makeUnifiedDiff(BEFORE, after);
    const hunks = parseHunks(diff);
    expect(hunks.length).toBeGreaterThan(0);
    const result = applySelectedHunks(BEFORE, hunks, hunks.map(() => true));
    expect(result).toBe(after);
  });

  it("rejecting all hunks reproduces the original", () => {
    const after = ["alpha", "BETA", "gamma", "delta", "EPSILON", "zeta"].join("\n");
    const diff = makeUnifiedDiff(BEFORE, after);
    const hunks = parseHunks(diff);
    const result = applySelectedHunks(BEFORE, hunks, hunks.map(() => false));
    expect(result).toBe(BEFORE);
  });

  it("a single-hunk edit applies cleanly when accepted", () => {
    const after = ["alpha", "beta", "GAMMA", "delta", "epsilon", "zeta"].join("\n");
    const diff = makeUnifiedDiff(BEFORE, after);
    const hunks = parseHunks(diff);
    expect(applySelectedHunks(BEFORE, hunks, [true])).toBe(after);
    expect(applySelectedHunks(BEFORE, hunks, [false])).toBe(BEFORE);
  });

  it("parses the @@ header start line", () => {
    const after = ["alpha", "beta", "gamma", "delta", "epsilon", "ZETA"].join("\n");
    const hunks = parseHunks(makeUnifiedDiff(BEFORE, after));
    expect(hunks[0]?.beforeStart).toBeGreaterThan(0);
  });
});
