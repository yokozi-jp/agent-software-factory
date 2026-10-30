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
    // 無効のボタンは押せない。DOM の click は disabled で届かず、見た目の pointer-events: none も効いている。
    await expect(button).toBeDisabled();
    await expect(getComputedStyle(button).pointerEvents).toBe("none");
    button.click();
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};
