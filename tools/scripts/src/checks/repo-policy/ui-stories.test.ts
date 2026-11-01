// The checks of the stories of packages/ui (./ui-stories.ts), each called alone on a small repository held in memory:
// a case breaks one file of a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import { failuresOf, repo } from "./fixtures/repo.ts";
import { uiComponentsHaveStories } from "./ui-stories.ts";

describe("ADR 0033: each part of packages/ui has a story next to it", () => {
  const violations = failuresOf(uiComponentsHaveStories);
  const components = "packages/ui/src/components";

  it("passes a part with a story and a story with no part", () => {
    expect(
      violations(
        repo({
          [`${components}/button.tsx`]: "export {};",
          [`${components}/button.stories.tsx`]: "export {};",
          [`${components}/orphan.stories.tsx`]: "export {};",
        }),
      ),
    ).toEqual([]);
  });

  it("names a part with no story, and the file to add", () => {
    expect(violations(repo({ [`${components}/dialog.tsx`]: "export {};" }))).toEqual([
      `${components}/dialog.tsx has no story. Add ${components}/dialog.stories.tsx, whose play functions are the part's component test (docs/adr/0033).`,
    ]);
  });

  it("names every part with no story, at any depth", () => {
    expect(
      violations(
        repo({
          [`${components}/button.tsx`]: "export {};",
          [`${components}/button.stories.tsx`]: "export {};",
          [`${components}/dialog.tsx`]: "export {};",
          [`${components}/form/field.tsx`]: "export {};",
        }),
      ).map((failure) => failure.split(" ")[0]),
    ).toEqual([`${components}/dialog.tsx`, `${components}/form/field.tsx`]);
  });

  it("wants the story next to the part, not in another directory", () => {
    expect(
      violations(
        repo({
          [`${components}/form/field.tsx`]: "export {};",
          [`${components}/field.stories.tsx`]: "export {};",
        }),
      ),
    ).toHaveLength(1);
  });

  it("reads only tsx files in packages/ui/src/components", () => {
    expect(
      violations(
        repo({
          [`${components}/helper.ts`]: "export {};",
          [`${components}/button.test.tsx`]: "export {};",
          "packages/ui/src/lib/format.tsx": "export {};",
          "packages/ui/src/componentsx/part.tsx": "export {};",
          "apps/web/src/components/menu.tsx": "export {};",
        }),
      ),
    ).toEqual([]);
  });
});
