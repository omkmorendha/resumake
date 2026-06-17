import { expect, test } from "@playwright/test";

/**
 * Task 4.6 (live): /versions lists snapshots; restore reverts (snapshotting
 * first), recompiles, re-parses. Exercises both the API and the History UI.
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

test("versions list + restore via API", async ({ request }) => {
  const create = await request.post("/api/projects", { data: { name: "Versions", tex: BEFORE } });
  const id = (await create.json()).project.id as string;
  const dir = `data/projects/${id}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/feedback.json`, JSON.stringify(FEEDBACK, null, 2));

  // Apply an edit → creates version 1 (the original).
  const apply = await request.post(`/api/projects/${id}/edits/apply`, {
    data: { pointId: "fp_1", diff: DIFF, acceptedHunks: [true] },
  });
  expect(apply.ok()).toBeTruthy();

  // /versions lists the snapshot.
  const list = await request.get(`/api/projects/${id}/versions`);
  expect(list.ok()).toBeTruthy();
  const versions = (await list.json()).versions as { version: number }[];
  expect(versions.some((v) => v.version === 1)).toBe(true);

  // Current source is the edited one.
  let src = (await (await request.get(`/api/projects/${id}`)).json()).source as string;
  expect(src).toContain("Cut deploy time 40%");

  // Restore version 1 (the original) → reverts.
  const restore = await request.post(`/api/projects/${id}/versions/1/restore`);
  expect(restore.ok()).toBeTruthy();
  const rbody = await restore.json();
  expect(rbody.source).toContain("Did stuff at ACME.");
  expect(rbody.compiled).toBe(true);

  // The project source is reverted on disk.
  src = (await (await request.get(`/api/projects/${id}`)).json()).source as string;
  expect(src).toContain("Did stuff at ACME.");
});

test("History UI lists versions and restores", async ({ page, request }) => {
  const create = await request.post("/api/projects", { data: { name: "Versions UI", tex: BEFORE } });
  const id = (await create.json()).project.id as string;
  const dir = `data/projects/${id}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/feedback.json`, JSON.stringify(FEEDBACK, null, 2));
  await request.post(`/api/projects/${id}/edits/apply`, {
    data: { pointId: "fp_1", diff: DIFF, acceptedHunks: [true] },
  });

  await page.goto(`/project/${id}`);
  await page.getByRole("button", { name: "History" }).click();
  const list = page.getByTestId("versions-list");
  await expect(list).toBeVisible();
  await expect(list.locator('[data-version="1"]')).toBeVisible();

  // Restore v1 from the UI and confirm the editor shows the reverted source.
  await list.locator('[data-version="1"]').getByRole("button", { name: /Restore/ }).click();
  await expect(page.locator('[aria-label="LaTeX source"] .cm-content')).toContainText(
    "Did stuff at ACME.",
    { timeout: 15_000 },
  );
});
