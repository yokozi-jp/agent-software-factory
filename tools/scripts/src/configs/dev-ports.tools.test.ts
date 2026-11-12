// The ports of the dev servers (Issue #184) are written where each server starts, and again in dev-ports/rules.ts as
// slot 0. These tests read those files and the compose files of the workspace, so a default that changes in one place
// and not in the other fails here, and so does a slot that lands on a port a compose service opens. Every file it reads
// is an input of the test-tools target (package.json): compose.*.yaml, the app files named below, dev-server.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { devServer } from "../../../../dev-server.ts";
import { portsFor, slotCount } from "../dev-ports/rules.ts";

const workspace = join(import.meta.dirname, "../../../..");
const text = (path: string): string => readFileSync(join(workspace, path), "utf8");

const main = portsFor(0);

describe("slot 0 は、各アプリの既定のポートと同じであること", () => {
  it("web の開発サーバーと、その proxy の先 (API) の既定", () => {
    expect(devServer({})).toMatchObject({
      port: main.web,
      proxy: { "/api": `http://localhost:${main.api}` },
    });
  });

  it("API の vp dev の既定 (apps/api/vite.config.ts)", () => {
    expect(text("apps/api/vite.config.ts")).toContain(`port(env, "PORT", ${main.api})`);
  });

  it("API の起動 (server.ts) が読む PORT の既定 (apps/api/src/env.ts)", () => {
    expect(text("apps/api/src/env.ts")).toMatch(
      new RegExp(String.raw`PORT:[\s\S]*?\.default\(${main.api}\)`),
    );
  });

  it("ローカルの IdP の既定 (apps/api/test/dev-idp.ts)", () => {
    expect(text("apps/api/test/dev-idp.ts")).toContain(`IDP_PORT"] ?? ${main.idp}`);
  });

  it("Storybook の既定 (apps/web/package.json)", () => {
    expect(text("apps/web/package.json")).toContain(`\${STORYBOOK_PORT:-${main.storybook}}`);
  });
});

// compose のファイルが、ホスト側に開くポート (`"127.0.0.1:5432:5432"` の最初の数字)。
function composePorts(): number[] {
  return ["compose.local.yaml", "compose.otel-lgtm.yaml"].flatMap((file) =>
    [...text(file).matchAll(/^\s*-\s*"(?:127\.0\.0\.1:)?(\d+):\d+"/gm)].map((match) =>
      Number(match[1]),
    ),
  );
}

describe("compose のポートとの重なり", () => {
  it("compose のファイルから、ホスト側のポートを読めていること", () => {
    // 読めなければ、下の確認は空の一覧に対して通ってしまう。
    expect(composePorts()).toEqual(expect.arrayContaining([5432, 9324, 1025, 8025, 9080]));
  });

  it("どの slot のポートも、compose がホスト側に開くポートと重ならないこと", () => {
    const opened = composePorts();
    for (let slot = 0; slot < slotCount; slot += 1)
      expect(Object.values(portsFor(slot)).filter((port) => opened.includes(port))).toEqual([]);
  });

  // 範囲が 0〜7 の理由。slot 8 があれば、その IdP (9000 + 8 × 10) は、人事システムのフェイクのポートと重なる。
  // portsFor(8) は例外にするので、slot 7 の IdP に刻みの 10 を足して求める。
  it("slot 7 の次の slot の IdP のポートは、compose のポートと重なること (範囲 0〜7 を広げない根拠)", () => {
    const step = portsFor(1).idp - portsFor(0).idp;
    expect(composePorts()).toContain(portsFor(slotCount - 1).idp + step);
  });
});
