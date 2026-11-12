// Check that every project with code writes a coverage record (docs/adr/0053, #578).
import { isMeasured } from "../merged-coverage/rules.ts";
import { Tree, record } from "./tree.ts";

// The Nx projects that write a record: apps/<x>, packages/<x> and packages/<x>/events. The directory of a measured file is
// the project it belongs to. isMeasured is the list of files the merged check counts, so the two cannot differ.
// A directory with no package.json is not a package of the workspace, so it is not a project here.
// A measured path begins with apps or packages and `.*` takes the rest, so the regex does not need `^` or `$`; they stay for the reader.
const projectOf = (path: string): string =>
  // Stryker disable next-line Regex: equivalent, see above.
  path.replace(/^((?:apps|packages)\/[^/]+(?:\/events)?)\/src\/.*$/u, "$1");

const coverageVersion = "@vitest/coverage-v8";

// `vp test run`, with the option that writes the record. The other options are free (i18n and shared-kernel exclude
// fixtures); `--coverage=false` and `--coverage.enabled` are not the option.
const testScript = /^vp test run(?:\s.*)?\s--coverage(?:\s|$)/u;

// A call of the helper that writes the record. vite.config.ts is read as text (as in rules.ts), so a call in a comment is
// not told from one in the code: removing comments by pattern fails on the globs in the strings (`"src/**/*.ts"` has `/*`).
const recordHelper = /\b(?:recordCoverage|recordOnlyConfig)\(/u;

// ADR 0053: the merged check adds up the records of the projects that wrote one, so a project that does not write one is
// left out without a failure. Each project that has code the check counts (isMeasured) must write its record: a test script
// that runs with --coverage, @vitest/coverage-v8 (the provider), and a vite.config.ts that calls recordCoverage
// or recordOnlyConfig (vitest-coverage.ts). The file alone is not enough: a vite.config.ts with no `coverage` writes no record.
export function projectsWriteCoverage(tree: Tree): string[] {
  const projects = new Set(
    tree.paths
      .filter(isMeasured)
      .map(projectOf)
      .filter((project) => tree.paths.includes(`${project}/package.json`)),
  );
  return [...projects].toSorted().flatMap((project) => {
    const manifest = `${project}/package.json`;
    const json = record(tree.parsed(manifest));
    const script = String(record(json.scripts).test);
    const config = `${project}/vite.config.ts`;
    const failures: string[] = [];
    if (!testScript.test(script))
      failures.push(
        `${manifest} must have a test script that runs "vp test run" with --coverage, so that ${project} writes coverage/coverage-final.json and the merged check counts its files (docs/adr/0053, docs/tooling/ci.md).`,
      );
    if (!(coverageVersion in record(json.devDependencies)))
      failures.push(
        `${manifest} must have ${coverageVersion} in devDependencies ("catalog:"), the provider that writes the record (docs/adr/0053).`,
      );
    if (!recordHelper.test(tree.read(config)))
      failures.push(
        `${config} must call recordCoverage or recordOnlyConfig of vitest-coverage.ts, so that ${project} writes its record (docs/adr/0053).`,
      );
    return failures;
  });
}
