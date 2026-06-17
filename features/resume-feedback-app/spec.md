# Resumake — Implementation Spec

**Status:** Accepted · **Type:** Greenfield · **Date:** 2026-06-17
**Companion:** `design.html` (visual design doc), `checklist.md` (ordered tasks)

A local-first, single-user web app for AI-driven resume feedback. Upload a LaTeX (or PDF) resume, get structured section-anchored feedback (optionally JD-tailored), discuss each point with an agent that proposes diff-approved `.tex` edits, compile to PDF, export `.tex`/`.pdf`.

---

## 1. Scope

### v1 (must-have)
- Upload `.tex` → compile → live PDF preview.
- Structured, section-anchored feedback points; JD paste → structured extraction → gap analysis.
- Per-point agent chat; `propose_edit` → diff-approve → snapshot/apply/recompile/re-parse.
- Export `.tex` and `.pdf`.
- PDF import → text/structure extraction → render into "Jake's Resume" template.

### Out of scope (v1)
- Multi-user / hosted SaaS (hard constraint — see §9).
- Visual-fidelity match on PDF import.
- Job-board URL scraping.
- Heavy compile sandboxing (trusted local input; timeout only).
- Localization / theming (English-only v1).

---

## 2. Locked decisions

| Area | Decision |
| --- | --- |
| Deployment | Local-first, single-user, localhost |
| AI auth | Claude via Agent SDK + `CLAUDE_CODE_OAUTH_TOKEN`; OpenAI via pasted API key |
| Providers | Both, behind one `LLMProvider` abstraction; Claude is primary/agentic path |
| Stack | Next.js (App Router, TS), Node runtime; **app runs natively on host**, LaTeX in Docker |
| Persistence | Files only — per-project dirs + JSON sidecars |
| LaTeX→PDF | `latexmk -pdf` + full TeX Live in a Docker container |
| Compile safety | Timeout only (30s, configurable) — trusted self-authored input |
| Section anchoring | Heuristic LaTeX parsing + `sectionId` + quoted-text matching |
| Edit application | Diff preview + per-hunk approve |
| Agent autonomy | Constrained app-defined toolset (no Bash/free FS) |
| Feedback shape | Structured JSON (category, severity, anchor, issue, suggestion) |
| JD handling | Paste text → structured requirement extraction → scored gap analysis |
| Resume input | `.tex` upload + PDF→template reconstruction |
| UI | 3-pane: LaTeX source · PDF preview · Feedback/Chat |
| Base template | "Jake's Resume" (clean one-column, ATS-friendly), vendored w/ attribution |
| Status auto-advance | Applied edit auto-marks its feedback point `addressed` (manual revert; `dismissed` manual) |
| Failed recompile | Agent self-heal loop ≤3 attempts → then error + undo (edit left in place) |
| Docker missing | Startup preflight → friendly setup guide |
| Testing | Comprehensive: unit + integration (incl. provider parity) + Playwright e2e |

---

## 3. Tech stack

- **Next.js 15** (App Router, TypeScript), Node server runtime (not Edge).
- **`@anthropic-ai/claude-agent-sdk`** (Claude, OAuth) + **`openai`** SDK (OpenAI, API key).
- **CodeMirror 6** (LaTeX source + merge/diff view), **pdf.js** (preview).
- **TeX Live** (full) via `latexmk` in Docker; **poppler** (`pdftotext`) for PDF import.
- **Zod** at all LLM/API boundaries; **Tailwind**; **Zustand** (or Context) for client state.
- **Playwright** for e2e; provider calls mocked/recorded in CI.

---

## 4. Architecture

Browser (3-pane) ⇄ Next.js route handlers (Node) → Provider abstraction (Claude | OpenAI) + LaTeX compile service (Docker) + filesystem storage. SSE streams agent/chat events to the browser. See `design.html §4` for the diagram.

---

## 5. Data model (files-only)

```
data/
  config.json                    # provider selection, OpenAI key (0600), token presence
  projects/<projectId>/
    project.json                 # name, provider, createdAt, currentVersion, sessionToken
    resume.tex  resume.pdf  compile.log
    jobposting.json              # { rawText, extractedRequirements } | absent
    feedback.json                # FeedbackPoint[] (replaced per analysis)
    versions/NNNN.tex  versions/index.json   # [{version, ts, summary}]
    conversations/<feedbackPointId>.json     # ChatMessage[]
```

**Durability:** write-to-temp-then-rename for all mutating writes; version snapshot persisted *before* `resume.tex` overwrite; `index.json` rebuilt from disk on load if stale.

### Types (Zod-validated)

```ts
type Severity = "critical" | "high" | "medium" | "low" | "nit";
type Category = "impact" | "clarity" | "ats" | "formatting"
              | "relevance" | "consistency" | "grammar";

interface SectionAnchor {
  sectionId: string; sectionTitle: string;
  subBlock?: string; texRange?: { start: number; end: number }; // informational
}
interface FeedbackPoint {
  id: string; category: Category; severity: Severity; anchor: SectionAnchor;
  issue: string; suggestion: string; jdRelevance?: string;
  status: "open" | "addressed" | "dismissed";   // auto→addressed on applied edit
}
interface ChatMessage {
  id: string; role: "user" | "assistant" | "tool"; content: string; ts: string;
  proposedEdit?: { diff: string; targetSectionId?: string };
}
interface JobRequirements {
  mustHaveSkills: string[]; niceToHaveSkills: string[]; yearsExperience?: string;
  keywords: string[]; responsibilities: string[]; rawText: string;
}
interface ResumeSegmentation {
  contact: { name: string; email: string; phone?: string; links: string[] };
  summary?: string;
  experience: { company: string; role: string; dates: string; bullets: string[] }[];
  education: { school: string; degree: string; dates: string }[];
  skills: string[];
  projects?: { name: string; desc: string; bullets: string[] }[];
}
```

---

## 6. Provider abstraction

```ts
interface LLMProvider {
  generateStructured<T>(a: { system: string; user: string; schema: ZodSchema<T> }): Promise<T>;
  runAgentTurn(a: {
    system: string; messages: ChatMessage[]; tools: ResumeTool[];
    onEvent: (e: AgentEvent) => void;
  }): Promise<ChatMessage>;
}

type ResumeToolName = "read_resume" | "get_context" | "propose_edit" | "recompile";
interface ResumeTool { name: ResumeToolName; description: string;
  inputSchema: ZodSchema<unknown>; execute: (i: unknown) => Promise<ToolResult>; }
type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };
type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; tool: ResumeToolName; input: unknown }
  | { type: "tool_result"; tool: ResumeToolName; result: ToolResult }
  | { type: "proposed_edit"; diff: string; targetSectionId?: string; rationale: string }
  | { type: "error"; message: string }
  | { type: "done"; message: ChatMessage };
```

- **ClaudeProvider:** four `ResumeTool`s as in-process SDK MCP tools; Read/Edit/Bash excluded from `allowedTools`; map SDK stream → `AgentEvent`. Auth via `CLAUDE_CODE_OAUTH_TOKEN`.
- **OpenAIProvider:** manual tool loop; tools exposed as OpenAI function tools; `{ok:false,error}` results fed back so the model reacts. `response_format` only for `generateStructured`.
- **Zod retry:** `generateStructured` retries ≤3 with the validation error re-prompted; then user-facing failure + raw output logged.

> **Auth footgun:** if `ANTHROPIC_API_KEY` is set, the SDK uses it (API billing) instead of the subscription. Unset it in the spawned env; warn at startup if present.

---

## 7. Constrained agent tools & self-heal loop

| Tool | Input | Effect |
| --- | --- | --- |
| `read_resume` | — | Current `.tex` + parsed section tree |
| `get_context` | `{sectionId?}` | FeedbackPoint + JobRequirements + target section text (+adjacent lines) + prior chat in this thread (bounded) |
| `propose_edit` | `{sectionId, find, replace, rationale}` | Stages a diff (no disk write) |
| `recompile` | — | Compile proposed/current `.tex`; return errors |

**Approval gate:** `propose_edit` stages a diff → UI shows it → on approve: snapshot `versions/NNNN.tex` → apply → recompile → update PDF → re-parse anchors → point auto→`addressed`. On reject, nothing written.

**Self-heal (post-edit compile failure):** feed the LaTeX error to the agent → it fixes via auto-applied `propose_edit` → recompile, **≤3 attempts**. Success → fold repair diffs into history. Still failing → surface error + offer undo (edit left in place).

---

## 8. Section anchoring

Heuristic parser detects `\section`/`\subsection`/common resume macros/environments → `SectionAnchor` (stable `sectionId` slug + char range). `\item` → sub-blocks. **No headings found** → single synthetic `document` section (quoted-text-only anchoring; never errors). `\subsubsection` flattened to nearest section. Re-parse after every applied edit; anchors re-resolve by `sectionId` + quoted text. After multiple edits, UI hints to re-run analysis.

---

## 9. AI prompts

- **Resume review** (`lib/prompts/resumeReview.ts`): expert-reviewer + ATS-aware; dimensions impact/clarity/ats/relevance/formatting/consistency/grammar; per-issue structured point with quoted source text; no fabricated metrics — flag missing ones; fewer high-signal points over nitpicks; ordered by severity.
- **JD extraction:** parse pasted text → `JobRequirements` (must/nice skills, years, top 10–15 keywords, responsibilities); no invented requirements. Feeds the RELEVANCE dimension + emits high-severity `relevance` gap points.
- **Per-point chat:** scoped to one feedback point/section; never rewrite unrelated sections; keep ATS-safe + one page; optimize toward JD if present.
- Full prompt text in `design.html §7`.

---

## 10. API surface (Next.js route handlers)

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/projects` | GET/POST | List / create (`.tex` upload or PDF) |
| `/api/projects/:id` | GET/PATCH/DELETE | Read / update source / delete |
| `/api/projects/:id/compile` | POST | Compile → PDF; return log/errors |
| `/api/projects/:id/analyze` | POST | Analysis (`{provider, jobPostingText?}`) → FeedbackPoint[] |
| `/api/projects/:id/jd` | POST | Extract & store JobRequirements |
| `/api/projects/:id/chat/:pointId` | POST (SSE) | Agent turn; streams AgentEvents |
| `/api/projects/:id/edits/apply` | POST | Apply approved diff: snapshot/write/recompile/re-parse |
| `/api/projects/:id/export` | GET | Download `.tex`/`.pdf` (`?format=`) |
| `/api/projects/:id/versions` | GET | List snapshots |
| `/api/projects/:id/versions/:n/restore` | POST | Restore snapshot (snapshot first), recompile, re-parse |
| `/api/config` | GET/PATCH | Provider, OpenAI key (write-only), token/Docker status |

All endpoints return `{ error: { code, message } }` on failure; SSE emits `{type:"error"}` inline.

---

## 11. LaTeX compilation

`latexmk -pdf -interaction=nonstopmode -halt-on-error` in a temp workdir in the TeX Live container (host shells in via `docker run --rm -v`/`docker exec`). 30s timeout (configurable) + kill. Success → copy to `resume.pdf` + log. Failure → parse first error+line → UI; PDF pane shows error (or stale prior PDF behind a banner), never silently blank. **Docker preflight** at startup → friendly guide if missing.

---

## 12. PDF import

`pdftotext -layout` → `generateStructured` → `ResumeSegmentation` → render through bundled "Jake's Resume" template → `resume.tex` → compile. UI banner: "rebuilt from clean template, not copied from original."

---

## 13. Error handling & recovery

See `design.html §14b` — table covering Zod retries, self-heal, initial-compile failure, atomic-write crash safety, Docker preflight, SSE errors, orphaned versions, second-tab guard.

---

## 14. Security & constraints

- **Single-user, local, personal only.** Anthropic ToS forbids offering subscription login to other end users without approval — do not make this multi-user/hosted on this auth path.
- `config.json` mode `0600`; OpenAI key server-side only, never sent to browser, never logged.
- Single-tab session-token guard per project.
- Compile input is trusted/self-authored → timeout-only safety (accepted).

---

## 15. Testing strategy (comprehensive)

- **Unit:** section parser (fallback/nesting/exotic), all Zod schemas, anchor re-resolution, diff apply/snapshot, atomic-write helper.
- **Integration:** compile service (success/failure-parse/timeout), self-heal loop, version restore, JD→analyze pipeline, **provider parity** (Claude vs OpenAI honor the same tool contract via mocks).
- **E2E (Playwright):** upload→analyze→discuss→approve→recompile→export; JD-aware analysis; PDF import; compile-break→self-heal/undo.
- **Static:** strict TS, Zod at boundaries, lint in CI. Providers mocked in CI; manual real-provider smoke tests.

---

## 16. Milestones

M0 Skeleton (Next.js+Tailwind+Docker/TeX Live+files; create from `.tex`; compile→preview; export) ·
M1 3-pane editor (CodeMirror, pdf.js, recompile-on-action, section parser) ·
M2 Provider abstraction + feedback (Claude+OpenAI, `generateStructured`, review prompt, anchored list) ·
M3 JD-aware analysis (extract→gap) ·
M4 Agent loop + diff-approve + self-heal ·
M5 PDF import (Jake's Resume template) ·
M6 Polish (version history UI, filters, config screen) — post-v1.

See `checklist.md` for ordered tasks with acceptance criteria.

---

## 17. Decisions log (deviations during implementation)

Records departures from the spec as they happen — what changed, why, which task surfaced it.

- **2026-06-17 · Task 0.2 · `pdfPath` must survive ephemeral-workdir cleanup.** The compile service compiles in an ephemeral temp workdir removed in a `finally` block, but returned `pdfPath` pointing *into* that workdir — a dangling path for the default case (caught only by integrated re-verification reading the file, not the agent's in-memory log check). Fixed: in ephemeral mode the built PDF is copied to a stable temp file (`resumake-pdf-*/resume.pdf`) before cleanup; the returned path is now readable. Caller still owns relocating it into the project dir per §11. Tooling: added `vitest` + `zod` to the scaffold; `vitest.config.ts` with `@`→`src` alias; `test`/`test:watch` scripts.
- **2026-06-17 · Task 0.1 · Next.js 16, not 15.** `create-next-app@latest` (the official scaffolder) now provisions Next.js 16.2.9 with React 19. The spec's "Next.js 15" was a point-in-time reference; the binding requirement is App Router + TypeScript + Node runtime, all satisfied. Using the current stable rather than pinning an older major. tsconfig hardened beyond the default `strict` with `noUncheckedIndexedAccess`, `noImplicitOverride`, `forceConsistentCasingInFileNames`.
