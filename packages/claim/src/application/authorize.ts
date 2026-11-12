import type { Permit, RequestActor } from "@agent-software-factory/shared-kernel";

/**
 * The operations on a claim that `authorize` decides (docs/adr/0045). One for now; the others (read, add a line, submit, ...)
 * are added with their routes, each with the targets and the denials it needs.
 */
export type ClaimOperation = { readonly _tag: "CreateClaim" };

/**
 * The one place that decides who may do what to a claim, and the one that makes a `Permit` (docs/adr/0045,
 * docs/domain-model/authorization.md). A user of the tenant may make a draft of their own, in no state: a denial would
 * need a target to see, and there is none, so this operation always allows and returns the permit itself. An operation that
 * can be denied returns a `Result` with the `_tag` of the denial (404 when the user cannot see the target, 403 when they can).
 */
export function authorize(args: {
  readonly actor: RequestActor;
  readonly operation: ClaimOperation;
}): Permit<"CreateClaim"> {
  return { __brand: "Permit", operation: args.operation._tag, actorId: args.actor.userId };
}
