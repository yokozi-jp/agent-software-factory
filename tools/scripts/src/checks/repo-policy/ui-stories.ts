// Check of the parts of packages/ui: each has a story (docs/adr/0033, #315).
import { Tree } from "./tree.ts";

const componentsDirectory = "packages/ui/src/components/";

// ADR 0033: every part in packages/ui/src/components/ has a `*.stories.tsx` next to it, because a story is the
// part's component test and its catalog entry. A part with no story is not tested and not in the catalog, and
// nothing else in CI notices. A `*.test.tsx` is not a part (ADR 0033 has no such tests in packages/ui). The business components of apps/web are outside this rule.
export function uiComponentsHaveStories(tree: Tree): string[] {
  const tracked = new Set(tree.paths);
  return tree.paths
    .filter(
      (path) =>
        path.startsWith(componentsDirectory) &&
        path.endsWith(".tsx") &&
        !path.endsWith(".stories.tsx") &&
        !path.endsWith(".test.tsx"),
    )
    .map((path) => [path, `${path.slice(0, -".tsx".length)}.stories.tsx`] as const)
    .filter(([, story]) => !tracked.has(story))
    .map(
      ([path, story]) =>
        `${path} has no story. Add ${story}, whose play functions are the part's component test (docs/adr/0033).`,
    );
}
