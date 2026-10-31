import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { Button } from "#components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "#components/sheet";

const meta = {
  title: "ui/Sheet",
  component: Sheet,
  render: (args) => (
    <Sheet {...args}>
      <SheetTrigger render={<Button />}>メニューを開く</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>メニュー</SheetTitle>
          <SheetDescription>項目を選びます。</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  ),
} satisfies Meta<typeof Sheet>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "メニューを開く" }));
    // 開くときに opacity が変わるので、見えるまで待つ (#523)。portal で body の直下に出る。
    await waitFor(async () => {
      await expect(await screen.findByText("項目を選びます。")).toBeVisible();
    });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("項目を選びます。")).toBeNull());
  },
};
