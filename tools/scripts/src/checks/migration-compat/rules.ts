// The rules of the migration compatibility test (docs/adr/0037): how the migrations that a pull request changes are
// told apart, and whether the base's integration tests are run against the database with them applied.
// Pure functions; cli.ts runs git and the tests and prints what these return.
import { annotationText, type Env, type Output } from "../output.ts";

// Where the migrations are, and the files of the base that the test needs. If the migrations move, change these
// (docs/adr/0037 "Consequences").
export const migrationsDirectory = "packages/db/migrations/";
// The entry of the seed. The base's integration tests run on a database that this seed filled (docs/adr/0036).
export const seedEntry = "packages/db/src/seed/index.ts";
// The harness: the file that prepares the database for the integration tests, and the name of the environment
// variable that it reads the migration files from. A base without the name in the file cannot apply the files, and
// would pass the tests without the pull request's migrations. packages/db/src/testing/prepare-database.ts
// declares the same name.
export const harnessEntry = "packages/db/src/testing/prepare-database.ts";
export const harnessMarker = "MIGRATION_COMPAT_FILES";

export interface MigrationChanges {
  readonly added: readonly string[];
  readonly modified: readonly string[];
  readonly deleted: readonly string[];
}

// Sorts the files under the migrations directory by what the pull request did to them. `nameStatus` is the output
// of `git diff --name-status --no-renames` from the merge base to HEAD, so a rename is a delete and an add.
// A type change (T) is a change.
export function classifyMigrations(nameStatus: string): MigrationChanges {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const line of nameStatus.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const path = line.slice(tab + 1);
    if (!path.startsWith(migrationsDirectory)) continue;
    const status = line.slice(0, tab);
    if (status === "A") added.push(path);
    else if (status === "D") deleted.push(path);
    else modified.push(path);
  }
  return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort() };
}

export interface Base {
  readonly hasSeed: boolean;
  readonly hasHarness: boolean;
}

export type Decision =
  | { readonly kind: "fail"; readonly message: string }
  | { readonly kind: "skip"; readonly message: string }
  | { readonly kind: "run"; readonly files: readonly string[] };

// A rewrite or a delete fails first, before any database starts. Then a pull request that adds no migration passes.
// Then a base without the seed or the harness passes with a notice (the first pull request, which adds them).
export function decide(changes: MigrationChanges, base: Base): Decision {
  const touched = [
    ...changes.modified.map((path) => `${path} (changed)`),
    ...changes.deleted.map((path) => `${path} (deleted)`),
  ];
  if (touched.length > 0)
    return {
      kind: "fail",
      message: `A migration that the base has must not be changed or deleted; add a forward migration instead (docs/adr/0025, docs/adr/0037): ${touched.join(", ")}.`,
    };
  if (changes.added.length === 0)
    return {
      kind: "skip",
      message: `The pull request adds no migration in ${migrationsDirectory}.`,
    };
  if (!base.hasSeed)
    return {
      kind: "skip",
      message: `The base has no ${seedEntry}, so the compatibility test is skipped.`,
    };
  if (!base.hasHarness)
    return {
      kind: "skip",
      message: `The base's ${harnessEntry} does not read ${harnessMarker}, so it cannot apply the pull request's migrations, and the compatibility test is skipped.`,
    };
  return { kind: "run", files: changes.added };
}

const inCi = (env: Env): boolean => env.GITHUB_ACTIONS === "true";
const line = (text: string): string => `${text}\n`;

// What cli.ts prints for a decision that does not run the tests. A failure goes to stdout as an ::error:: in
// GitHub Actions (where the log shows it), and to stderr elsewhere.
export function report(decision: Exclude<Decision, { kind: "run" }>, env: Env): Output {
  const { kind, message } = decision;
  if (inCi(env)) {
    const command = kind === "fail" ? "error" : "notice";
    return {
      stdout: line(`::${command} title=migration-compat::${annotationText(message)}`),
      stderr: "",
    };
  }
  return kind === "fail"
    ? { stdout: "", stderr: line(`migration-compat: ${message}`) }
    : { stdout: line(`migration-compat: skipped. ${message}`), stderr: "" };
}
