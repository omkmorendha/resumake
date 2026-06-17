import { expect, test } from "@playwright/test";

/**
 * Task 2.5 AC: feedback renders as an anchored list; clicking a point
 * highlights its section in the editor; filtering by category/severity works.
 *
 * The analysis itself needs an LLM (gated). To exercise the UI without a live
 * call, we create a project whose resume.tex has known sections, then seed
 * feedback by POSTing nothing isn't possible — instead we drive the list via
 * the GET endpoint after writing feedback through a tiny helper route is also
 * out of scope. So we seed via the public API surface that exists: the test
 * writes feedback by calling analyze with a stubbed provider? Not available in
 * the browser. Therefore this e2e seeds feedback.json on disk via a Node step
 * embedded in the test using the app's own filesystem layout under ./data.
 */

import { mkdir, writeFile } from "node:fs/promises";

const TEX = [
  "\\documentclass{article}",
  "\\begin{document}",
  "\\section{Experience}",
  "Worked at ACME.",
  "\\section{Skills}",
  "TypeScript.",
  "\\end{document}",
  "",
].join("\n");

const FEEDBACK = [
  {
    id: "fp_exp",
    category: "impact",
    severity: "critical",
    anchor: { sectionId: "experience", sectionTitle: "Experience" },
    issue: "Bullet lacks a measurable result.",
    suggestion: "Quantify the outcome.",
    status: "open",
  },
  {
    id: "fp_skills",
    category: "ats",
    severity: "low",
    anchor: { sectionId: "skills", sectionTitle: "Skills" },
    issue: "Skills list is thin.",
    suggestion: "Add relevant tools.",
    status: "open",
  },
];

test("feedback list: click highlights section, filters work", async ({ page, request }) => {
  // Create the project via the real API so the dir + resume.tex exist.
  const res = await request.post("/api/projects", {
    data: { name: "E2E Feedback", tex: TEX },
  });
  expect(res.ok()).toBeTruthy();
  const id = (await res.json()).project.id as string;

  // Seed feedback.json on disk (the app reads ./data relative to cwd).
  const dir = `data/projects/${id}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/feedback.json`, JSON.stringify(FEEDBACK, null, 2));

  await page.goto(`/project/${id}`);

  // Both points render.
  const expPoint = page.locator('[data-feedback-id="fp_exp"]');
  const skillsPoint = page.locator('[data-feedback-id="fp_skills"]');
  await expect(expPoint).toBeVisible();
  await expect(skillsPoint).toBeVisible();

  // Clicking the Experience point highlights its section in the editor.
  await expect(page.locator(".cm-section-highlight")).toHaveCount(0);
  await expPoint.click();
  await expect(page.locator(".cm-section-highlight").first()).toBeVisible();

  // Filter by severity = low → only the Skills point remains.
  await page.getByLabel("Filter by severity").selectOption("low");
  await expect(expPoint).toHaveCount(0);
  await expect(skillsPoint).toBeVisible();

  // Reset severity, filter by category = ats → only Skills remains.
  await page.getByLabel("Filter by severity").selectOption("all");
  await page.getByLabel("Filter by category").selectOption("ats");
  await expect(expPoint).toHaveCount(0);
  await expect(skillsPoint).toBeVisible();
});
