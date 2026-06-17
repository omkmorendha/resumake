import { expect, test } from "@playwright/test";

/**
 * Task 1.4 AC: clicking a parsed section highlights its range in the editor.
 */

const TEX = [
  "\\documentclass{article}",
  "\\begin{document}",
  "\\section{Experience}",
  "Worked at ACME on TypeScript.",
  "\\section{Skills}",
  "TypeScript, React, Node.",
  "\\end{document}",
  "",
].join("\n");

test("clicking a section highlights its range in the editor", async ({
  page,
  request,
}) => {
  const res = await request.post("/api/projects", {
    data: { name: "E2E Sections", tex: TEX },
  });
  expect(res.ok()).toBeTruthy();
  const id = (await res.json()).project.id as string;

  await page.goto(`/project/${id}`);

  // The section list derived from the parser shows both sections.
  const experience = page.locator('[data-section-id="experience"]');
  const skills = page.locator('[data-section-id="skills"]');
  await expect(experience).toBeVisible();
  await expect(skills).toBeVisible();

  // No highlight initially.
  await expect(page.locator(".cm-section-highlight")).toHaveCount(0);

  // Click "Skills" → its range is highlighted in the editor.
  await skills.click();
  await expect(page.locator(".cm-section-highlight").first()).toBeVisible();

  // The highlighted lines should include the Skills body.
  const highlighted = page.locator(".cm-section-highlight");
  await expect(highlighted.first()).toBeVisible();

  // Switching to "Experience" moves the highlight (still present, different range).
  await experience.click();
  await expect(page.locator(".cm-section-highlight").first()).toBeVisible();
});
