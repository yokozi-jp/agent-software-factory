import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

// キーの検査 (docs/adr/0044) の検出力 (#43)。`i18next-cli` の中身は確かめない。確かめるのは、このリポジトリの設定
// (i18next.config.ts の対象の glob と失敗条件) が、欠けたキーと使われないキーで実際に失敗すること。設定を壊す
// (glob が web に届かない、テストの `t("…")` を使われている印にする) と、ここが失敗する。
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = join(packageRoot, "i18next.config.ts");
const cli = join(
  dirname(createRequire(import.meta.url).resolve("i18next-cli/package.json")),
  "dist/esm/cli.js",
);

/** fixture の配置は、リポジトリの `packages/i18n` と `apps/web` と同じ。cwd は fixture の packages/i18n。 */
function run(fixture: string, ...args: string[]): number | null {
  const cwd = join(packageRoot, "test/__fixtures__/keys", fixture, "packages/i18n");
  return spawnSync(process.execPath, [cli, "--config", config, "status", ...args], {
    cwd,
    encoding: "utf8",
  }).status;
}

// CLI を子 process で起動する。ほかの project のテストと並列に流れると 1 回に 10 秒以上かかるので、既定の 5 秒では足りない。
describe("キーの検査の検出力", { timeout: 60_000 }, () => {
  it("揃っていて使われているキーだけなら、どちらの検査も通ること", () => {
    expect(run("complete")).toBe(0);
    expect(run("complete", "--unused")).toBe(0);
  });

  it("ある言語のリソースにキーが欠けていると、status が失敗すること", () => {
    expect(run("missing-in-en")).not.toBe(0);
  });

  it("web のコードが使うキーがリソースにないと、status が失敗すること", () => {
    expect(run("missing-in-resources")).not.toBe(0);
  });

  it("packages/i18n のコードが使うキーがリソースにないと、status が失敗すること", () => {
    expect(run("missing-in-package-code")).not.toBe(0);
  });

  it("どこからも使われないキーがあると、status --unused が失敗すること", () => {
    expect(run("unused", "--unused")).not.toBe(0);
  });

  it("テストだけが使うキーは、使われているとみなさず、status --unused が失敗すること", () => {
    expect(run("used-only-in-test", "--unused")).not.toBe(0);
  });
});
