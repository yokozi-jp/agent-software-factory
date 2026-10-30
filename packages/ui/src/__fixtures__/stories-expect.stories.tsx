// Detection-power fixture (#43, #315): an expect and a Testing Library that are not from storybook/test. See stories.stories.tsx.
import { expect } from "vite-plus/test";
// @ts-expect-error -- fixture: @testing-library/dom is not a dependency of packages/ui
// oxlint-disable-next-line storybook/use-storybook-testing-library -- fixture: Testing Library used directly
import { within } from "@testing-library/dom";

export default { title: "ui/FixtureExpect" };

export const Plain = {
  play: () => {
    // oxlint-disable-next-line storybook/use-storybook-expect -- fixture: expect from vitest, not from storybook/test
    expect(within).toBeDefined();
  },
};
