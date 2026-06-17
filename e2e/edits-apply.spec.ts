import { expect, test } from "@playwright/test";

/**
 * Task 4.4 (live route): /edits/apply snapshots, applies, recompiles, re-parses,
 * and marks the point addressed. Exercises the exact endpoint the DiffModal's
 * "Approve & apply" button calls. (The diff is computed the same way propose_edit
 * does, so this mirrors the real approval flow without needing an LLM.)
 */
import { mkdir, writeFile } from "node:fs/promises";

const BEFORE = [
  "\\documentclass{article}",
  "\\begin{document}",
  "\\section{Experience}",
  "Did stuff at ACME.",
  "\\end{document}",
  "",
].join("\n");

// A minimal unified diff turning the bullet into a quantified one.
const DIFF = [
  "@@ -4,1 +4,1 @@",
  "-Did stuff at ACME.",
  "+Cut deploy time 40% at ACME.",
].join("\n");

const FEEDBACK = [
  {
    id: "fp_1",
    category: "impact",
    severity: "high",
    anchor: { sectionId: "experience", sectionTitle: "Experience" },
    issue: "No metrics.",
    suggestion: "Quantify.",
    status: "open",
  },
];

test("approve & apply: snapshot + recompile + addressed", async ({ request }) => {
  const create = await request.post("/api/projects", {
    data: { name: "Apply E2E", tex: BEFORE },
  });
  const id = (await create.json()).project.id as string;

  // Seed a feedback point (the apply route marks it addressed).
  const dir = `data/projects/${id}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/feedback.json`, JSON.stringify(FEEDBACK, null, 2));

  const res = await request.post(`/api/projects/${id}/edits/apply`, {
    data: { pointId: "fp_1", diff: DIFF, acceptedHunks: [true] },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();

  expect(body.source).toContain("Cut deploy time 40%");
  expect(body.compiled).toBe(true);
  expect(body.version).toBe(1); // prior source snapshotted
  expect(body.point.status).toBe("addressed");

  // The applied source is now served by the project GET.
  const get = await request.get(`/api/projects/${id}`);
  expect((await get.json()).source).toContain("Cut deploy time 40%");

  // The snapshot of the ORIGINAL is restorable via the versions API (4.6 GET).
  const versions = await request.get(`/api/projects/${id}/versions`);
  if (versions.ok()) {
    const list = (await versions.json()).versions as { version: number }[];
    expect(list.some((v) => v.version === 1)).toBe(true);
  }
});
