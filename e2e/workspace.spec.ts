import { expect, test } from "@playwright/test";

/**
 * Task 1.1 AC: the 3-pane workspace renders and resizes; editing the source
 * updates client state. We create a project via the API, open its workspace,
 * and assert all three panes are present, a divider drag changes pane width,
 * and typing into the editor changes the buffer.
 */

async function createProject(request: import("@playwright/test").APIRequestContext) {
  const res = await request.post("/api/projects", {
    data: {
      name: "E2E Workspace",
      tex: "\\documentclass{article}\\begin{document}\\section{Experience}Body.\\end{document}\n",
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.project.id as string;
}

test("3-pane workspace renders, resizes, and reflects edits", async ({ page, request }) => {
  const id = await createProject(request);
  await page.goto(`/project/${id}`);

  // All three panes render (by aria-label).
  const sourcePane = page.locator('[aria-label="LaTeX source"]');
  const pdfPane = page.locator('[aria-label="PDF preview"]');
  const feedbackPane = page.locator('[aria-label="Feedback and chat"]');
  await expect(sourcePane).toBeVisible();
  await expect(pdfPane).toBeVisible();
  await expect(feedbackPane).toBeVisible();

  // The CodeMirror editor mounted with the loaded source.
  const editor = sourcePane.locator(".cm-content");
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("Experience");

  // Resize: drag the first divider left and assert the source pane narrows.
  const widthBefore = (await sourcePane.boundingBox())!.width;
  const divider = page.locator('[role="separator"]').first();
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 150, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const widthAfter = (await sourcePane.boundingBox())!.width;
  expect(widthAfter).toBeLessThan(widthBefore);

  // Edit: type into the editor and confirm the buffer changed.
  await editor.click();
  await page.keyboard.type(" EDITED_TOKEN");
  await expect(editor).toContainText("EDITED_TOKEN");
});
