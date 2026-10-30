import { defineEvent } from "@agent-software-factory/shared-kernel";
import { z } from "zod";

// The events that the approval module sends (docs/adr/0046). The claim module reads them to update its copy of the
// claim's state, and ignores a message whose (round, reviewVersion) is not newer than the last one it applied.

const review = {
  claimId: z.uuid(),
  round: z.int().min(1),
  reviewVersion: z.int().min(0),
};

/** A review began: the review, the claim and round it is for, and the manager who approves. */
export const reviewStarted = defineEvent("approval.review_started", 1, {
  reviewId: z.uuid(),
  claimId: z.uuid(),
  round: z.int().min(1),
  managerId: z.string().min(1),
});
export const approved = defineEvent("approval.approved", 1, review);
export const confirmed = defineEvent("approval.confirmed", 1, review);
export const withdrawn = defineEvent("approval.withdrawn", 1, review);
/** A manager or accounting sent the claim back, with who did it and why. */
export const sentBack = defineEvent("approval.sent_back", 1, {
  ...review,
  actorId: z.string().min(1),
  reason: z.string().min(1),
});

export type ReviewStarted = z.infer<typeof reviewStarted.schema>;
export type Approved = z.infer<typeof approved.schema>;
export type Confirmed = z.infer<typeof confirmed.schema>;
export type Withdrawn = z.infer<typeof withdrawn.schema>;
export type SentBack = z.infer<typeof sentBack.schema>;

export const approvalEvents = [reviewStarted, approved, confirmed, withdrawn, sentBack] as const;
