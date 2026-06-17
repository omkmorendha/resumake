import { expect, test } from "@playwright/test";

/**
 * Task 1.2 AC: Recompile updates the PDF; on failure the pane shows the error
 * (and a stale-PDF banner when a prior PDF exists), never silently blank.
 */

async function createProject(
  request: import("@playwright/test").APIRequestContext,
  tex: string,
) {
  const res = await request.post("/api/projects", {
    data: { name: "E2E Recompile", tex },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).project.id as string;
}

const GOOD = "\\documentclass{article}\\begin{document}\\section{Experience}Worked.\\end{document}\n";

test("recompile updates the PDF on success", async ({ page, request }) => {
  const id = await createProject(request, GOOD);
  await page.goto(`/project/${id}`);

  // Edit the source, then recompile.
  const editor = page.locator('[aria-label="LaTeX source"] .cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type(" ");

  await page.getByRole("button", { name: "Recompile" }).click();
  // The PDF pane should render a canvas (pdf.js) and show no compile-error banner.
  await expect(page.locator('[aria-label="PDF preview"] canvas')).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.locator('[aria-label="PDF preview"] [role="alert"]'),
  ).toHaveCount(0);
});

test("recompile failure shows the error and keeps the stale PDF behind a banner", async ({
  page,
  request,
}) => {
  // Start from a project that already has a good PDF.
  const id = await createProject(request, GOOD);
  await page.goto(`/project/${id}`);
  await expect(page.locator('[aria-label="PDF preview"] canvas')).toBeVisible({
    timeout: 30_000,
  });

  // Replace the source with something that won't compile, then recompile.
  const editor = page.locator('[aria-label="LaTeX source"] .cm-content');
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(
    "\\documentclass{article}\\begin{document}\\undefinedmacro\\end{document}",
  );
  await page.getByRole("button", { name: "Recompile" }).click();

  // Error banner appears in the PDF pane...
  const alert = page.locator('[aria-label="PDF preview"] [role="alert"]');
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(alert).toContainText(/Compile failed/i);
  // ...and the stale PDF is still shown (canvas remains), not blanked.
  await expect(alert).toContainText(/last successful PDF/i);
  await expect(page.locator('[aria-label="PDF preview"] canvas')).toBeVisible();

  // The dirty banner stays up after a failed compile — the PDF is NOT in sync
  // with the buffer (regression guard for the markPersisted-on-failure bug).
  await expect(page.getByText(/Unsaved edits/i)).toBeVisible();
});
