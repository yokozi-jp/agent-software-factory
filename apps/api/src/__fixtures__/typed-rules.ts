// Detection-power fixture (#230) for the rules that apply to every file: vite-plus/prefer-vite-plus-imports and the
// `typedRules` of the root vite.config.ts (docs/adr/0020). Each line below is one that a rule must report. If a
// rule is turned off, the disable comment is unused and `vp check` fails (reportUnusedDisableDirectives). The
// flags of the root tsconfig.json are in tsconfig-flags.ts. Knip and jscpd skip __fixtures__/, and nothing imports
// this file.
//
// A value of type `any` comes from JSON.parse, so that no line needs the type `any` itself.

// @ts-expect-error -- fixture: apps/api does not depend on vitest, so the import does not resolve
// oxlint-disable-next-line vite-plus/prefer-vite-plus-imports -- fixture: import from vite-plus/test, not vitest
import "vitest";

// oxlint-disable-next-line typescript/ban-ts-comment -- fixture: @ts-ignore is banned
// @ts-ignore -- fixture: hides the type error of the line below
export const ignored: number = "not a number";

// oxlint-disable-next-line typescript/no-explicit-any -- fixture: the type any
export const explicitAny: any = 1;

// oxlint-disable-next-line typescript/no-empty-object-type -- fixture: {} accepts every value but null
export type EmptyObject = {};

// oxlint-disable-next-line typescript/no-namespace -- fixture: a namespace
export namespace Namespace {
  export type Member = number;
}

// oxlint-disable-next-line typescript/no-require-imports, no-restricted-globals -- fixture: require; the second rule reports `require` too (docs/adr/0007)
export const required: unknown = require("effect");

// oxlint-disable-next-line typescript/no-unnecessary-type-constraint -- fixture: T extends unknown constrains nothing
export type Constrained<T extends unknown> = T;

// oxlint-disable-next-line typescript/no-unsafe-function-type -- fixture: the type Function
export type AnyFunction = Function;

// oxlint-disable-next-line typescript/no-misused-promises -- fixture: an async function where a function that returns void is expected
export const misused = [1].forEach(async (n) => await Promise.resolve(n));

const one: number = 1;
// oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- fixture: one is a number already
export const asserted = one as number;

// oxlint-disable-next-line typescript/no-unsafe-argument -- fixture: an any passed as an argument
export const argument = Math.abs(JSON.parse("1"));

// oxlint-disable-next-line typescript/no-unsafe-assignment -- fixture: an any assigned to a variable
export const assigned = JSON.parse("1");

// oxlint-disable-next-line typescript/no-unsafe-call -- fixture: an any called as a function
export const called: unknown = JSON.parse("1")();

// oxlint-disable-next-line typescript/no-unsafe-member-access -- fixture: a property read from an any
export const member: unknown = JSON.parse("{}").property;

// oxlint-disable-next-line typescript/no-unsafe-return -- fixture: an any returned from a function of type number
export const returned = (): number => JSON.parse("1");

// @ts-expect-error -- fixture: erasableSyntaxOnly rejects the enum that the comparison below needs
enum Level {
  Low,
  High,
}
// oxlint-disable-next-line typescript/no-unsafe-enum-comparison -- fixture: an enum compared with a number
export const compared = (level: Level) => level === 0;

export const thrown = (): never => {
  // oxlint-disable-next-line typescript/only-throw-error -- fixture: a string thrown instead of an Error
  throw "text";
};

// oxlint-disable-next-line typescript/prefer-promise-reject-errors -- fixture: a string as the reason of a rejection
export const rejected = Promise.reject("text");

// oxlint-disable-next-line typescript/require-await -- fixture: an async function with no await
export const withoutAwait = async () => 1;

// oxlint-disable-next-line typescript/restrict-plus-operands -- fixture: a Date as an operand of +
export const added = (date: Date) => date + "text";

type Color = "red" | "green";
export const exhaustive = (color: Color): number => {
  // oxlint-disable-next-line typescript/switch-exhaustiveness-check -- fixture: a switch that leaves out "green"
  switch (color) {
    case "red":
      return 1;
  }
  return 0;
};

// oxlint-disable-next-line typescript/no-non-null-assertion -- fixture: ! on a value that may be undefined
export const nonNull = (value: string | undefined): string => value!;

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fixture: as narrows unknown without checking it
export const narrowed = (value: unknown): string => value as string;
