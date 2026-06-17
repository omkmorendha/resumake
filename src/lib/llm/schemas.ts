/**
 * Zod schemas for all structured LLM/API payloads (spec §5). These are the
 * validation boundary: every value crossing the LLM or HTTP edge is parsed
 * through one of these, so the rest of the app works with trusted, typed data.
 *
 * The inferred TS types are exported alongside each schema and are the single
 * source of truth for these shapes app-wide.
 */
import { z } from "zod";

export const SeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "nit",
]);
export type Severity = z.infer<typeof SeveritySchema>;

export const CategorySchema = z.enum([
  "impact",
  "clarity",
  "ats",
  "formatting",
  "relevance",
  "consistency",
  "grammar",
]);
export type Category = z.infer<typeof CategorySchema>;

export const SectionAnchorSchema = z.object({
  sectionId: z.string(),
  sectionTitle: z.string(),
  subBlock: z.string().optional(),
  // Informational only — anchoring re-resolves by sectionId + quoted text.
  texRange: z
    .object({ start: z.number().int(), end: z.number().int() })
    .optional(),
});
export type SectionAnchor = z.infer<typeof SectionAnchorSchema>;

export const FeedbackStatusSchema = z.enum(["open", "addressed", "dismissed"]);
export type FeedbackStatus = z.infer<typeof FeedbackStatusSchema>;

export const FeedbackPointSchema = z.object({
  id: z.string(),
  category: CategorySchema,
  severity: SeveritySchema,
  anchor: SectionAnchorSchema,
  issue: z.string(),
  suggestion: z.string(),
  jdRelevance: z.string().optional(),
  status: FeedbackStatusSchema,
});
export type FeedbackPoint = z.infer<typeof FeedbackPointSchema>;

/**
 * What the review model returns per point — same as FeedbackPoint but without
 * the app-assigned `id` and `status`, which we attach after validation.
 */
export const FeedbackPointDraftSchema = FeedbackPointSchema.omit({
  id: true,
  status: true,
});
export type FeedbackPointDraft = z.infer<typeof FeedbackPointDraftSchema>;

export const ReviewResultSchema = z.object({
  points: z.array(FeedbackPointDraftSchema),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string(),
  ts: z.string(),
  proposedEdit: z
    .object({ diff: z.string(), targetSectionId: z.string().optional() })
    .optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const JobRequirementsSchema = z.object({
  mustHaveSkills: z.array(z.string()),
  niceToHaveSkills: z.array(z.string()),
  yearsExperience: z.string().optional(),
  keywords: z.array(z.string()),
  responsibilities: z.array(z.string()),
  rawText: z.string(),
});
export type JobRequirements = z.infer<typeof JobRequirementsSchema>;

export const ResumeSegmentationSchema = z.object({
  contact: z.object({
    name: z.string(),
    email: z.string(),
    phone: z.string().optional(),
    links: z.array(z.string()),
  }),
  summary: z.string().optional(),
  experience: z.array(
    z.object({
      company: z.string(),
      role: z.string(),
      dates: z.string(),
      bullets: z.array(z.string()),
    }),
  ),
  education: z.array(
    z.object({
      school: z.string(),
      degree: z.string(),
      dates: z.string(),
    }),
  ),
  skills: z.array(z.string()),
  projects: z
    .array(
      z.object({
        name: z.string(),
        desc: z.string(),
        bullets: z.array(z.string()),
      }),
    )
    .optional(),
});
export type ResumeSegmentation = z.infer<typeof ResumeSegmentationSchema>;
