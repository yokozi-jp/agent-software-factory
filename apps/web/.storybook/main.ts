import type { StorybookConfig } from "@storybook/react-vite";

// カタログに載せる story。画面の story は apps/web/src に、共有の部品の story は packages/ui の部品の隣に置く
// (docs/adr/0033)。Storybook の stories は main.ts からの相対 path の glob の配列で、別のディレクトリを並べられる。
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx", "../../../packages/ui/src/components/**/*.stories.tsx"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-vitest"],
  framework: "@storybook/react-vite",
};

export default config;
