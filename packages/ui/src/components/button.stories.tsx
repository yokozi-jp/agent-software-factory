import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";

import { Button } from "#components/button";

const meta = {
  title: "ui/Button",
  component: Button,
  args: { children: "保存", onClick: fn() },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "保存" }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ args, canvas }) => {
    const button = canvas.getByRole("button", { name: "保存" });
    await expect(button).toBeDisabled();
    // 無効のボタンは pointer-events: none なので、userEvent では押せない。DOM の click が届かないことを確かめる。
    button.click();
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};
