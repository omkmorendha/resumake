/**
 * The four constrained agent tools (spec §7, Task 4.1). The agent may ONLY call
 * these — Read/Edit/Bash and all other filesystem/shell tools are excluded at
 * the provider level (ClaudeProvider.DISALLOWED_TOOLS; OpenAI only exposes
 * these four). Each tool validates its input with Zod and returns a ToolResult.
 *
 * Tools operate over a per-thread {@link ToolContext}: the project, the feedback
 * point under discussion, the live (possibly staged) `.tex`, and helpers to
 * parse/compile. `propose_edit` STAGES a diff in memory — it never writes to
 * disk; the approval gate (Task 4.4) is what persists an edit.
 */
import { z } from "zod";

import { CompileService } from "@/lib/latex";
import type { FeedbackPoint, JobRequirements, ToolResult } from "@/lib/llm";
import { parseSections, type ParsedSection } from "@/lib/parser";

import { makeUnifiedDiff } from "./diff";

/** Zod input schemas for the tools (spec §7). */
export const ReadResumeInput = z.object({});
export const GetContextInput = z.object({ sectionId: z.string().optional() });
export const ProposeEditInput = z.object({
  sectionId: z.string(),
  find: z.string().min(1),
  replace: z.string(),
  rationale: z.string(),
});
export const RecompileInput = z.object({});

export interface StagedEdit {
  sectionId: string;
  find: string;
  replace: string;
  rationale: string;
  /** The full proposed `.tex` after applying find→replace. */
  proposedTex: string;
  /** Unified diff (current → proposed) for the approval UI. */
  diff: string;
}

export interface ToolContext {
  projectId: string;
  /** The feedback point this conversation is scoped to (spec §7 get_context). */
  feedbackPoint: FeedbackPoint;
  /** Current resume `.tex` (the staged version if an edit is pending). */
  getTex: () => string;
  /** Stage a proposed edit (no disk write); replaces any prior staged edit. */
  setStagedEdit: (edit: StagedEdit | null) => void;
  getStagedEdit: () => StagedEdit | null;
  /** JD requirements if present. */
  jobRequirements: JobRequirements | null;
  /** Prior chat in this thread (bounded), newest last. */
  priorChat: { role: string; content: string }[];
  /** Compile service (injected for tests). */
  compileService?: CompileService;
}

function sectionText(tex: string, section: ParsedSection): string {
  return tex.slice(section.texRange.start, section.texRange.end);
}

/** A few lines of context on either side of the section, for the agent. */
function adjacentContext(tex: string, section: ParsedSection): string {
  const start = Math.max(0, section.texRange.start - 200);
  const end = Math.min(tex.length, section.texRange.end + 200);
  return tex.slice(start, end);
}

export function buildResumeTools(ctx: ToolContext) {
  const read_resume = {
    name: "read_resume" as const,
    description:
      "Return the current resume LaTeX source and its parsed section tree.",
    inputSchema: ReadResumeInput,
    execute: async (): Promise<ToolResult> => {
      const tex = ctx.getTex();
      const sections = parseSections(tex).map((s) => ({
        sectionId: s.sectionId,
        title: s.title,
        level: s.level,
      }));
      return { ok: true, data: { tex, sections } };
    },
  };

  const get_context = {
    name: "get_context" as const,
    description:
      "Return the feedback point, job requirements (if any), the target section text with adjacent lines, and prior chat in this thread.",
    inputSchema: GetContextInput,
    execute: async (input: unknown): Promise<ToolResult> => {
      const { sectionId } = GetContextInput.parse(input);
      const tex = ctx.getTex();
      const sections = parseSections(tex);
      const target =
        sections.find(
          (s) => s.sectionId === (sectionId ?? ctx.feedbackPoint.anchor.sectionId),
        ) ?? sections[0];
      return {
        ok: true,
        data: {
          feedbackPoint: ctx.feedbackPoint,
          jobRequirements: ctx.jobRequirements,
          section: target
            ? {
                sectionId: target.sectionId,
                title: target.title,
                text: sectionText(tex, target),
                withAdjacent: adjacentContext(tex, target),
              }
            : null,
          priorChat: ctx.priorChat,
        },
      };
    },
  };

  const propose_edit = {
    name: "propose_edit" as const,
    description:
      "Stage a find→replace edit within a section. Shows the user a diff to approve; nothing is written until they accept.",
    inputSchema: ProposeEditInput,
    execute: async (input: unknown): Promise<ToolResult> => {
      const { sectionId, find, replace, rationale } = ProposeEditInput.parse(input);
      const tex = ctx.getTex();
      if (!tex.includes(find)) {
        return {
          ok: false,
          error: `The 'find' text was not found in the resume. It must match the current source exactly.`,
        };
      }
      // Replace only the first occurrence to keep edits surgical.
      const idx = tex.indexOf(find);
      const proposedTex = tex.slice(0, idx) + replace + tex.slice(idx + find.length);
      const diff = makeUnifiedDiff(tex, proposedTex);
      const staged: StagedEdit = { sectionId, find, replace, rationale, proposedTex, diff };
      ctx.setStagedEdit(staged);
      return { ok: true, data: { diff, sectionId, rationale } };
    },
  };

  const recompile = {
    name: "recompile" as const,
    description:
      "Compile the current (or staged) resume and return success or the first LaTeX error.",
    inputSchema: RecompileInput,
    execute: async (): Promise<ToolResult> => {
      const staged = ctx.getStagedEdit();
      const tex = staged ? staged.proposedTex : ctx.getTex();
      const svc = ctx.compileService ?? new CompileService();
      const result = await svc.compile({ tex });
      if (result.ok) {
        return { ok: true, data: { compiled: true } };
      }
      return {
        ok: false,
        error: result.firstError
          ? `${result.firstError.message}${result.firstError.line ? ` (line ${result.firstError.line})` : ""}`
          : "Compile failed.",
      };
    },
  };

  return { read_resume, get_context, propose_edit, recompile };
}

export type ResumeToolset = ReturnType<typeof buildResumeTools>;
