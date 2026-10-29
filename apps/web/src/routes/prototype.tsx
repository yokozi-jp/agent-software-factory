// PROTOTYPE (throwaway): login -> top -> global menu -> logout, three variants via ?variant=A|B|C.
// Answers #402 "what should it look like and feel like". In-memory state only, no API, not for main.
// Decisions it follows: #397 (screens), #399 (messages), #400 (sidebar, roles, user menu, theme).
import { Button } from "@agent-software-factory/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@agent-software-factory/ui/components/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@agent-software-factory/ui/components/sidebar";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ChevronsUpDown,
  ClipboardCheck,
  FileText,
  LockKeyhole,
  Moon,
  Receipt,
  ShieldCheck,
  Sun,
  UserCheck,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

type VariantKey = "A" | "B" | "C";
const variants: Record<VariantKey, string> = {
  A: "Inset sidebar / 左右分割のログイン",
  B: "Classic sidebar + 上部バー / 中央カードのログイン",
  C: "Floating + icon で畳む / 最小のログイン",
};

export const Route = createFileRoute("/prototype")({
  validateSearch: (s: Record<string, unknown>): { variant: VariantKey } => ({
    variant: s.variant === "B" || s.variant === "C" ? s.variant : "A",
  }),
  component: Prototype,
});

const variantKeys = ["A", "B", "C"] as const;
const noticeKeys = ["failed", "unavailable", "temporary", "expired", "loggedout"] as const;

// ---- decided wording (#399) ----
type Notice = "failed" | "unavailable" | "temporary" | "expired" | "loggedout" | null;
const notices: Record<Exclude<Notice, null>, string> = {
  failed: "ログインできませんでした。もう一度お試しください。",
  unavailable: "このアカウントでは利用できません。心当たりがない場合は、管理者に連絡してください。",
  temporary: "ただいま利用できません。しばらくしてから、もう一度お試しください。",
  expired: "ログインの有効期限が切れました。もう一度ログインしてください。",
  loggedout: "ログアウトしました。",
};

// ---- menu (#400): items carry a group and a visibility condition ----
type Role = "applicant" | "accounting";
type Item = { id: string; label: string; group: string; icon: ReactNode; roles?: Role[] };
const items: Item[] = [
  { id: "mine", label: "自分の申請", group: "申請", icon: <FileText /> },
  { id: "approve", label: "承認", group: "承認・確認", icon: <UserCheck /> },
  {
    id: "confirm",
    label: "確認",
    group: "承認・確認",
    icon: <ClipboardCheck />,
    roles: ["accounting"],
  },
  { id: "close", label: "締め", group: "締め", icon: <Receipt />, roles: ["accounting"] },
];
const visibleGroups = (role: Role) => {
  const visible = items.filter((i) => !i.roles || i.roles.includes(role));
  return [...new Set(visible.map((i) => i.group))].map((g) => ({
    group: g,
    items: visible.filter((i) => i.group === g),
  }));
};

type Screen =
  | { kind: "login" }
  | { kind: "page"; id: string }
  | { kind: "403" }
  | { kind: "404"; loggedIn: boolean };

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  useEffect(() => {
    const dark =
      theme === "dark" ||
      (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }, [theme]);
  return [theme, setTheme] as const;
}

function Prototype() {
  const { variant } = Route.useSearch();
  const [screen, setScreen] = useState<Screen>({ kind: "login" });
  const [notice, setNotice] = useState<Notice>(null);
  const [role, setRole] = useState<Role>("applicant");
  const [theme, setTheme] = useTheme();

  const logout = () => {
    setNotice("loggedout");
    setScreen({ kind: "login" });
  };
  const openRestricted = () => {
    if (role === "accounting") setScreen({ kind: "page", id: "close" });
    else setScreen({ kind: "403" });
  };
  const go = (id: string) => {
    const item = items.find((i) => i.id === id);
    setScreen(item?.roles && !item.roles.includes(role) ? { kind: "403" } : { kind: "page", id });
  };

  let body: ReactNode;
  if (screen.kind === "login" || (screen.kind === "404" && !screen.loggedIn)) {
    body =
      screen.kind === "login" ? (
        <Login
          variant={variant}
          notice={notice}
          onLogin={() => {
            setNotice(null);
            setScreen({ kind: "page", id: "top" });
          }}
        />
      ) : (
        <NotFound loggedIn={false} onBack={() => setScreen({ kind: "login" })} />
      );
  } else {
    body = (
      <Shell
        variant={variant}
        role={role}
        theme={theme}
        setTheme={setTheme}
        screen={screen}
        go={go}
        onLogout={logout}
        onHome={() => setScreen({ kind: "page", id: "top" })}
      />
    );
  }

  return (
    <>
      {body}
      <Scenario
        role={role}
        setRole={setRole}
        loggedIn={screen.kind !== "login" && !(screen.kind === "404" && !screen.loggedIn)}
        onNotice={(n) => {
          setNotice(n);
          setScreen({ kind: "login" });
        }}
        on403={openRestricted}
        on404={() => setScreen({ kind: "404", loggedIn: true })}
        on404Anon={() => setScreen({ kind: "404", loggedIn: false })}
      />
      <Switcher current={variant} />
    </>
  );
}

// ---------------- login ----------------
function Notice({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const ok = notice === "loggedout";
  return (
    <div
      role={ok ? "status" : "alert"}
      className={`rounded-md border px-3 py-2 text-sm ${ok ? "border-border bg-muted" : "border-destructive/40 bg-destructive/10 text-destructive"}`}
    >
      {notices[notice]}
    </div>
  );
}

function Login({
  variant,
  notice,
  onLogin,
}: {
  variant: VariantKey;
  notice: Notice;
  onLogin: () => void;
}) {
  const form = (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <Notice notice={notice} />
      <Button size="lg" onClick={onLogin}>
        IdP でログイン
      </Button>
    </div>
  );
  if (variant === "A")
    return (
      <div className="grid min-h-svh md:grid-cols-2">
        <div className="bg-primary text-primary-foreground hidden flex-col justify-between p-10 md:flex">
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheck className="size-5" /> 経費精算
          </div>
          <p className="max-w-xs text-lg">社員が立て替えた経費を、承認を経て払い戻します。</p>
        </div>
        <main className="flex flex-col items-center justify-center gap-6 p-8">
          <h1 className="text-2xl font-semibold">ログイン</h1>
          {form}
        </main>
      </div>
    );
  if (variant === "B")
    return (
      <main className="bg-muted flex min-h-svh items-center justify-center p-6">
        <div className="bg-card flex w-full max-w-md flex-col items-center gap-6 rounded-xl border p-8 shadow-sm">
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheck className="size-5" /> 経費精算
          </div>
          <h1 className="text-xl font-semibold">ログイン</h1>
          {form}
        </div>
      </main>
    );
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-5xl font-bold tracking-tight">経費精算</h1>
      {form}
    </main>
  );
}

// ---------------- shell ----------------
function Shell({
  variant,
  role,
  theme,
  setTheme,
  screen,
  go,
  onLogout,
  onHome,
}: {
  variant: VariantKey;
  role: Role;
  theme: "light" | "dark" | "system";
  setTheme: (t: "light" | "dark" | "system") => void;
  screen: Screen;
  go: (id: string) => void;
  onLogout: () => void;
  onHome: () => void;
}) {
  const current = screen.kind === "page" ? screen.id : null;
  const sidebarVariant = variant === "A" ? "inset" : variant === "B" ? "sidebar" : "floating";
  const collapsible = variant === "C" ? "icon" : "offcanvas";

  const nav = (
    <Sidebar variant={sidebarVariant} collapsible={collapsible}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" onClick={onHome} tooltip="トップ">
              <ShieldCheck />
              <span className="font-medium">経費精算</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="メインメニュー">
          {visibleGroups(role).map((g) => (
            <SidebarGroup key={g.group}>
              <SidebarGroupLabel>{g.group}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {g.items.map((i) => (
                    <SidebarMenuItem key={i.id}>
                      <SidebarMenuButton
                        isActive={current === i.id}
                        aria-current={current === i.id ? "page" : undefined}
                        tooltip={i.label}
                        onClick={() => go(i.id)}
                      >
                        {i.icon}
                        <span>{i.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <span className="bg-muted flex size-8 items-center justify-center rounded-lg text-xs">
                  山田
                </span>
                <span className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-medium">山田 太郎</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {role === "accounting" ? "経理" : "申請者"}
                  </span>
                </span>
                <ChevronsUpDown className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="min-w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>テーマ</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={theme}
                    onValueChange={(v) => {
                      const t = String(v);
                      if (t === "light" || t === "dark" || t === "system") setTheme(t);
                    }}
                  >
                    <DropdownMenuRadioItem value="light">
                      <Sun /> ライト
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">
                      <Moon /> ダーク
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system">システム</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onLogout}>ログアウト</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );

  const content = <Content screen={screen} role={role} onHome={onHome} />;
  const header = (
    <header
      className={`flex h-14 shrink-0 items-center gap-2 px-4 ${variant === "B" ? "border-b" : ""}`}
    >
      <SidebarTrigger aria-label="メニューを開閉" />
      {variant === "B" && (
        <span className="text-muted-foreground text-sm">
          {screen.kind === "page"
            ? (items.find((i) => i.id === screen.id)?.label ?? "トップ")
            : "エラー"}
        </span>
      )}
    </header>
  );

  return (
    <SidebarProvider>
      <a
        href="#main"
        className="bg-background sr-only z-50 rounded p-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        本文へ移動
      </a>
      {nav}
      <SidebarInset>
        {header}
        <main id="main" className="flex flex-1 flex-col gap-4 p-6 pt-2">
          {content}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function Content({ screen, role, onHome }: { screen: Screen; role: Role; onHome: () => void }) {
  if (screen.kind === "403")
    return (
      <Message
        icon={<LockKeyhole className="size-10" />}
        title="403"
        text="このページを表示する権限がありません。"
        action={<Button onClick={onHome}>トップへ戻る</Button>}
      />
    );
  if (screen.kind === "404") return <NotFound loggedIn onBack={onHome} />;
  const label = screen.kind === "page" ? items.find((i) => i.id === screen.id)?.label : undefined;
  return (
    <>
      <h1 className="text-2xl font-semibold">{label ?? "トップ"}</h1>
      <p className="text-muted-foreground text-sm">
        （画面の中身は申請・承認の画面の決定で決める。ここは枠の確認用。）
        {label === undefined && ` ログイン中の役割: ${role === "accounting" ? "経理" : "申請者"}`}
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((n) => (
          <div key={n} className="bg-muted/50 h-28 rounded-xl border border-dashed" />
        ))}
      </div>
    </>
  );
}

function NotFound({ loggedIn, onBack }: { loggedIn: boolean; onBack: () => void }) {
  const msg = (
    <Message
      icon={<span className="text-4xl font-bold">404</span>}
      title=""
      text="お探しのページは見つかりません。URL を確認するか、トップへ戻ってください。"
      action={<Button onClick={onBack}>{loggedIn ? "トップへ戻る" : "ログインへ"}</Button>}
    />
  );
  return loggedIn ? msg : <main className="flex min-h-svh items-center justify-center">{msg}</main>;
}

function Message({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 text-center">
      {icon}
      {title && <h1 className="text-2xl font-semibold">{title}</h1>}
      <p>{text}</p>
      {action}
    </div>
  );
}

// ---------------- prototype-only controls ----------------
function Scenario({
  role,
  setRole,
  loggedIn,
  onNotice,
  on403,
  on404,
  on404Anon,
}: {
  role: Role;
  setRole: (r: Role) => void;
  loggedIn: boolean;
  onNotice: (n: Notice) => void;
  on403: () => void;
  on404: () => void;
  on404Anon: () => void;
}) {
  const b = "rounded border px-2 py-1 text-xs hover:bg-muted";
  return (
    <details className="bg-popover text-popover-foreground fixed top-2 right-2 z-50 w-64 rounded-lg border p-3 text-xs shadow-lg">
      <summary className="cursor-pointer font-medium">PROTOTYPE 操作盤</summary>
      <div className="mt-2 flex flex-col gap-2">
        <div>
          役割:{" "}
          <button
            className={b}
            aria-pressed={role === "applicant"}
            onClick={() => setRole("applicant")}
          >
            申請者{role === "applicant" ? " ●" : ""}
          </button>{" "}
          <button
            className={b}
            aria-pressed={role === "accounting"}
            onClick={() => setRole("accounting")}
          >
            経理{role === "accounting" ? " ●" : ""}
          </button>
        </div>
        <div>ログイン画面の通知:</div>
        <div className="flex flex-wrap gap-1">
          {noticeKeys.map((n) => (
            <button key={n} className={b} onClick={() => onNotice(n)}>
              {n}
            </button>
          ))}
          <button className={b} onClick={() => onNotice(null)}>
            なし
          </button>
        </div>
        <div>エラー画面:</div>
        <div className="flex flex-wrap gap-1">
          <button className={b} disabled={!loggedIn} onClick={on403}>
            経理専用 URL を直接開く
          </button>
          <button className={b} disabled={!loggedIn} onClick={on404}>
            他人の申請 (404)
          </button>
          <button className={b} onClick={on404Anon}>
            未ログインで 404
          </button>
        </div>
      </div>
    </details>
  );
}

function Switcher({ current }: { current: VariantKey }) {
  const navigate = useNavigate();
  const keys = variantKeys;
  const move = (d: number) => {
    const next = keys[(keys.indexOf(current) + d + keys.length) % keys.length] ?? "A";
    void navigate({ to: "/prototype", search: { variant: next }, replace: true });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]"))
        return;
      if (e.key === "ArrowLeft") move(-1);
      if (e.key === "ArrowRight") move(1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black px-4 py-2 text-sm text-white shadow-xl">
      <button aria-label="前の案" onClick={() => move(-1)}>
        ←
      </button>
      <span>
        {current} ({variants[current]})
      </span>
      <button aria-label="次の案" onClick={() => move(1)}>
        →
      </button>
    </div>
  );
}
