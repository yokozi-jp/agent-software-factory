import { defineEvent } from "@agent-software-factory/shared-kernel";
import { z } from "zod";

// The events that the claim module sends (docs/adr/0046). A message of the claim module's events is read by
// approval, which makes a review of it.

/** A claim was submitted: the claim, its round, the applicant, the manager chosen at submission, and the lines. */
export const claimSubmitted = defineEvent("claim.submitted", 1, {
  claimId: z.uuid(),
  round: z.int().min(1),
  applicantId: z.string().min(1),
  managerId: z.string().min(1),
  lines: z
    .array(
      z.object({
        category: z.string().min(1),
        usedOn: z.iso.date(),
        amount: z.int(),
      }),
    )
    .min(1),
  total: z.int(),
});
export type ClaimSubmitted = z.infer<typeof claimSubmitted.schema>;

export const claimEvents = [claimSubmitted] as const;
