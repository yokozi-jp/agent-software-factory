import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { Button } from "#components/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#components/tooltip";

const meta = {
  title: "ui/Tooltip",
  component: Tooltip,
  render: (args) => (
    <TooltipProvider>
      <Tooltip {...args}>
        <TooltipTrigger render={<Button />}>保存</TooltipTrigger>
        <TooltipContent>変更を保存します</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
} satisfies Meta<typeof Tooltip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole("button", { name: "保存" }));
    // ツールチップは portal で body の直下に出るので、canvas ではなく screen から探す。
    const tooltip = await screen.findByText("変更を保存します");
    // 要素が現れた直後は fade-in の最初のフレームで opacity が 0 のことがあり、toBeVisible (opacity: 0 を不可視と数える) が
    // 負荷のある CI で落ちた (#523)。表示されるまで待つ。
    await waitFor(() => expect(tooltip).toBeVisible());
  },
};
