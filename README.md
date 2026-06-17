# Resumake

A **local-first, single-user** web app for AI-driven resume feedback. Upload a LaTeX (or PDF) resume, get structured, section-anchored feedback from an LLM — optionally tailored to a specific job posting — hold a focused conversation on each point, and let an agent loop propose edits to your `.tex` that you review as a diff before applying. Compiles to PDF and exports as `.tex` or `.pdf`.

> **Status:** Pre-implementation / design phase. The architecture is specified in [`features/resume-feedback-app/`](features/resume-feedback-app/); code is not yet written.

## What it does

- **Upload** a `.tex` resume (or a PDF, reconstructed into a clean LaTeX template) → compile → live PDF preview.
- **Structured feedback** — each point has a category (impact, clarity, ATS, relevance, formatting, consistency), a severity, the section it targets, the issue, and a concrete suggestion.
- **Job-posting aware** — paste a job description; it's parsed into structured requirements and the analysis includes a keyword/skills gap analysis.
- **Per-point conversation** — discuss any feedback point with an agent that can read your LaTeX and propose edits.
- **Diff-approve editing** — the agent never writes directly; it proposes a diff you accept or reject. Approved edits are snapshotted (version history), applied, and recompiled.
- **Export** your LaTeX source or the compiled PDF.

## Architecture

| Area | Choice |
| --- | --- |
| Framework | Next.js (App Router, TypeScript), Node server runtime |
| AI providers | Claude via `@anthropic-ai/claude-agent-sdk` (subscription OAuth) + OpenAI via API key, behind one abstraction |
| Persistence | Files only — per-project directories with JSON sidecars |
| LaTeX → PDF | `latexmk` + full TeX Live in a Docker container; Node runs on the host |
| Section anchoring | Heuristic LaTeX parsing (`\section` / environments) + quoted-text matching |
| UI | 3-pane: LaTeX source · PDF preview · Feedback/Chat |

Full design, data model, API surface, system prompts, and risks: **[`features/resume-feedback-app/design.html`](features/resume-feedback-app/design.html)**.

## Auth & licensing notes

- Claude access uses **your own** Claude subscription via `claude setup-token` (`CLAUDE_CODE_OAUTH_TOKEN`). **Note:** if `ANTHROPIC_API_KEY` is set in your environment, the Agent SDK uses it (billed as API credits) *instead of* your subscription — unset it.
- This is a **personal, single-user, local** tool. Anthropic does not permit offering subscription/claude.ai login to other end users without prior approval, so this must not become a hosted multi-user service sharing one subscription.

## Status of this repo

This repository currently holds the **pre-implementation design**. The build is planned in milestones (M0–M6) described in the design document. Contributions/issues welcome once implementation begins.

## License

MIT — see [LICENSE](LICENSE).
