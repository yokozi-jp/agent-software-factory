import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { Skeleton } from "#components/skeleton";

const meta = {
  title: "ui/Skeleton",
  component: Skeleton,
  args: { title: "読み込み中", className: "h-4 w-32" },
} satisfies Meta<typeof Skeleton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTitle("読み込み中")).toBeVisible();
  },
};
