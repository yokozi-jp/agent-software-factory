// Detection-power fixture (#230) for the checking flags of the root tsconfig.json (docs/adr/0020). Each
// `@ts-expect-error` below sits on a line that the flag named in its description makes an error. If the flag is
// removed or turned off, the line has no error, the directive is unused, and `vp check` fails (TS2578).
// repo-policy asks for one such line for every flag, and refuses a project tsconfig.json that sets a flag itself,
// so this project shows that the flag reaches all of them. Knip and jscpd skip __fixtures__/, and nothing imports
// this file.

// @ts-expect-error -- fixture: strict (noImplicitAny): the parameter has no type
export const implicitAny = (value) => String(value);

const list: string[] = [];
// @ts-expect-error -- fixture: noUncheckedIndexedAccess: list[0] is string | undefined
export const first: string = list[0];

// @ts-expect-error -- fixture: exactOptionalPropertyTypes: undefined is not allowed for an optional property
export const optional: { value?: number } = { value: undefined };

class Parent {
  method() {}
}
export class Child extends Parent {
  // @ts-expect-error -- fixture: noImplicitOverride: method overrides Parent.method without `override`
  method() {}
}

// @ts-expect-error -- fixture: noImplicitReturns: the function returns a value on one path only
export function returnsOnOnePath(flag: boolean) {
  if (flag) return 1;
}

export function fallsThrough(value: number): number {
  let result = 0;
  switch (value) {
    // @ts-expect-error -- fixture: noFallthroughCasesInSwitch: case 1 runs into case 2
    case 1:
      result += 1;
    case 2:
      result += 2;
      break;
  }
  return result;
}

export function unreachable(): number {
  return 1;
  // @ts-expect-error -- fixture: allowUnreachableCode: false: nothing runs after the return
  // oxlint-disable-next-line no-unreachable -- fixture: the same line, reported by Oxlint
  return 2;
}

export function unusedLabel(): void {
  // @ts-expect-error -- fixture: allowUnusedLabels: false: nothing refers to the label
  // oxlint-disable-next-line no-unused-labels -- fixture: the same line, reported by Oxlint
  label: for (;;) break;
}

// @ts-expect-error -- fixture: verbatimModuleSyntax: ErrorHandler is a type and must be imported with `type`
import { ErrorHandler } from "hono";
export type Handler = ErrorHandler;

// @ts-expect-error -- fixture: erasableSyntaxOnly: an enum has a runtime meaning that type stripping would lose
export enum Direction {
  Up,
}
