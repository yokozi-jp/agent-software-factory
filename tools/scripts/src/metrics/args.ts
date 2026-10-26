// The arguments of the factory metrics script (cli.ts): a period of JST days, or a boundary pull request
// and how many pull requests to compare on each side of it (docs/agents/factory-metrics.md).
import { parseArgs as parseNodeArgs } from "node:util";
import { DAY, startOf } from "./jst.ts";

export const USAGE = [
  "usage: node tools/scripts/src/metrics/cli.ts --since YYYY-MM-DD [--until YYYY-MM-DD]",
  "       node tools/scripts/src/metrics/cli.ts --pr <number> --count <N>",
].join("\n");

export type Options =
  // Pull requests merged from `since` (included) to `until` (excluded), in milliseconds.
  | { readonly kind: "period"; readonly since: number; readonly until: number }
  // The `count` pull requests merged before pull request `pull`, and the `count` after it.
  | { readonly kind: "boundary"; readonly pull: number; readonly count: number };

const positive = (value: string | undefined): number | undefined =>
  /^[1-9]\d*$/.test(String(value)) ? Number(value) : undefined;

// The options of argv (without node and the script), or what is wrong with it. `--until` is a day included in
// the period; without it, the period runs until `now`.
export function parseArgs(argv: readonly string[], now: number): Options | string {
  let values;
  try {
    ({ values } = parseNodeArgs({
      args: [...argv],
      options: {
        since: { type: "string" },
        until: { type: "string" },
        pr: { type: "string" },
        count: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return String(error);
  }
  const { since, until, pr, count } = values;

  if (pr !== undefined || count !== undefined) {
    if (since !== undefined || until !== undefined)
      return "give either --since and --until, or --pr and --count";
    const pull = positive(pr);
    const n = positive(count);
    if (pull === undefined || n === undefined)
      return "--pr and --count both take a positive whole number";
    return { kind: "boundary", pull, count: n };
  }

  if (since === undefined) return "give --since, or --pr and --count";
  const start = startOf(since);
  if (start === undefined) return `--since is not a date (YYYY-MM-DD): ${since}`;
  let end = now;
  if (until !== undefined) {
    const last = startOf(until);
    if (last === undefined) return `--until is not a date (YYYY-MM-DD): ${until}`;
    end = last + DAY;
  }
  if (start >= end) return "--since must be a day before --until (and before now)";
  return { kind: "period", since: start, until: end };
}
