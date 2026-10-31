import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { expect, within } from "storybook/test";

import { AppShell, groupItems, type NavItem } from "#components/app-shell";

const items: NavItem[] = [
  { label: "承認", href: "/approvals", group: "承認・確認" },
  { label: "確認", href: "/review", group: "承認・確認" },
  { label: "締め", href: "/closing", group: "締め" },
];

function Link(props: ComponentProps<"a">) {
  // oxlint-disable-next-line jsx-a11y/anchor-has-content -- 子は呼び出し側 (SidebarMenuButton) が入れる
  return <a {...props} />;
}

const meta = {
  title: "ui/AppShell",
  component: AppShell,
  args: {
    items,
    currentHref: "/approvals",
    renderLink: (item) => <Link href={item.href} />,
    title: "承認",
    navLabel: "メインメニュー",
    triggerLabel: "メニューを開閉",
    skipLinkLabel: "本文へ移動",
    footer: <p>田中 太郎</p>,
    children: <p>本文</p>,
  },
} satisfies Meta<typeof AppShell>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const nav = canvas.getByRole("navigation", { name: "メインメニュー" });
    await expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["承認", "確認", "締め"]);
    await expect(within(nav).getByRole("link", { name: "承認" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(within(nav).getByRole("link", { name: "確認" })).not.toHaveAttribute(
      "aria-current",
    );
    await expect(canvas.getByRole("heading", { name: "承認" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "本文へ移動" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    await expect(canvas.getByText("田中 太郎")).toBeVisible();
  },
};

export const WithoutTitle: Story = {
  args: { title: "" },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("heading")).toBeNull();
  },
};

export const WithoutItems: Story = {
  args: { items: [] },
  play: async ({ canvas }) => {
    const nav = canvas.getByRole("navigation", { name: "メインメニュー" });
    await expect(within(nav).queryByRole("link")).toBeNull();
  },
};

// groupItems は項目のないグループを作らない。
export const GroupsByFirstAppearance: Story = {
  play: async () => {
    await expect(groupItems(items).map((g) => [g.group, g.items.length])).toEqual([
      ["承認・確認", 2],
      ["締め", 1],
    ]);
    await expect(groupItems([])).toEqual([]);
  },
};
