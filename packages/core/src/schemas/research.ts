import { z } from "zod";

// research_data de episodes (ADR-008): saída da fase 1 (grounding), consumida pela fase 2.
export const researchClaimSchema = z.object({
  claim: z.string().min(1),
  source_url: z.string().url(),
  confidence: z.number().min(0).max(1),
  query_used: z.string().min(1),
});

export const researchDataSchema = z.array(researchClaimSchema).min(1).max(20);

export type ResearchClaim = z.infer<typeof researchClaimSchema>;
export type ResearchData = z.infer<typeof researchDataSchema>;
