// Detection-power fixture (#43, #315) that the rules of eslint-plugin-storybook in the root vite.config.ts reach the
// stories of packages/ui/src/ (and apps/web/src/, by the same `files`). Every line with a disable comment is a rule that
// must report it: if a rule is turned off, or its `files` stop reaching this file, the comment is unused and `vp check`
// fails (reportUnusedDisableDirectives). Storybook's `stories` globs do not read this directory, Knip skips
// __fixtures__/, and nothing imports this file. stories-file, stories-no-story and stories-expect (.stories.tsx) next to it are the files for the rules about the file.
// @ts-expect-error -- fixture: the renderer package is not a dependency of packages/ui, only of its Storybook framework
// oxlint-disable-next-line storybook/no-renderer-packages -- fixture: a renderer package imported directly
import type { ReactRenderer } from "@storybook/react";
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";

export type Renderer = ReactRenderer;

const meta = {
  // oxlint-disable-next-line storybook/hierarchy-separator -- fixture: `|` as a separator in the title
  title: "ui|Fixture",
} satisfies Meta;

export default meta;

// oxlint-disable-next-line storybook/prefer-pascal-case -- fixture: a story name that is not PascalCase
export const not_pascal = {};

// oxlint-disable-next-line storybook/no-redundant-story-name -- fixture: a name that Storybook derives anyway
export const Redundant = { name: "Redundant" };

export const Other = {
  play: async () => {
    await expect(1).toBe(1);
  },
};

export const Calls = {
  play: async () => {
    // oxlint-disable-next-line storybook/context-in-play-function -- fixture: the play function of another story called without the context
    await Other.play();
  },
};

// A story that does not await an interaction passes before it ends. The type-aware rule of Oxlint reports it
// (eslint-plugin-storybook's await-interactions reads only `@storybook/test`, not `storybook/test`, 10.6.5).
export const Floating = {
  play: async () => {
    // oxlint-disable-next-line typescript/no-floating-promises -- fixture: an expect that is not awaited
    expect(1).toBe(1);
    // oxlint-disable-next-line typescript/no-floating-promises -- fixture: a userEvent that is not awaited
    userEvent.click(document.body);
    await Promise.resolve();
  },
};
