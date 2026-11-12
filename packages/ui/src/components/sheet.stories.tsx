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

/** 置いた SheetClose で閉じられるシート。向きと閉じるボタンは story ごとに替える。 */
function SheetExample({
  label,
  ...content
}: { label: string } & Pick<ComponentProps<typeof SheetContent>, "side" | "showCloseButton">) {
  return (
    <Sheet>
      <SheetTrigger render={<Button />}>{label}</SheetTrigger>
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
}

const sides = ["top", "right", "bottom", "left"] as const;

export const AllSides: Story = {
  render: () => (
    <>
      {sides.map((side) => (
        <SheetExample key={side} label={`${side} を開く`} side={side} />
      ))}
    </>
  ),
  play: async ({ canvas }) => {
    for (const side of sides) {
      await userEvent.click(canvas.getByRole("button", { name: `${side} を開く` }));
      const sheet = await screen.findByRole("dialog", { name: "メニュー" });
      await expect(sheet).toHaveAttribute("data-side", side);
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
  },
};

export const WithoutCloseButton: Story = {
  render: () => <SheetExample label="メニューを開く" side="bottom" showCloseButton={false} />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "メニューを開く" }));
    const sheet = await screen.findByRole("dialog", { name: "メニュー" });
    // 右上の閉じるボタンは出さない。置いた SheetClose だけで閉じる。
    await expect(within(sheet).queryByRole("button", { name: "Close" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("button", { name: "閉じる" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  },
};
