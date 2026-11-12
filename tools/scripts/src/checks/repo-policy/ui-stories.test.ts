// The checks of the stories of packages/ui (./ui-stories.ts), each called alone on a small repository held in memory:
// a case breaks one file of a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import { failuresOf, repo } from "./fixtures/repo.ts";
import { uiComponentsHaveStories } from "./ui-stories.ts";

describe("ADR 0033: packages/ui の各部品の隣に story があること", () => {
  const violations = failuresOf(uiComponentsHaveStories);
  const components = "packages/ui/src/components";

  it("story のある部品と、部品のない story を通すこと", () => {
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

  it("story のない部品と、足すファイルを挙げること", () => {
    expect(violations(repo({ [`${components}/dialog.tsx`]: "export {};" }))).toEqual([
      `${components}/dialog.tsx has no story. Add ${components}/dialog.stories.tsx, whose play functions are the part's component test (docs/adr/0033).`,
    ]);
  });

  it("story のないすべての部品を、どの深さでも挙げること", () => {
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

  it("story を別のディレクトリではなく、部品の隣に求めること", () => {
    expect(
      violations(
        repo({
          [`${components}/form/field.tsx`]: "export {};",
          [`${components}/field.stories.tsx`]: "export {};",
        }),
      ),
    ).toHaveLength(1);
  });

  it("packages/ui/src/components の tsx ファイルだけを読むこと", () => {
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
