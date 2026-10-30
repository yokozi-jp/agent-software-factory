// Detection-power fixture for the map of tables of a seed (docs/adr/0036): a map that lacks a table must not compile.
// If `TableSeeds` stops requiring a key for every table, the directive is unused and `vp check` fails.
import type { TableSeeds } from "../seed/context.ts";

interface Tables {
  "x.t_one": { id: string };
  "x.t_two": { id: string };
}

// @ts-expect-error -- fixture: "x.t_two" has no writer
export const missingTable: TableSeeds<Tables> = {
  "x.t_one": async () => {},
};

export const complete: TableSeeds<Tables> = {
  "x.t_one": async () => {},
  "x.t_two": async () => {},
};
