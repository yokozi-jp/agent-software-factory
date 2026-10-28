// Checks of the references between docs/ and the code: to docs/ from outside it, and to files of the code from inside it.
import { Tree } from "./tree.ts";

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
  /^\.agents\//,
  /^\.kiro\/skills\//,
  /^research\//,
  /^tools\/scripts\/src\/checks\/(adr-check|repo-policy)\/([^/]*\.test\.ts$|fixtures\/)/,
  /^pnpm-lock\.yaml$/,
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
          failures.push(`${source} cites docs/adr/${number}, which does not exist.`);
        continue;
      }
      const path = `docs/${file}`;
      const target = tree.repo.read(path);
      if (target === undefined) failures.push(`${source} cites ${path}, which does not exist.`);
      else if (heading !== undefined && !hasHeading(target, heading))
        failures.push(
          `${source} cites the heading "${heading}" in ${path}, which has no such heading.`,
        );
    }
  }
  return failures;
}

// References from docs/ to files of the code, such as `tools/scripts/src/checks/repo-policy/ci.ts`. A file that
// is moved or removed leaves the path in the docs behind. Only a path in inline code that names a file (it
// ends with an extension) under a top-level directory of the code is checked: a directory, a glob, a
// placeholder, and a path with a line number are skipped, because none of them names a file the tree must
// have. The ADRs are skipped: they record what was decided at the time, and often cite paths that have
// since moved (docs/adr/0030 explains the move of a plugin, for one).
const codePath =
  /`((?:tools|packages|apps|types|\.github|\.kiro)\/[A-Za-z0-9_./@-]*\.[A-Za-z0-9]+)`/g;

export function docsCodePaths(tree: Tree): string[] {
  const tracked = new Set(tree.paths);
  const failures: string[] = [];
  for (const source of tree.paths) {
    if (!source.startsWith("docs/") || source.startsWith("docs/adr/") || !source.endsWith(".md"))
      continue;
    for (const match of tree.read(source).matchAll(codePath)) {
      const path = String(match[1]);
      if (!tracked.has(path))
        failures.push(
          `${source} cites ${path}, which does not exist. The file was moved or removed: write its path now, or the directory it is in.`,
        );
    }
  }
  return failures;
}
