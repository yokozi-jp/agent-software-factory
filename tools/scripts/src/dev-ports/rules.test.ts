import { describe, expect, it } from "vite-plus/test";
import {
  envFiles,
  localOrigin,
  lowestFreeSlot,
  planAssign,
  planShow,
  portsFor,
  slotCount,
  slotOf,
  summary,
  worktreePaths,
  type Worktree,
} from "./rules.ts";

// main と、そのほかの worktree。files は apps/web と apps/api の .env.local の中身 (なければ undefined)。
const main: Worktree = { path: "/w/app", exists: true, api: undefined, web: undefined };
const assigned = (path: string, slot: number, exists = true): Worktree => ({
  path,
  exists,
  api: envFiles(slot).api,
  web: envFiles(slot).web,
});
const fresh = (path: string): Worktree => ({ path, exists: true, api: undefined, web: undefined });

describe("localOrigin", () => {
  it("ポートから http の origin を組み立てること", () => {
    expect(localOrigin(5183)).toBe("http://localhost:5183");
  });
});

describe("planAssign", () => {
  it("まだ割り当てのない worktree に、使われていない最小の slot とそのファイルを返すこと", () => {
    expect(planAssign([main, fresh("/w/a"), assigned("/w/b", 1)], "/w/a")).toEqual({
      ok: true,
      slot: 2,
      files: envFiles(2),
    });
  });

  it("main の checkout を、終了コード 2 で断ること", () => {
    expect(planAssign([main, fresh("/w/a")], "/w/app")).toMatchObject({ ok: false, status: 2 });
  });

  it("git の worktree でない path を、終了コード 2 で断ること", () => {
    expect(planAssign([main, fresh("/w/a")], "/elsewhere")).toMatchObject({
      ok: false,
      status: 2,
    });
  });

  it("どちらかの .env.local がすでにあれば、上書きせず終了コード 1 で断ること", () => {
    const onlyApi: Worktree = {
      path: "/w/a",
      exists: true,
      api: "AUTH_SECRET=x\n",
      web: undefined,
    };
    const onlyWeb: Worktree = { path: "/w/a", exists: true, api: undefined, web: "X=1\n" };
    expect(planAssign([main, onlyApi], "/w/a")).toMatchObject({ ok: false, status: 1 });
    expect(planAssign([main, onlyWeb], "/w/a")).toMatchObject({ ok: false, status: 1 });
  });

  // git は、ディレクトリを手で消した worktree を prunable として一覧に残す。その slot は使われていない。
  it("ディレクトリが消えた worktree の slot を、空きとして数えること", () => {
    const gone = assigned("/w/gone", 1, false);
    expect(planAssign([main, gone, fresh("/w/a")], "/w/a")).toMatchObject({ ok: true, slot: 1 });
  });

  // 片方のファイルを消されても、もう片方の印で、その slot は使われているとみなす。
  it("印が web か api のどちらか 1 つにしかなくても、その slot を使用中として数えること", () => {
    const onlyWebMarked: Worktree = {
      path: "/w/b",
      exists: true,
      api: undefined,
      web: envFiles(1).web,
    };
    const onlyApiMarked: Worktree = {
      path: "/w/c",
      exists: true,
      api: envFiles(2).api,
      web: undefined,
    };
    expect(planAssign([main, onlyWebMarked, onlyApiMarked, fresh("/w/a")], "/w/a")).toMatchObject({
      ok: true,
      slot: 3,
    });
  });

  it("slot が尽きたら、worktree を消すよう伝えて終了コード 2 で断ること", () => {
    const full = Array.from({ length: slotCount - 1 }, (_, index) =>
      assigned(`/w/${index}`, index + 1),
    );
    const plan = planAssign([main, ...full, fresh("/w/new")], "/w/new");
    expect(plan).toMatchObject({ ok: false, status: 2 });
    expect(plan.ok ? "" : plan.message).toContain("worktree を消");
  });
});

describe("planShow", () => {
  it("main の checkout では、slot 0 を返すこと", () => {
    expect(planShow([main, assigned("/w/a", 1)], "/w/app")).toEqual({
      ok: true,
      slot: 0,
      warning: undefined,
    });
  });

  it("割り当てた worktree では、その slot を返すこと", () => {
    expect(planShow([main, assigned("/w/a", 3)], "/w/a")).toEqual({
      ok: true,
      slot: 3,
      warning: undefined,
    });
  });

  it("割り当てていない worktree では、assign するよう伝えて終了コード 1 で断ること", () => {
    const plan = planShow([main, fresh("/w/a")], "/w/a");
    expect(plan).toMatchObject({ ok: false, status: 1 });
    expect(plan.ok ? "" : plan.message).toContain("assign");
  });

  it("worktree の一覧にない場所では、assign するよう伝えて終了コード 1 で断ること", () => {
    expect(planShow([main, assigned("/w/a", 1)], "/w/unknown")).toMatchObject({
      ok: false,
      status: 1,
    });
  });

  // 同時に worktree を作ると、同じ slot を取りうる。起動は strictPort が止めるが、原因は show が教える。
  it("同じ slot を使っているほかの worktree があれば、警告を添えること", () => {
    const plan = planShow([main, assigned("/w/a", 2), assigned("/w/b", 2)], "/w/a");
    expect(plan).toMatchObject({ ok: true, slot: 2 });
    expect(plan.ok ? plan.warning : undefined).toContain("/w/b");
  });

  it("同じ slot でも、ディレクトリが消えた worktree は警告しないこと", () => {
    const plan = planShow([main, assigned("/w/a", 2), assigned("/w/b", 2, false)], "/w/a");
    expect(plan).toMatchObject({ ok: true, warning: undefined });
  });
});

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

  it("すべて使われているとき、undefined を返すこと", () => {
    expect(lowestFreeSlot(Array.from({ length: slotCount }, (_, slot) => slot))).toBeUndefined();
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

  // compose のポートとの重なりは、実際の compose ファイルを読む tools のテストで確かめる
  // (src/configs/dev-ports.tools.test.ts)。ここの手書きの一覧は、compose を変えても失敗しない。
  it("slot の間でポートが重ならないこと", () => {
    const all = Array.from({ length: slotCount }, (_, slot) =>
      Object.values(portsFor(slot)),
    ).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});
