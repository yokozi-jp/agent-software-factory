import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps, ReactNode } from "react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { Button } from "#components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#components/dialog";

/** 確認のダイアログ。内容の props と、フッターに置くものだけを story ごとに替える。 */
function ConfirmDialog({
  content,
  footer,
  ...args
}: ComponentProps<typeof Dialog> & {
  content?: Pick<ComponentProps<typeof DialogContent>, "showCloseButton">;
  footer?: ReactNode;
}) {
  return (
    <Dialog {...args}>
      <DialogTrigger render={<Button />}>開く</DialogTrigger>
      <DialogContent {...content}>
        <DialogHeader>
          <DialogTitle>確認</DialogTitle>
          <DialogDescription>この操作を続けますか。</DialogDescription>
        </DialogHeader>
        {footer}
      </DialogContent>
    </Dialog>
  );
}

const meta = {
  title: "ui/Dialog",
  component: Dialog,
  render: (args) => <ConfirmDialog {...args} />,
} satisfies Meta<typeof Dialog>;

export default meta;

type Story = StoryObj<typeof meta>;

/** ダイアログを開き、内容が見えるまで待つ。 */
const openDialog = async (canvas: Parameters<NonNullable<Story["play"]>>[0]["canvas"]) => {
  await userEvent.click(canvas.getByRole("button", { name: "開く" }));
  // ダイアログは portal で body の直下に出るので、canvas ではなく screen から探す。
  const dialog = await screen.findByRole("dialog", { name: "確認" });
  // 開くときに fade-in (opacity 0 → 1、100ms) する。`toBeVisible` は opacity 0 を見えないと数えるので、
  // 要素が出た直後に一度だけ確かめると、負荷の高い CI で落ちる (#523)。見えるまで待つ。
  await waitFor(() => expect(within(dialog).getByText("この操作を続けますか。")).toBeVisible());
  return dialog;
};

const expectClosed = () => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

export const Default: Story = {
  play: async ({ canvas }) => {
    const dialog = await openDialog(canvas);
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await expectClosed();
  },
};

export const FooterWithCloseButton: Story = {
  render: (args) => (
    <ConfirmDialog
      {...args}
      content={{ showCloseButton: false }}
      footer={
        <DialogFooter showCloseButton>
          <Button>続ける</Button>
        </DialogFooter>
      }
    />
  ),
  play: async ({ canvas }) => {
    const dialog = await openDialog(canvas);
    // 右上の閉じるボタンは出さず、フッターの閉じるボタンだけを出す。
    await expect(within(dialog).getAllByRole("button", { name: "Close" })).toHaveLength(1);
    await expect(within(dialog).getByRole("button", { name: "続ける" })).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await expectClosed();
  },
};

export const FooterWithoutCloseButton: Story = {
  render: (args) => (
    <ConfirmDialog
      {...args}
      content={{ showCloseButton: false }}
      footer={
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>やめる</DialogClose>
        </DialogFooter>
      }
    />
  ),
  play: async ({ canvas }) => {
    const dialog = await openDialog(canvas);
    // フッターの閉じるボタンの既定はなし。閉じる操作は、置いた DialogClose だけである。
    await expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "やめる" }));
    await expectClosed();
  },
};
