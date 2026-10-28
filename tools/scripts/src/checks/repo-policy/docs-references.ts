// Checks of the references to docs/ from outside docs/.
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
