import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createSqsClient } from "./queues.ts";

describe("SQS の client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("endpoint を上書きしたときは、AWS_USE_DUALSTACK_ENDPOINT=true があっても dual-stack を使わないこと", async () => {
    vi.stubEnv("AWS_USE_DUALSTACK_ENDPOINT", "true");
    const client = createSqsClient({ endpoint: "http://localhost:9324", region: "ap-northeast-1" });

    expect(await client.config.useDualstackEndpoint()).toBe(false);
  });

  it("endpoint がない本番では、AWS_USE_DUALSTACK_ENDPOINT に従うこと", async () => {
    vi.stubEnv("AWS_USE_DUALSTACK_ENDPOINT", "true");
    const client = createSqsClient({ region: "ap-northeast-1" });

    expect(await client.config.useDualstackEndpoint()).toBe(true);
  });
});
