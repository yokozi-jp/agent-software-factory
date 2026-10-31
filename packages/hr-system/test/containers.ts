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
 * 人事システムのフェイク (WireMock) を起動する。
 * 手元は withReuse() で使い回し、毎回の起動を待たない。CI は毎回新しく起動する。
 * スタブは bind mount で読むので、使い回しても /__admin/reset で最新のファイルに戻る。
 */
export function startHrSystemFake(): Promise<StartedTestContainer> {
  const container = new GenericContainer(image)
    .withExposedPorts(8080)
    .withBindMounts([{ source: fakeDirectory, target: "/home/wiremock", mode: "ro" }])
    .withWaitStrategy(Wait.forHttp("/__admin/health", 8080));
  return (process.env["CI"] === undefined ? container.withReuse() : container).start();
}
