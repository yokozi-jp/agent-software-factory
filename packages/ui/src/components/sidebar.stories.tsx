import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { expect, userEvent } from "storybook/test";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "#components/sidebar";

function Link(props: ComponentProps<"a">) {
  // oxlint-disable-next-line jsx-a11y/anchor-has-content -- 子は呼び出し側 (SidebarMenuButton) が入れる
  return <a {...props} />;
}

const meta = {
  title: "ui/Sidebar",
  component: SidebarProvider,
  render: (args) => (
    <SidebarProvider {...args}>
      <Sidebar collapsible="offcanvas">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>承認</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href="/approvals" />}>承認</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <SidebarTrigger aria-label="メニューを開閉" />
      </SidebarInset>
    </SidebarProvider>
  ),
} satisfies Meta<typeof SidebarProvider>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("link", { name: "承認" })).toHaveAttribute(
      "href",
      "/approvals",
    );
  },
};

export const Toggle: Story = {
  play: async ({ canvas }) => {
    const sidebar = () => document.querySelector("[data-slot='sidebar']");
    // 広い画面では開いていて、トリガーで閉じる。狭い画面は Sheet なので、ここでは確かめない。
    if (window.innerWidth < 768) return;
    await expect(sidebar()).toHaveAttribute("data-state", "expanded");
    await userEvent.click(canvas.getByRole("button", { name: "メニューを開閉" }));
    await expect(sidebar()).toHaveAttribute("data-state", "collapsed");
  },
};
