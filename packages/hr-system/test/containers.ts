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

/**
 * コンテナを使い回すか。既定は使い回さず、実行ごとに起動して終わりに止める (落ちても Ryuk が消す)。
 * `HR_SYSTEM_FAKE_REUSE=1` のときだけ withReuse() で使い回し、起動を待たない。使い回したコンテナは
 * 実行が終わっても残り、Ryuk も消さない (`docker rm -f` で消す)。
 */
export const reuseHrSystemFake = process.env["HR_SYSTEM_FAKE_REUSE"] === "1";

/**
 * 人事システムのフェイク (WireMock) を起動する。
 * スタブは bind mount で読むので、使い回しても /__admin/reset で最新のファイルに戻る。
 */
export function startHrSystemFake(): Promise<StartedTestContainer> {
  const container = new GenericContainer(image)
    .withExposedPorts(8080)
    .withBindMounts([{ source: fakeDirectory, target: "/home/wiremock", mode: "ro" }])
    .withWaitStrategy(Wait.forHttp("/__admin/health", 8080));
  return (reuseHrSystemFake ? container.withReuse() : container).start();
}
