// Check that every project with code writes a coverage record (docs/adr/0053, #578).
import { isMeasured, parsePolicy, projectOf } from "../merged-coverage/rules.ts";
import { Tree, list, record } from "./tree.ts";

const coverageVersion = "@vitest/coverage-v8";
const policyPath = "coverage-policy.json";

// A test script that runs `vp test run` with the option that writes the record. The other options are free (i18n and
// shared-kernel exclude fixtures). It is one command: a shell operator or a comment would let `--coverage` be text that
// does not run, and an option that turns the record off is not the option.
const shellSyntax = /[&|;#<>`$()\n]/u;
const recordOff = /^--(?:no-coverage|coverage(?:\.enabled)?=false)$/u;
function runsWithCoverage(script: unknown): boolean {
  // Stryker disable next-line ConditionalExpression: equivalent, a script that is not a string does not match below either.
  if (typeof script !== "string" || shellSyntax.test(script)) return false;
  const words = script.split(/\s+/u);
  return (
    words.slice(0, 3).join(" ") === "vp test run" &&
    words.includes("--coverage") &&
    !words.some((word) => recordOff.test(word))
  );
}

// The helper of vitest-coverage.ts that makes the `coverage` options of a vite.config.ts, used in one of the ways the
// projects use it: spread or set into `coverage`, or as the default export. A call whose result is dropped writes
// no record. vite.config.ts is read as text (as in rules.ts), so a call in a comment is not told from one in the code:
// removing comments by pattern fails on the globs in the strings (`"src/**/*.ts"` has `/*`).
const recordHelper =
  /(?:\.\.\.|\bcoverage:\s*|\bexport default\s+)(?:recordCoverage|recordOnlyConfig)\(/u;
const recordImport =
  /\bimport\s*\{[^}]*\b(?:recordCoverage|recordOnlyConfig)\b[^}]*\}\s*from\s*["'](?:\.\.\/)+vitest-coverage\.ts["']/u;

// ADR 0053: the merged check adds up the records of the projects that wrote one, so a project that does not write one is
// left out without a failure. Each project that has code the check counts (isMeasured) must write its record: a test script
// that runs with --coverage, @vitest/coverage-v8 (the provider), and a vite.config.ts that imports and uses
// recordCoverage or recordOnlyConfig (vitest-coverage.ts). The file alone is not enough: a vite.config.ts with no `coverage`
// writes no record. A project is the nearest directory with a package.json, as in projectOf of the merged check; code
// with no package.json above it belongs to none (it is not a package of the workspace, so nothing runs its tests).
export function projectsWriteCoverage(tree: Tree): string[] {
  // What counts is the table of coverage-policy.json (#577). A file that does not parse is reported by the tree.
  if (tree.maybe(policyPath) === undefined) return [`${policyPath} is missing (docs/adr/0053).`];
  const value = tree.parsed(policyPath);
  if (value === undefined) return [];
  const policy = parsePolicy(value);
  if (typeof policy === "string") return [policy];
  // A directory of `projects` that the workspace does not list holds no project that Nx runs, so it would write no record.
  const workspace = list(record(tree.parsed("pnpm-workspace.yaml")).packages);
  const unlisted = policy.projects
    .filter((glob) => !workspace.includes(glob))
    .map(
      (glob) =>
        `pnpm-workspace.yaml must list "${glob}" in packages, as coverage-policy.json does in projects: a directory that is not a workspace package is not run by Nx, so it writes no coverage record (docs/adr/0053).`,
    );
  const packages = tree.paths
    .filter((path) => path.endsWith("/package.json"))
    .map((path) => path.slice(0, -"/package.json".length));
  const projects = new Set(
    tree.paths
      .filter((path) => isMeasured(path, policy))
      .flatMap((path) => projectOf(path, packages) ?? []),
  );
  const failures = [...projects].toSorted().flatMap((project) => {
    const manifest = `${project}/package.json`;
    const json = record(tree.parsed(manifest));
    const config = `${project}/vite.config.ts`;
    const source = tree.read(config);
    const failures: string[] = [];
    if (!runsWithCoverage(record(json.scripts).test))
      failures.push(
        `${manifest} must have a test script that starts with "vp test run" and has --coverage, as one command, so that ${project} writes coverage/coverage-final.json and the merged check counts its files (docs/adr/0053, docs/tooling/ci.md).`,
      );
    if (!(coverageVersion in record(json.devDependencies)))
      failures.push(
        `${manifest} must have ${coverageVersion} in devDependencies ("catalog:"), the provider that writes the record (docs/adr/0053).`,
      );
    if (!recordImport.test(source) || !recordHelper.test(source))
      failures.push(
        `${config} must import recordCoverage or recordOnlyConfig from vitest-coverage.ts and use it as the default export or in \`coverage\`, so that ${project} writes its record (docs/adr/0053).`,
      );
    return failures;
  });
  return [...unlisted, ...failures];
}
