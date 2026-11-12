import type { Permit } from "@agent-software-factory/shared-kernel";

// The 申請 (claim). A claim is in one of six states (docs/domain-model/types.md); only the first, 下書き (draft), is written
// so far, by the first route (POST /api/claims). The other states come with the routes that move a claim into them.

/** The id of a claim: the `claim_id` of the table, a positive bigint written in decimal. */
export type ClaimId = string & { readonly __brand: "ClaimId" };

const MAX_CLAIM_ID = "9223372036854775807";

/** Whether `input` is a positive 64-bit integer in decimal digits, with no sign and no leading zero. */
export const isClaimId = (input: string): input is ClaimId => {
  if (!/^[1-9][0-9]*$/.test(input)) return false;
  if (input.length !== MAX_CLAIM_ID.length) return input.length < MAX_CLAIM_ID.length;
  return input <= MAX_CLAIM_ID;
};

/** A draft that is not saved yet, so it has no id: the database gives it one. */
export type NewDraft = {
  readonly _tag: "NewDraft";
  readonly applicantId: string;
};

/** A saved claim in the state 下書き. The applicant is the user who made it. */
export type Draft = {
  readonly _tag: "Draft";
  readonly id: ClaimId;
  readonly applicantId: string;
};

/**
 * Makes a draft for the user the permit was given to (docs/adr/0045: anyone may make a draft of their own, and the
 * transition takes the proof, not the user). It does not know who asked: the applicant is the user of the permit.
 */
export const createDraft = (args: { permit: Permit<"CreateClaim"> }): NewDraft => ({
  _tag: "NewDraft",
  applicantId: args.permit.actorId,
});
