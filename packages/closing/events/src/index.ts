import { defineEvent } from "@agent-software-factory/shared";
import { z } from "zod";

// The events that the closing module sends (docs/adr/0046). The claim module reads it to mark the claim closed;
// closed is the last state, and a later review event does not overwrite it.

/** A claim was closed, one event for each claim, with the month it was closed in. */
export const claimClosed = defineEvent("closing.closed", 1, {
  claimId: z.uuid(),
  round: z.int().min(1),
  closingMonth: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
});
export type ClaimClosed = z.infer<typeof claimClosed.schema>;

export const closingEvents = [claimClosed] as const;
