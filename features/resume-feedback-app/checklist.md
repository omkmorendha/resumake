# Resumake — Implementation Checklist

Ordered tasks with acceptance criteria. Grouped by milestone. Check off as completed.
Spec: `spec.md` · Design: `design.html`.

**Status: 10/24 complete**

---

## M0 — Skeleton & compile pipeline

- [x] **0.1 Bootstrap Next.js (App Router, TS, Tailwind), strict tsconfig, ESLint.**
  - AC: `npm run dev` serves a blank app on localhost; `tsc --noEmit` and lint pass.
- [x] **0.2 TeX Live Docker image + compile service abstraction.**
  - AC: a service compiles a sample `.tex` via `latexmk` in the container and returns a PDF path; transport (docker run/exec) is swappable behind an interface.
- [x] **0.3 Docker preflight check at startup.**
  - AC: with Docker stopped, the app shows a friendly setup guide instead of crashing; with Docker up, normal operation.
- [x] **0.4 Files-only storage layer (atomic write-temp-then-rename helper, project dir CRUD).**
  - AC: create/read/delete a project dir; concurrent-write test shows no torn `feedback.json`.
- [x] **0.5 Create project from `.tex` upload; compile; store `resume.pdf` + `compile.log`.**
  - AC: uploading a valid `.tex` yields a compiled PDF on disk; invalid `.tex` records a parsed first-error+line in the log.
- [x] **0.6 Export `.tex` and `.pdf` endpoints.**
  - AC: `GET /export?format=tex|pdf` downloads the correct file.

## M1 — 3-pane editor & section parser

- [x] **1.1 3-pane layout (CodeMirror source · pdf.js preview · feedback/chat placeholder).**
  - AC: panes render and resize; editing source updates client state.
- [x] **1.2 Recompile on explicit action; PDF pane refresh; error/stale-PDF handling.**
  - AC: "Recompile" updates the PDF; on failure the pane shows the error (and stale PDF behind a banner if one exists), never silently blank.
- [x] **1.3 Heuristic section parser → section tree (with no-heading fallback, nesting flatten).**
  - AC: unit tests cover `\section`/`\subsection`/resume macros/environments, exotic class (→ single `document` section), and `\subsubsection` flattening.
- [x] **1.4 Section highlight: selecting a section scrolls/highlights source (best-effort) and PDF.**
  - AC: clicking a parsed section highlights its range in the editor.

## M2 — Provider abstraction & feedback

- [ ] **2.1 `LLMProvider` interface + `ResumeTool`/`AgentEvent`/`ToolResult` types + Zod schemas.**
  - AC: types compile; schemas validate sample payloads; unit tests for each schema (incl. failure cases).
- [ ] **2.2 ClaudeProvider (`generateStructured` via Agent SDK; OAuth; unset `ANTHROPIC_API_KEY`; startup warning).**
  - AC: a structured call returns a Zod-valid object using the subscription token; startup warns if `ANTHROPIC_API_KEY` is set.
- [ ] **2.3 OpenAIProvider (`generateStructured` via `openai`; key from `config.json` mode 0600, server-only).**
  - AC: structured call returns a Zod-valid object; key never appears in client bundle or logs; `config.json` is 0600.
- [ ] **2.4 Zod retry policy (≤3, re-prompt with error) + user-facing failure.**
  - AC: a forced-malformed mock retries 3× then surfaces the failure message and logs raw output.
- [ ] **2.5 Resume-review prompt + `/analyze` → `FeedbackPoint[]` rendered as anchored list (sorted by severity, filterable).**
  - AC: analysis on a sample resume produces anchored points; clicking a point highlights its section; filter by category/severity works.

## M3 — JD-aware analysis

- [ ] **3.1 JD paste UI + `/jd` extraction → `JobRequirements` stored.**
  - AC: pasting a JD stores structured requirements; arbitrary pasted text doesn't crash extraction.
- [ ] **3.2 JD-aware analysis adds high-severity `relevance` gap points (missing keywords/skills).**
  - AC: with a JD present, analysis surfaces explicit keyword/skill gaps as `relevance` points.

## M4 — Agent loop, diff-approve, self-heal

- [ ] **4.1 Four constrained tools implemented (`read_resume`, `get_context`, `propose_edit`, `recompile`); Read/Edit/Bash excluded.**
  - AC: each tool validates input via Zod and returns a `ToolResult`; the agent cannot invoke filesystem/shell tools.
- [ ] **4.2 Per-point SSE chat (`/chat/:pointId`) streaming `AgentEvent`s; OpenAI manual tool loop parity.**
  - AC: chatting streams tokens/tool calls; provider-parity test shows both providers honor the same tool contract (mocked).
- [ ] **4.3 `propose_edit` → diff modal (per-hunk approve/reject).**
  - AC: a proposed edit renders as a reviewable diff; reject writes nothing.
- [ ] **4.4 `/edits/apply`: snapshot → write (atomic) → recompile → re-parse → auto-`addressed`.**
  - AC: approving an edit snapshots a version, applies it, recompiles, re-resolves anchors, and marks the point `addressed`; crash-before-write test recovers the prior version.
- [ ] **4.5 Self-heal compile loop (≤3 agent fix attempts → then error + undo).**
  - AC: an edit that breaks compilation triggers ≤3 auto-fix attempts; on success PDF updates and repairs are logged; on persistent failure the error + one-click undo are shown, edit left in place.
- [ ] **4.6 Version list + restore API and minimal UI.**
  - AC: `/versions` lists snapshots; restore reverts (snapshotting first), recompiles, re-parses.

## M5 — PDF import

- [ ] **5.1 PDF upload → `pdftotext` extraction.**
  - AC: a sample PDF yields extracted text.
- [ ] **5.2 `generateStructured` → `ResumeSegmentation`; render through vendored "Jake's Resume" template → `resume.tex`.**
  - AC: imported PDF produces a compilable `.tex` using the template; UI shows the "rebuilt from template" banner; template vendored with attribution/license.

## M6 — Polish (post-v1)

- [ ] **6.1 Version history UI, feedback filters, config screen (provider/key/Docker status), single-tab guard surfacing.**
  - AC: all settings editable; second tab on a project shows the "already open" warning.

---

## Cross-cutting (do alongside, verify in CI)

- [ ] **T.1 Unit tests:** parser, schemas, anchor re-resolution, diff/snapshot, atomic-write.
- [ ] **T.2 Integration tests:** compile (success/failure/timeout), self-heal, version restore, JD→analyze, provider parity.
- [ ] **T.3 E2E (Playwright):** upload→analyze→discuss→approve→recompile→export; JD-aware; PDF import; compile-break→self-heal/undo.
  - _In progress: Playwright installed + configured (`playwright.config.ts`, `e2e/`); first e2e covers the 3-pane workspace (1.1). Remaining flows added as their features land._
- [ ] **T.4 CI:** strict `tsc`, lint, tests with providers mocked (no live spend).
- [ ] **T.5 Docs:** README prerequisites (Docker, `claude setup-token`, `ANTHROPIC_API_KEY` warning), `.env.example`.

---

### Suggested first task
**0.1 Bootstrap Next.js (App Router, TS, Tailwind)** — establishes the project skeleton everything else builds on.
