// dev-server.ts of the workspace root: how apps/web and apps/api read the dev-server port and the API origin from
// their environment (Issue #184, docs/tooling/worktrees.md). Reads dev-server.ts of the workspace, an input of the
// test-tools target (package.json, "{workspaceRoot}/*.ts").
import { describe, expect, it } from "vite-plus/test";
import { devServer, origin, port } from "../../../../dev-server.ts";

describe("port", () => {
  it("設定がなければ、既定のポートを返すこと", () => {
    expect(port({}, "WEB_PORT", 5173)).toBe(5173);
  });

  it("設定があれば、その数値を返すこと", () => {
    expect(port({ WEB_PORT: "5203" }, "WEB_PORT", 5173)).toBe(5203);
  });

  // 空の値を 0 や既定に黙って読み替えると、設定の書き間違いが見えない (apps/api/src/env.ts の PORT と同じ扱い)。
  it.each(["", "abc", "52 03", "0", "65536", "-1", "1.5"])(
    "ポートとして正しくない値 %j は、変数名を入れた例外にすること",
    (value) => {
      expect(() => port({ WEB_PORT: value }, "WEB_PORT", 5173)).toThrow(/WEB_PORT/);
    },
  );
});

describe("origin", () => {
  it("設定がなければ、既定の origin を返すこと", () => {
    expect(origin({}, "API_ORIGIN", "http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("設定があれば、その origin を返すこと", () => {
    expect(origin({ API_ORIGIN: "http://localhost:3030" }, "API_ORIGIN", "http://x")).toBe(
      "http://localhost:3030",
    );
  });

  it.each(["", "localhost:3000", "ftp://localhost:3000", "http://localhost:3000/api", "not a url"])(
    "http(s) の origin でない値 %j は、変数名を入れた例外にすること",
    (value) => {
      expect(() => origin({ API_ORIGIN: value }, "API_ORIGIN", "http://x")).toThrow(/API_ORIGIN/);
    },
  );
});

describe("devServer", () => {
  it("設定がなければ、今までの既定 (5173、API は 3000) で、ポートが塞がっていれば失敗する設定にすること", () => {
    expect(devServer({})).toEqual({
      port: 5173,
      strictPort: true,
      proxy: { "/api": "http://localhost:3000" },
    });
  });

  it("WEB_PORT と API_ORIGIN を、サーバーの設定と proxy の先に反映すること", () => {
    expect(devServer({ WEB_PORT: "5203", API_ORIGIN: "http://localhost:3030" })).toEqual({
      port: 5203,
      strictPort: true,
      proxy: { "/api": "http://localhost:3030" },
    });
  });
});
