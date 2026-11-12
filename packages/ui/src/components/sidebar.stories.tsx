import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, useState, type ComponentProps, type ReactNode } from "react";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
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

const sidebarElement = () => document.querySelector("[data-slot='sidebar']");
const trigger = (canvas: {
  getByRole: (role: "button", options: { name: string }) => HTMLElement;
}) => canvas.getByRole("button", { name: "メニューを開閉" });

/** 項目が 1 つだけのメニュー。Sidebar の props と、本体の外に置くものを受ける。 */
function Menu({
  sidebar,
  provider,
  button,
  children,
}: {
  sidebar?: ComponentProps<typeof Sidebar>;
  provider?: Partial<ComponentProps<typeof SidebarProvider>>;
  button?: Pick<ComponentProps<typeof SidebarMenuButton>, "tooltip">;
  children?: ReactNode;
}) {
  return (
    <SidebarProvider {...provider}>
      <Sidebar {...sidebar}>
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton {...button} render={<Link href="/approvals" />}>
                承認
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <SidebarTrigger aria-label="メニューを開閉" />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}

function ControlledMenu() {
  const [open, setOpen] = useState(true);
  return (
    <Menu provider={{ open, onOpenChange: setOpen }}>
      <output>{open ? "開いている" : "閉じている"}</output>
    </Menu>
  );
}

export const Controlled: Story = {
  render: () => <ControlledMenu />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("開いている")).toBeVisible();
    await userEvent.click(trigger(canvas));
    // 開閉は props の onOpenChange に任せる。内部の状態ではなく、親の状態に従う。
    await expect(canvas.getByText("閉じている")).toBeVisible();
    await expect(sidebarElement()).toHaveAttribute("data-state", "collapsed");
  },
};

export const KeyboardShortcut: Story = {
  render: () => <Menu />,
  play: async () => {
    await expect(sidebarElement()).toHaveAttribute("data-state", "expanded");
    // 修飾キーのない b と、b 以外の Ctrl の組み合わせでは、開閉しない。
    await userEvent.keyboard("b");
    await userEvent.keyboard("{Control>}x{/Control}");
    await expect(sidebarElement()).toHaveAttribute("data-state", "expanded");
    await userEvent.keyboard("{Control>}b{/Control}");
    await expect(sidebarElement()).toHaveAttribute("data-state", "collapsed");
    await userEvent.keyboard("{Meta>}b{/Meta}");
    await expect(sidebarElement()).toHaveAttribute("data-state", "expanded");
    // 開閉の状態は、次に開くときのために cookie に残す。
    await expect(document.cookie).toContain("sidebar_state=true");
  },
};

export const NotCollapsible: Story = {
  render: () => <Menu sidebar={{ collapsible: "none" }} />,
  play: async ({ canvas }) => {
    await userEvent.click(trigger(canvas));
    // 閉じない部品は、状態の属性を持たず、押しても見えたままである。
    await expect(sidebarElement()).not.toHaveAttribute("data-state");
    await expect(canvas.getByRole("link", { name: "承認" })).toBeVisible();
  },
};

export const IconWithTooltip: Story = {
  render: () => (
    <Menu
      provider={{ defaultOpen: false }}
      sidebar={{ collapsible: "icon", variant: "floating", side: "right" }}
      button={{ tooltip: "承認の一覧" }}
    />
  ),
  play: async ({ canvas }) => {
    await expect(sidebarElement()).toHaveAttribute("data-variant", "floating");
    await expect(sidebarElement()).toHaveAttribute("data-side", "right");
    await expect(sidebarElement()).toHaveAttribute("data-collapsible", "icon");
    await userEvent.hover(canvas.getByRole("link", { name: "承認" }));
    // 畳んでいるときは、文字の代わりにツールチップを出す。portal で body の直下に出る。
    const tooltip = await screen.findByText("承認の一覧");
    await waitFor(() => expect(tooltip).toBeVisible());
  },
};

export const TooltipProps: Story = {
  render: () => (
    <Menu
      provider={{ defaultOpen: false }}
      button={{ tooltip: { children: "承認 (props)", align: "start" } }}
    />
  ),
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole("link", { name: "承認" }));
    const tooltip = await screen.findByText("承認 (props)");
    await waitFor(() => expect(tooltip).toBeVisible());
  },
};

export const ExpandedHidesTooltip: Story = {
  render: () => <Menu button={{ tooltip: "承認の一覧" }} />,
  play: async ({ canvas }) => {
    // 開いているときは、文字が見えているので、ツールチップを出さない。
    await userEvent.hover(canvas.getByRole("link", { name: "承認" }));
    await expect(screen.queryByText("承認の一覧")).toBeNull();
  },
};

export const InsetVariant: Story = {
  render: () => <Menu sidebar={{ variant: "inset" }} />,
  play: async () => {
    await expect(sidebarElement()).toHaveAttribute("data-variant", "inset");
  },
};

export const Parts: Story = {
  render: () => (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <SidebarInput aria-label="項目を探す" placeholder="探す" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>承認</SidebarGroupLabel>
            <SidebarGroupAction render={<button type="button" aria-label="グループを追加" />}>
              +
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive render={<Link href="/approvals" />}>
                    承認
                  </SidebarMenuButton>
                  <SidebarMenuAction render={<button type="button" aria-label="承認の操作" />}>
                    …
                  </SidebarMenuAction>
                  <SidebarMenuBadge>3</SidebarMenuBadge>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton isActive render={<Link href="/approvals/mine" />}>
                        自分の分
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton size="sm" render={<Link href="/approvals/all" />}>
                        すべて
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuAction
                    showOnHover
                    render={<button type="button" aria-label="差戻しの操作" />}
                  >
                    …
                  </SidebarMenuAction>
                  <SidebarMenuSkeleton showIcon />
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuSkeleton />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
        </SidebarContent>
        <SidebarFooter>フッター</SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <SidebarTrigger aria-label="メニューを開閉" />
      </SidebarInset>
    </SidebarProvider>
  ),
  play: async ({ canvas }) => {
    // 部品ごとの印 (data-slot) で、全部が描かれていることを確かめる。
    for (const slot of [
      "sidebar-header",
      "sidebar-input",
      "sidebar-group-action",
      "sidebar-menu-action",
      "sidebar-menu-badge",
      "sidebar-menu-sub",
      "sidebar-menu-sub-item",
      "sidebar-menu-sub-button",
      "sidebar-menu-skeleton",
      "sidebar-separator",
      "sidebar-footer",
      "sidebar-rail",
    ]) {
      await expect(document.querySelector(`[data-slot='${slot}']`)).not.toBeNull();
    }
    await expect(document.querySelectorAll("[data-slot='sidebar-menu-skeleton']")).toHaveLength(2);
    // アイコン付きの骨組みは 1 つだけ。
    await expect(document.querySelectorAll("[data-sidebar='menu-skeleton-icon']")).toHaveLength(1);
    await expect(canvas.getByRole("link", { name: "承認" })).toHaveAttribute("data-active");
    await expect(canvas.getByRole("link", { name: "自分の分" })).toHaveAttribute("data-active");
    await expect(canvas.getByRole("link", { name: "すべて" })).not.toHaveAttribute("data-active");
    await expect(canvas.getByRole("link", { name: "すべて" })).toHaveAttribute("data-size", "sm");
    // 縁の帯を押すと、メニューが畳まれる。
    await userEvent.click(canvas.getByRole("button", { name: "Toggle Sidebar" }));
    await expect(sidebarElement()).toHaveAttribute("data-state", "collapsed");
  },
};

/** 描くときに投げられた失敗の文言を出す。部品が投げる失敗を story で見るための枠。 */
class ShowError extends Component<{ children: ReactNode }, { message: string | undefined }> {
  override state = { message: undefined };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }

  override render() {
    return this.state.message === undefined ? (
      this.props.children
    ) : (
      <p role="alert">{this.state.message}</p>
    );
  }
}

export const OutsideProvider: Story = {
  render: () => (
    <ShowError>
      <SidebarTrigger />
    </ShowError>
  ),
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "useSidebar must be used within a SidebarProvider.",
    );
  },
};
