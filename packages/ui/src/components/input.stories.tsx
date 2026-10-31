import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";

import { Input } from "#components/input";

const meta = {
  title: "ui/Input",
  component: Input,
  args: { "aria-label": "氏名" },
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox", { name: "氏名" });
    await userEvent.type(input, "田中");
    await expect(input).toHaveValue("田中");
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("textbox", { name: "氏名" })).toBeDisabled();
  },
};
