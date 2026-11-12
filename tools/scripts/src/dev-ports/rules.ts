// 開発サーバーのポートの割り当ての規則 (docs/tooling/worktrees.md ("開発サーバーを動かす"))。
// このファイルは純粋な関数だけを置く。ファイルと git を読む処理は cli.ts にある。

// slot は worktree ごとの番号。slot 0 は main の checkout で、各アプリの既定のポートそのまま。
// 範囲は 0〜7 (判断)。slot 8 の IdP が 9080 になり、compose.local.yaml の人事システムのフェイク (ホスト側 9080) と重なる。
export const slotCount = 8;
const step = 10;

export type Ports = {
  readonly web: number;
  readonly api: number;
  readonly idp: number;
  readonly storybook: number;
};

// 各アプリの既定のポート。apps/web/vite.config.ts、apps/api/src/env.ts、apps/api/test/dev-idp.ts、
// apps/web/package.json の storybook と同じ値にする。
const base: Ports = { web: 5173, api: 3000, idp: 9000, storybook: 6006 };

// 使われていない slot のうち、いちばん小さいものを返す。slot 0 は main の checkout のものなので、返さない。
// worktree を消すと、その slot は再び空く。すべて使われていれば undefined。
export function lowestFreeSlot(used: readonly number[]): number | undefined {
  for (let slot = 1; slot < slotCount; slot += 1) if (!used.includes(slot)) return slot;
  return undefined;
}

const noFreeSlot = `空いている slot がない (${slotCount - 1} 個の worktree が使用中)。使い終えた worktree を消してからやり直す`;

// worktree の apps/web と apps/api の .env.local の中身。Vite と Nx が、gitignore 済みのこのファイルを読む
// (Vite: https://vite.dev/guide/env-and-mode の ".env Files"、Nx: https://nx.dev/docs/reference/environment-variables。
// どちらも 2026-11-12 に読んだ)。
// 変数は独立させ、別のアプリへの参照は URL にする (twelve-factor の III. Config と VII. Port binding)。
// 先頭の行は、どの slot が使われているかを他の worktree が読むための印 (slotOf)。
const marker = (slot: number): string =>
  `# dev-ports: slot ${slot} (tools/scripts/src/dev-ports。docs/tooling/worktrees.md)`;

export const localOrigin = (port: number): string => `http://localhost:${port}`;

export type EnvFiles = { readonly web: string; readonly api: string };

export function envFiles(slot: number): EnvFiles {
  const ports = portsFor(slot);
  const webOrigin = localOrigin(ports.web);
  const lines = (...entries: string[]): string => [marker(slot), ...entries, ""].join("\n");
  return {
    web: lines(
      `WEB_PORT=${ports.web}`,
      `API_ORIGIN=${localOrigin(ports.api)}`,
      `STORYBOOK_PORT=${ports.storybook}`,
    ),
    api: lines(
      `PORT=${ports.api}`,
      `PUBLIC_ORIGIN=${webOrigin}`,
      `IDP_PORT=${ports.idp}`,
      `IDP_APP_ORIGIN=${webOrigin}`,
      `OIDC_DISCOVERY_URL=http://127.0.0.1:${ports.idp}/.well-known/openid-configuration`,
    ),
  };
}

// ファイルの印から slot を読む。印がない、読めない、範囲外なら undefined。
export function slotOf(text: string): number | undefined {
  const found = /^# dev-ports: slot (\d+) /m.exec(text);
  if (found === null) return undefined;
  const slot = Number(found[1]);
  return slot < slotCount ? slot : undefined;
}

// slot の URL。設定ファイル (.env.local) はエージェントが読めないので (docs/tooling/agent-permissions.md)、
// `cli.ts show` がこの文を出して、エージェントが自分の URL を知れるようにする。
export function summary(slot: number): string {
  const ports = portsFor(slot);
  return [
    `slot ${slot}`,
    `web        ${localOrigin(ports.web)}`,
    `api        ${localOrigin(ports.api)}`,
    `idp        http://127.0.0.1:${ports.idp}`,
    `storybook  ${localOrigin(ports.storybook)}`,
    "",
  ].join("\n");
}

// `git worktree list --porcelain` の出力から、worktree の path を出現順に取り出す。最初が main の checkout。
export function worktreePaths(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

// cli.ts が集めた、worktree 1 つぶんの事実。判断は下の planAssign と planShow が持つ。
export type Worktree = {
  readonly path: string;
  // false: git は一覧に残しているが、ディレクトリは手で消されている (git worktree prune の前の prunable)。
  readonly exists: boolean;
  // apps/api と apps/web の .env.local の中身。なければ undefined。
  readonly api: string | undefined;
  readonly web: string | undefined;
};

// 印はどちらのファイルにも書く。片方を消されても、もう片方で、その slot が使われていると分かる。
const slotOfWorktree = (worktree: Worktree): number | undefined =>
  slotOf(worktree.api ?? "") ?? slotOf(worktree.web ?? "");

// 新しく割り当てるときは書くファイルを持ち (kind: "new")、すでに割り当て済みなら何も書かない (kind: "existing")。
export type AssignPlan =
  | { readonly ok: true; readonly kind: "new"; readonly slot: number; readonly files: EnvFiles }
  | { readonly ok: true; readonly kind: "existing"; readonly slot: number }
  | { readonly ok: false; readonly status: 1 | 2; readonly message: string };

// worktrees の先頭は main の checkout。target に割り当てる slot とファイルを決める。
// すでに slot の印がある target には、何も書かせず、その slot を返す。post-checkout の hook が
// 先に割り当てた worktree に worktree.sh add が続けて割り当てても、失敗にならない。
export function planAssign(worktrees: readonly Worktree[], target: string): AssignPlan {
  const [main, ...others] = worktrees;
  if (main === undefined || target === main.path)
    return {
      ok: false,
      status: 2,
      message: "main の checkout には割り当てない (slot 0 の既定のポートを使う)",
    };
  const found = others.find((worktree) => worktree.path === target && worktree.exists);
  if (found === undefined)
    return { ok: false, status: 2, message: `${target} は git の worktree ではない` };
  const existing = slotOfWorktree(found);
  if (existing !== undefined) return { ok: true, kind: "existing", slot: existing };
  if (found.api !== undefined || found.web !== undefined)
    return {
      ok: false,
      status: 1,
      message: `${target} には .env.local がある。上書きしない (消してからやり直す)`,
    };
  // main は slot 0。ディレクトリが消えた worktree の slot は、空きとして数える。target は、ここまでの確認で
  // .env.local を持たないと分かっているので、除かなくても slot を持たない。
  const used = [
    0,
    ...others
      .filter((worktree) => worktree.exists)
      .flatMap((worktree) => slotOfWorktree(worktree) ?? []),
  ];
  const slot = lowestFreeSlot(used);
  if (slot === undefined) return { ok: false, status: 2, message: noFreeSlot };
  return { ok: true, kind: "new", slot, files: envFiles(slot) };
}

export type ShowPlan =
  | { readonly ok: true; readonly slot: number; readonly warning: string | undefined }
  | { readonly ok: false; readonly status: 1; readonly message: string };

// post-checkout の第 1 引数 (前の HEAD) が null ref、つまりゼロだけの ID か。git worktree add と git clone が、
// null ref を渡す。通常の checkout と switch は、前の HEAD を渡す (https://git-scm.com/docs/githooks)。
// オブジェクトの名前は、SHA-1 なら 16 進数の 40 桁、SHA-256 なら 64 桁 (https://git-scm.com/docs/hash-function-transition。
// 2026-11-12 に読んだ)。null ref はその長さのゼロだと判断して、どちらも受け付ける (SHA-256 のリポジトリでは確かめていない)。
export const isNullRef = (previousHead: string): boolean => /^(?:0{40}|0{64})$/.test(previousHead);

// post-checkout で、current (今の worktree の path) に slot を割り当てるか。null ref のときだけ割り当てる。
// main の checkout は slot 0 で、割り当てない (git clone でも null ref が来る)。
export function shouldAssignOnCheckout(
  previousHead: string,
  current: string,
  mainCheckout: string,
): boolean {
  return isNullRef(previousHead) && current !== mainCheckout;
}

// current の slot。同時に worktree を作って同じ slot を取った worktree があれば、警告を添える。
export function planShow(worktrees: readonly Worktree[], current: string): ShowPlan {
  if (current === worktrees[0]?.path) return { ok: true, slot: 0, warning: undefined };
  const me = worktrees.find((worktree) => worktree.path === current);
  const slot = me === undefined ? undefined : slotOfWorktree(me);
  if (slot === undefined)
    return {
      ok: false,
      status: 1,
      message:
        "この worktree には slot を割り当てていない。`node tools/scripts/src/dev-ports/cli.ts assign <worktree>` を実行する",
    };
  const sharing = worktrees.filter(
    (worktree) => worktree.path !== current && worktree.exists && slotOfWorktree(worktree) === slot,
  );
  return {
    ok: true,
    slot,
    warning:
      sharing.length === 0
        ? undefined
        : `slot ${slot} を ${sharing.map((worktree) => worktree.path).join("、")} も使っている。` +
          "どちらかの .env.local を消して assign し直す",
  };
}

export function portsFor(slot: number): Ports {
  if (!Number.isInteger(slot) || slot < 0 || slot >= slotCount)
    throw new RangeError(`slot は 0 以上 ${slotCount} 未満の整数にする: ${slot}`);
  const shift = slot * step;
  return {
    web: base.web + shift,
    api: base.api + shift,
    idp: base.idp + shift,
    storybook: base.storybook + shift,
  };
}
