// Detection-power fixture (#43) for the type Result (docs/adr/0027). Each declaration below is a value that the
// type must refuse. If the type is loosened, the `@ts-expect-error` comment is unused and `vp check` fails.
// Knip and jscpd skip __fixtures__/, and nothing imports this file.
import type { Result } from "../result.ts";

type NoLines = { readonly _tag: "NoLines" };
type TotalExceedsLimit = { readonly _tag: "TotalExceedsLimit"; readonly limit: number };
type SubmitError = NoLines | TotalExceedsLimit;

// @ts-expect-error -- fixture: an Ok without its value
export const okWithoutValue: Result<number, SubmitError> = { _tag: "Ok" };

// @ts-expect-error -- fixture: an Err without its error
export const errWithoutError: Result<number, SubmitError> = { _tag: "Err" };

export const unknownFailure: Result<number, SubmitError> = {
  _tag: "Err",
  // @ts-expect-error -- fixture: a failure whose _tag is not in the union
  error: { _tag: "Other" },
};

export const incompleteFailure: Result<number, SubmitError> = {
  _tag: "Err",
  // @ts-expect-error -- fixture: a failure that lacks a field of its _tag
  error: { _tag: "TotalExceedsLimit" },
};

// @ts-expect-error -- fixture: a _tag that is neither Ok nor Err
export const unknownTag: Result<number, SubmitError> = { _tag: "Maybe", value: 1 };

// The values that the type accepts. They carry no comment, so `vp check` fails if the type refuses one.
export const ok: Result<number, SubmitError> = { _tag: "Ok", value: 1 };
export const err: Result<number, SubmitError> = { _tag: "Err", error: { _tag: "NoLines" } };
