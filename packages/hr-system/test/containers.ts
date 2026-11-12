import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";
import { z } from "zod";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";

// イメージは、手で動かす環境 (compose.local.yaml) と同じものを読む。版を 2 か所に持たない (Renovate は compose の 1 か所を上げる)。
// スタブ (fake/mappings) も同じディレクトリを読む。WireMock 3.13.2 で調べた (Issue #171)。
// Node 向けの WireMock 専用の Testcontainers モジュール (v0.0.1) は使わず、testcontainers 本体の GenericContainer で起動する。
const composeFile = fileURLToPath(new URL("../../../compose.local.yaml", import.meta.url));
const fakeDirectory = fileURLToPath(new URL("../fake", import.meta.url));

const composeSchema = z.object({
  services: z.object({ "hr-system-fake": z.object({ image: z.string() }) }),
});
const image = composeSchema.parse(parse(readFileSync(composeFile, "utf8"))).services[
  "hr-system-fake"
].image;

// 既定は使い回さない。使い回したコンテナは Ryuk の管理外で、実行が終わっても残る (docs/tooling/hr-system-fake.md)。
// 使い回す相手は、testcontainers 12.2.1 では createOpts (イメージ、ラベルなど) のハッシュで決まり、bind mount (HostConfig.Binds) は入らない。
// ラベルにスタブのディレクトリを入れ、別の worktree のスタブを読むコンテナを使い回さないようにする。
// TESTCONTAINERS_REUSE_ENABLE=false のとき testcontainers は withReuse() を無視し、Ryuk の管理下で新しく起動するので、止める側に回す。
const reuse =
  process.env["HR_SYSTEM_FAKE_REUSE"] === "1" &&
  process.env["TESTCONTAINERS_REUSE_ENABLE"] !== "false";

/** 人事システムのフェイク (WireMock) を起動する。スタブは bind mount で読むので、使い回しても /__admin/reset で最新のファイルに戻る。 */
export function startHrSystemFake(): Promise<StartedTestContainer> {
  const container = new GenericContainer(image)
    .withExposedPorts(8080)
    .withLabels({ "hr-system-fake-directory": fakeDirectory })
    .withBindMounts([{ source: fakeDirectory, target: "/home/wiremock", mode: "ro" }])
    .withWaitStrategy(Wait.forHttp("/__admin/health", 8080));
  return (reuse ? container.withReuse() : container).start();
}

/** 人事システムのフェイクを止める。使い回したコンテナは止めない (次の実行が使う)。 */
export async function stopHrSystemFake(fake: StartedTestContainer): Promise<void> {
  if (!reuse) await fake.stop();
}
