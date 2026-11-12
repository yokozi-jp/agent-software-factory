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
// worktree を消すと、その slot は再び空く。
export function lowestFreeSlot(used: readonly number[]): number {
  for (let slot = 1; slot < slotCount; slot += 1) if (!used.includes(slot)) return slot;
  throw new RangeError(
    `空いている slot がない (${slotCount - 1} 個の worktree が使用中)。使い終えた worktree を消してからやり直す`,
  );
}

// worktree の apps/web と apps/api の .env.local の中身。Vite と Nx が読む、gitignore 済みの標準の置き場所 (.gitignore の .env.*)。
// 変数は独立させ、別のアプリへの参照は URL にする (twelve-factor の III. Config と VII. Port binding)。
// 先頭の行は、どの slot が使われているかを他の worktree が読むための印 (slotOf)。
const marker = (slot: number): string =>
  `# dev-ports: slot ${slot} (tools/scripts/src/dev-ports。docs/tooling/worktrees.md)`;

export function envFiles(slot: number): { readonly web: string; readonly api: string } {
  const ports = portsFor(slot);
  const webOrigin = `http://localhost:${ports.web}`;
  const lines = (...entries: string[]): string => [marker(slot), ...entries, ""].join("\n");
  return {
    web: lines(
      `WEB_PORT=${ports.web}`,
      `API_ORIGIN=http://localhost:${ports.api}`,
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
    `web        http://localhost:${ports.web}`,
    `api        http://localhost:${ports.api}`,
    `idp        http://127.0.0.1:${ports.idp}`,
    `storybook  http://localhost:${ports.storybook}`,
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
