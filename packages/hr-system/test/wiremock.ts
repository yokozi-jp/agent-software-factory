import { z } from "zod";

// WireMock の管理 API (/__admin) の薄い呼び出し。テストの準備と、受けた要求の回数の verify に使う。
export interface Stub {
  readonly request: { readonly method: "GET"; readonly urlPath: string };
  readonly response:
    | {
        readonly status: number;
        readonly headers?: Record<string, string>;
        readonly jsonBody?: unknown;
        readonly fixedDelayMilliseconds?: number;
      }
    | { readonly fault: "CONNECTION_RESET_BY_PEER" };
  readonly scenarioName?: string;
  readonly requiredScenarioState?: string;
  readonly newScenarioState?: string;
}

async function admin(origin: string, path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${origin}/__admin${path}`, init);
  if (!response.ok) throw new Error(`WireMock ${path}: ${response.status}`);
  return response;
}

/** 状態 (足したスタブ、シナリオの状態、受けた要求の記録) を消し、ファイルのスタブに戻す。 */
export async function resetFake(origin: string): Promise<void> {
  await admin(origin, "/reset", { method: "POST" });
}

export async function addStub(origin: string, stub: Stub): Promise<void> {
  await admin(origin, "/mappings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stub),
  });
}

/** 受けた GET の回数。クライアントが諦めた要求も、WireMock が受けていれば数える。 */
export async function receivedGetCount(origin: string, urlPath: string): Promise<number> {
  const response = await admin(origin, "/requests/count", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "GET", urlPath }),
  });
  return z.object({ count: z.number() }).parse(await response.json()).count;
}
