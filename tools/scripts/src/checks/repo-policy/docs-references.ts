// Checks of the references between docs/ and the code: to docs/ from outside it, and to files of the code from inside it
// and from the configs and scripts outside it.
import { posix } from "node:path";
import { Tree } from "./tree.ts";

// Sources that no check of a path reads: the upstream skills, the research notes (they quote paths of other commits and
// of upstream repositories), and the lock files, which name files that are not in the tree.
const neverRead = [
  /^\.agents\//,
  /^\.kiro\/skills\//,
  /^research\//,
  /^pnpm-lock\.yaml$/,
  /^mise\.lock$/,
];

// What to say after a docs/ path or ADR number that the tree does not have. Only files in the index count, so a
// file just written and not yet staged is reported as missing too.
const stagingHint = "A new file counts once it is staged (git add).";

// What to say after a path that the tree does not have.
const moved = "The file was moved or removed: write its path now, or the directory it is in.";

// References to docs/ from outside docs/ (scripts, configs, AGENTS.md, steering, workflows).
// docs-check (tools/scripts/src/checks/docs-check/) only follows Markdown links inside docs/, so these plain-text paths are checked here:
//   a path to a Markdown file under docs/       the file must exist
//   the same path, then ("Heading")             the file must have a heading with that text (cited
//                                               without its number; \" in a JSON string counts as ")
//   docs/adr/ and a four-digit number           an ADR with that number must exist
// .agents/ and .kiro/skills/ hold upstream skills; docs/ itself is covered by docs-check. The tests and
// fixtures of adr-check and repo-policy cite missing ADRs on purpose. research/ holds the notes of
// wayfinder research tickets, which live on throwaway branches and are never merged; they quote paths
// of other commits and of upstream repositories.
const unchecked = [
  /^docs\//,
  ...neverRead,
  /^tools\/scripts\/src\/checks\/(adr-check|repo-policy)\/([^/]*\.test\.ts$|fixtures\/)/,
];

const docsReference =
  /(?<![A-Za-z0-9_./-])docs\/(?:([A-Za-z0-9_./-]+\.md)(?: \(\\?"([^"\\]+)\\?"\))?|adr\/([0-9]{4})(?![0-9-]))/g;

const hasHeading = (text: string, heading: string): boolean =>
  text.split("\n").some((line) => {
    const title = /^#+ (.*)/.exec(line)?.[1];
    return title === heading || title?.replace(/^[0-9]+\. /, "") === heading;
  });

export function docsReferences(tree: Tree): string[] {
  const failures: string[] = [];
  for (const source of tree.paths) {
    if (unchecked.some((pattern) => pattern.test(source))) continue;
    const text = tree.read(source);
    if (text.includes("\0")) continue;
    for (const [, file, heading, number] of text.matchAll(docsReference)) {
      if (number !== undefined) {
        if (
          !tree.paths.some((path) => path.startsWith(`docs/adr/${number}-`) && path.endsWith(".md"))
        )
          failures.push(`${source} cites docs/adr/${number}, which does not exist. ${stagingHint}`);
        continue;
      }
      const path = `docs/${file}`;
      const target = tree.maybe(path);
      if (target === undefined)
        failures.push(`${source} cites ${path}, which does not exist. ${stagingHint}`);
      else if (heading !== undefined && !hasHeading(target, heading))
        failures.push(
          `${source} cites the heading "${heading}" in ${path}, which has no such heading.`,
        );
    }
  }
  return failures;
}

// References from docs/, the configs and the scripts to files of the code: inline code in docs/ (including ADRs), and
// the paths in lefthook.yml, the workflows, knip.jsonc, the compose files, the comments of vite.config.ts and the checks
// of tools/scripts. A file that is moved or removed leaves its path behind, and some of them are read by a check that
// then passes on nothing (migration-compat names the entry of the seed; a path that does not exist makes it skip its
// work).
//   in docs/ (*.md)        a path in inline code to a file (ending with an extension) under a top-level directory.
//                          A directory and a path outside inline code are not read: docs/ writes the paths of the
//                          past (an ADR names a file as it was, or as an option not taken) that way.
//   in configs and scripts the same in plain text, a directory ending with `/` (some file of the tree must be under it),
//                          and a relative path (`./` and `../` in front, resolved from the directory of the source)
// A glob (`packages/*/src/a.ts`, `apps/web/src/**`), a placeholder (`packages/<name>/a.ts`) and a path that is part of a
// longer one (a URL, or an upstream repository path such as `<upstream>/.github/workflows/ci.yml` or
// `owner/repo/.github/ISSUE_TEMPLATE/idea.yml`) are not a path the tree must have, and nor is a root alone (`packages/`).
// The top-level directories are those of the tree itself, so a new one is read without a change here.
// Not read: non-Markdown files in docs/, the tests and fixtures (a test builds a small repository of its own, and cites
// paths that do not exist on purpose), generated files, the changelogs, and an ignore file, which names the files that
// git does not track.
// Out of reach (docs/tooling/ci.md): a path that does not start with a top-level directory (`src/seed/index.ts`, relative
// to a package nobody names), a path with escaped slashes in JSON (`packages\/a\/b.ts`), and a path of the past outside
// docs/. An untracked output is read only under a top-level directory of the tree: `coverage/` and `.nx/` are not
// read, and the dist/ of a package is, so it is written as a glob (`apps/api/dist/**`) or from its package (`dist/main.js`).
const notScanned = [
  ...neverRead,
  /(?:^|\/)CHANGELOG\.md$/,
  /\.test\.tsx?$/,
  /\/(?:__fixtures__|fixtures)\//,
  /\.gen\.ts$/,
  /(?:^|\/)\.[a-z]*ignore$/,
];
const notARoot = ["docs", "research", ".agents"];

// The top-level directories of the tree, as a pattern for the start of a path.
function rootsOf(tracked: readonly string[]): string {
  const roots = new Set(
    tracked.filter((path) => path.includes("/")).map((path) => String(path.split("/")[0])),
  );
  return [...roots]
    .filter((root) => !notARoot.includes(root))
    .map((root) => root.replaceAll(".", "\\."))
    .join("|");
}

// The pattern that finds the paths in a source, or undefined for a source that is not read. Its groups: `relative` (the
// `./` and `../` in front), `body` (the path from a top-level directory) and `goesOn` (a glob or a placeholder after it).
function patternsOf(roots: string): (source: string) => RegExp | undefined {
  const inlinePath = new RegExp(`\`(?<body>(?:${roots})/[A-Za-z0-9_./@-]*\\.[A-Za-z0-9]+)\``, "g");
  const pathInText = new RegExp(
    `(?<![A-Za-z0-9_./@-])(?<relative>(?:\\.{1,2}/)*)(?<body>(?:${roots})/[A-Za-z0-9_./@-]*)(?![A-Za-z0-9_-])(?<goesOn>[*{<\\[?$])?`,
    "g",
  );
  return (source) => {
    if (source.startsWith("docs/")) return source.endsWith(".md") ? inlinePath : undefined;
    return notScanned.some((pattern) => pattern.test(source)) ? undefined : pathInText;
  };
}

export function codePathReferences(tree: Tree): string[] {
  const tracked = new Set(tree.paths);
  const roots = rootsOf(tree.paths);
  if (roots === "") return [];
  const patternFor = patternsOf(roots);
  const failures: string[] = [];
  for (const source of tree.paths) {
    const pattern = patternFor(source);
    // Stryker disable next-line ConditionalExpression: equivalent, matchAll(undefined) finds only empty matches, which name no file
    if (pattern === undefined) continue;
    const text = tree.read(source);
    if (text.includes("\0")) continue;
    const seen = new Set<string>();
    for (const match of text.matchAll(pattern)) {
      // Both patterns name their groups, so groups is always there; the spread only satisfies its type.
      const { relative = "", body: found, goesOn } = { ...match.groups };
      // A sentence can end with the path and a period.
      const body = String(found).replace(/\.$/, "");
      const written = `${relative}${body}`;
      const isDirectory = body.endsWith("/");
      if (seen.has(written)) continue;
      // A directory is named with a slash and two names or more; a glob or a placeholder goes on after the slash.
      if (isDirectory && (body.split("/").length < 3 || goesOn !== undefined)) continue;
      if (!isDirectory && !/\.[A-Za-z0-9]+$/.test(body)) continue;
      const path =
        relative === "" ? body : posix.normalize(posix.join(posix.dirname(source), written));
      const exists = isDirectory
        ? tree.paths.some((candidate) => candidate.startsWith(path))
        : tracked.has(path);
      if (exists) continue;
      seen.add(written);
      failures.push(`${source} names ${written}, which does not exist. ${moved}`);
    }
  }
  return failures;
}
