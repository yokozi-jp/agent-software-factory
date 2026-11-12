import { describe, expect, it } from "vite-plus/test";
import {
  envFiles,
  lowestFreeSlot,
  portsFor,
  slotCount,
  slotOf,
  summary,
  worktreePaths,
} from "./rules.ts";

describe("summary", () => {
  it("slot の URL を、エージェントが設定ファイルを読まずに知れる形で並べること", () => {
    expect(summary(3)).toBe(
      [
        "slot 3",
        "web        http://localhost:5203",
        "api        http://localhost:3030",
        "idp        http://127.0.0.1:9030",
        "storybook  http://localhost:6036",
        "",
      ].join("\n"),
    );
  });
});

describe("worktreePaths", () => {
  it("git worktree list --porcelain から、worktree の path を出現順に取り出すこと", () => {
    const porcelain = [
      "worktree /work/app",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree /work/app-worktrees/feat/a",
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/feat/a",
      "",
      "worktree /work/app-worktrees/with space",
      "HEAD 3333333333333333333333333333333333333333",
      "detached",
      "",
    ].join("\n");
    expect(worktreePaths(porcelain)).toEqual([
      "/work/app",
      "/work/app-worktrees/feat/a",
      "/work/app-worktrees/with space",
    ]);
  });
});

describe("envFiles", () => {
  // 期待する中身は、手で書いたリテラルにする (関数と同じ式で組み立てない)。
  it("slot 3 の web 用ファイルに、web のポート、API の origin、Storybook のポートを書くこと", () => {
    expect(envFiles(3).web).toBe(
      [
        "# dev-ports: slot 3 (tools/scripts/src/dev-ports。docs/tooling/worktrees.md)",
        "WEB_PORT=5203",
        "API_ORIGIN=http://localhost:3030",
        "STORYBOOK_PORT=6036",
        "",
      ].join("\n"),
    );
  });

  it("slot 3 の API 用ファイルに、API と IdP のポート、web の origin、IdP の discovery を書くこと", () => {
    expect(envFiles(3).api).toBe(
      [
        "# dev-ports: slot 3 (tools/scripts/src/dev-ports。docs/tooling/worktrees.md)",
        "PORT=3030",
        "PUBLIC_ORIGIN=http://localhost:5203",
        "IDP_PORT=9030",
        "IDP_APP_ORIGIN=http://localhost:5203",
        "OIDC_DISCOVERY_URL=http://127.0.0.1:9030/.well-known/openid-configuration",
        "",
      ].join("\n"),
    );
  });
});

describe("slotOf", () => {
  it("書き出したファイルの印から slot を読むこと", () => {
    expect(slotOf(envFiles(5).api)).toBe(5);
  });

  it("ほかの変数が足されていても、印を読むこと", () => {
    expect(slotOf(`AUTH_SECRET=x\n${envFiles(2).api}OTHER=1\n`)).toBe(2);
  });

  it.each(["", "PORT=3000\n", "# dev-ports: slot x (説明)\n"])(
    "印がない、または数字でないとき undefined を返すこと: %j",
    (text) => {
      expect(slotOf(text)).toBeUndefined();
    },
  );

  // 印の形は正しくても、割り当ての範囲 (0〜7) の外なら、使われている slot として数えない。
  it.each([slotCount, slotCount + 1, 99])("範囲外の slot %s は undefined を返すこと", (slot) => {
    expect(slotOf(`# dev-ports: slot ${slot} (説明)\n`)).toBeUndefined();
  });

  it("範囲の最後の slot は読めること", () => {
    expect(slotOf(`# dev-ports: slot ${slotCount - 1} (説明)\n`)).toBe(slotCount - 1);
  });
});

describe("lowestFreeSlot", () => {
  it("main (slot 0) だけが使われているとき、1 を返すこと", () => {
    expect(lowestFreeSlot([0])).toBe(1);
  });

  it("使われていない番号のうち、いちばん小さいものを返すこと。消した worktree の番号を再び使う", () => {
    expect(lowestFreeSlot([0, 1, 3])).toBe(2);
  });

  it("slot 0 は main のものとして、使われていなくても返さないこと", () => {
    expect(lowestFreeSlot([])).toBe(1);
  });

  it("すべて使われているとき、worktree を整理するよう伝える例外にすること", () => {
    expect(() => lowestFreeSlot(Array.from({ length: slotCount }, (_, slot) => slot))).toThrow(
      /worktree を消/,
    );
  });
});

describe("portsFor", () => {
  it("slot 0 は main の checkout の既定のポートそのままであること", () => {
    expect(portsFor(0)).toEqual({ web: 5173, api: 3000, idp: 9000, storybook: 6006 });
  });

  it("slot ごとに、すべてのポートを 10 ずつずらすこと", () => {
    expect(portsFor(3)).toEqual({ web: 5203, api: 3030, idp: 9030, storybook: 6036 });
  });

  it.each([-1, 8, 1.5, Number.NaN])("範囲 0〜7 の整数でない slot %s を拒否すること", (slot) => {
    expect(() => portsFor(slot)).toThrow(RangeError);
  });

  // compose.local.yaml と compose.otel-lgtm.yaml がホスト側に開くポート (docs/tooling/local-worker.md)。
  // slot 8 の IdP は 9080 になり、人事システムのフェイクと重なる。
  it("どの slot のポートも、compose が開くポートと重ならないこと", () => {
    const compose = [1025, 3001, 3200, 4318, 5432, 8025, 9080, 9324];
    for (let slot = 0; slot < slotCount; slot += 1)
      expect(Object.values(portsFor(slot)).filter((port) => compose.includes(port))).toEqual([]);
  });

  it("slot の間でポートが重ならないこと", () => {
    const all = Array.from({ length: slotCount }, (_, slot) =>
      Object.values(portsFor(slot)),
    ).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});
