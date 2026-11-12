import type { TestProject } from "vite-plus/test/node";

import { reuseHrSystemFake, startHrSystemFake } from "./containers.ts";

declare module "vite-plus/test" {
  export interface ProvidedContext {
    /** 人事システムのフェイクの origin。テナントの接頭辞 `/<tenant_id>` は含まない。 */
    hrSystemFakeOrigin: string;
  }
}

// 1 回の実行につき 1 回だけ起動し、URL を project.provide で渡す。
export default async function setup(project: TestProject) {
  const fake = await startHrSystemFake();
  project.provide("hrSystemFakeOrigin", `http://${fake.getHost()}:${fake.getMappedPort(8080)}`);

  return async () => {
    // 使い回したコンテナは止めない (次の実行が使う)。それ以外は、この実行で起動したので止める。
    if (!reuseHrSystemFake) await fake.stop();
  };
}
