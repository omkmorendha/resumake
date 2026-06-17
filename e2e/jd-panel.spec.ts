import { expect, test } from "@playwright/test";

/**
 * Task 3.1 (UI portion): the JD panel renders, toggles open, and shows the
 * paste textarea. The extraction itself needs an LLM (gated), and a stored-JD
 * indicator is exercised by seeding jobposting.json on disk.
 */
import { mkdir, writeFile } from "node:fs/promises";

const TEX = "\\documentclass{article}\\begin{document}\\section{Skills}TS.\\end{document}\n";

test("JD panel toggles and shows a paste box", async ({ page, request }) => {
  const res = await request.post("/api/projects", { data: { name: "JD UI", tex: TEX } });
  const id = (await res.json()).project.id as string;

  await page.goto(`/project/${id}`);

  const toggle = page.getByRole("button", { name: /Job description/i });
  await expect(toggle).toBeVisible();
  await expect(toggle).toContainText(/none/i);

  await toggle.click();
  await expect(page.getByLabel("Job posting text")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Extract requirements/i }),
  ).toBeVisible();
});

test("JD panel reflects a stored job posting", async ({ page, request }) => {
  const res = await request.post("/api/projects", { data: { name: "JD Stored", tex: TEX } });
  const id = (await res.json()).project.id as string;

  // Seed jobposting.json on disk (app reads ./data relative to cwd).
  const dir = `data/projects/${id}`;
  await mkdir(dir, { recursive: true });
  const requirements = {
    mustHaveSkills: ["TypeScript", "React"],
    niceToHaveSkills: [],
    keywords: ["typescript", "react", "node"],
    responsibilities: ["Build UI"],
    rawText: "Hiring a TS engineer",
  };
  await writeFile(
    `${dir}/jobposting.json`,
    JSON.stringify({ rawText: requirements.rawText, extractedRequirements: requirements }, null, 2),
  );

  await page.goto(`/project/${id}`);
  const toggle = page.getByRole("button", { name: /Job description/i });
  await expect(toggle).toContainText(/added/i);
  await expect(page.getByText(/2 must-have/)).toBeVisible();
});
