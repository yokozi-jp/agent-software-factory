import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { Button } from "#components/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
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

const withContent = (content: Partial<ComponentProps<typeof SheetContent>>) => (
  <Sheet>
    <SheetTrigger render={<Button />}>メニューを開く</SheetTrigger>
    <SheetContent {...content}>
      <SheetHeader>
        <SheetTitle>メニュー</SheetTitle>
        <SheetDescription>項目を選びます。</SheetDescription>
      </SheetHeader>
      <SheetFooter>
        <SheetClose render={<Button variant="outline" />}>閉じる</SheetClose>
      </SheetFooter>
    </SheetContent>
  </Sheet>
);

export const Sides: Story = {
  render: () => withContent({ side: "left" }),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "メニューを開く" }));
    const sheet = await screen.findByRole("dialog", { name: "メニュー" });
    await expect(sheet).toHaveAttribute("data-side", "left");
  },
};

export const WithoutCloseButton: Story = {
  render: () => withContent({ side: "bottom", showCloseButton: false }),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "メニューを開く" }));
    const sheet = await screen.findByRole("dialog", { name: "メニュー" });
    await expect(sheet).toHaveAttribute("data-side", "bottom");
    // 右上の閉じるボタンは出さない。置いた SheetClose だけで閉じる。
    await expect(within(sheet).queryByRole("button", { name: "Close" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("button", { name: "閉じる" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  },
};
