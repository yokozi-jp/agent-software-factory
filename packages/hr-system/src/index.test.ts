import { randomUUID } from "node:crypto";

import { isHTTPError, isTimeoutError } from "ky";
import { beforeEach, describe, expect, inject, it } from "vite-plus/test";

import { addStub, receivedGetCount, resetFake } from "../test/wiremock.ts";
import { createHrSystemClient, type Employee } from "./index.ts";

// 境界 1: クライアントの関数を直接呼び、WireMock の人事システムのフェイクを相手にする。
// テナントの接頭辞をテストごとに変え、テストの間は /__admin/reset で状態を消す。
const origin = inject("hrSystemFakeOrigin");

const taro: Employee = {
  employeeNumber: "E1001",
  email: "taro@example.com",
  active: true,
  hasAccountingRole: false,
};
const manager: Employee = {
  employeeNumber: "E1002",
  email: "hanako@example.com",
  active: true,
  hasAccountingRole: true,
};

let tenant: string;
let client: ReturnType<typeof createHrSystemClient>;
beforeEach(async () => {
  await resetFake(origin);
  tenant = `tenant-${randomUUID()}`;
  client = createHrSystemClient({ baseUrl: `${origin}/${tenant}` });
});

const employeesPath = () => `/${tenant}/employees`;
const managerPath = (employeeNumber: string) => `/${tenant}/employees/${employeeNumber}/manager`;
const ok = (jsonBody: unknown) => ({
  status: 200,
  headers: { "Content-Type": "application/json" },
  jsonBody,
});

describe("社員を引く", () => {
  it("メールアドレスで社員を引ける", async () => {
    await addStub(origin, {
      request: { method: "GET", urlPath: employeesPath() },
      response: ok(taro),
    });

    expect(await client.findEmployeeByEmail("taro@example.com")).toEqual(taro);
    expect(await receivedGetCount(origin, employeesPath())).toBe(1);
  });

  it("社員番号で上長を引ける", async () => {
    await addStub(origin, {
      request: { method: "GET", urlPath: managerPath("E1001") },
      response: ok(manager),
    });

    expect(await client.findManager("E1001")).toEqual(manager);
  });

  it("社員がいない 404 は null で返し、再試行しない", async () => {
    await addStub(origin, {
      request: { method: "GET", urlPath: employeesPath() },
      response: { status: 404 },
    });
    await addStub(origin, {
      request: { method: "GET", urlPath: managerPath("E1001") },
      response: { status: 404 },
    });

    expect(await client.findEmployeeByEmail("nobody@example.com")).toBeNull();
    expect(await client.findManager("E1001")).toBeNull();
    expect(await receivedGetCount(origin, employeesPath())).toBe(1);
    expect(await receivedGetCount(origin, managerPath("E1001"))).toBe(1);
  });
});

describe("人事システムが不調なとき", () => {
  it("1 回目が 503、2 回目が 200 なら、再試行して社員を返す", async () => {
    const request = { method: "GET", urlPath: employeesPath() } as const;
    await addStub(origin, {
      request,
      response: { status: 503 },
      scenarioName: "recovers",
      requiredScenarioState: "Started",
      newScenarioState: "recovered",
    });
    await addStub(origin, {
      request,
      response: ok(taro),
      scenarioName: "recovers",
      requiredScenarioState: "recovered",
    });

    expect(await client.findEmployeeByEmail("taro@example.com")).toEqual(taro);
    expect(await receivedGetCount(origin, employeesPath())).toBe(2);
  });

  it("毎回 503 なら、最初と再試行 2 回の 3 回で止まり、失敗を投げる", async () => {
    await addStub(origin, {
      request: { method: "GET", urlPath: employeesPath() },
      response: { status: 503 },
    });

    const error = await client.findEmployeeByEmail("taro@example.com").catch((e: unknown) => e);

    expect(isHTTPError(error) && error.response.status).toBe(503);
    expect(await receivedGetCount(origin, employeesPath())).toBe(3);
  });

  it("接続が切られたら、再試行して 3 回で止まり、失敗を投げる", async () => {
    await addStub(origin, {
      request: { method: "GET", urlPath: employeesPath() },
      response: { fault: "CONNECTION_RESET_BY_PEER" },
    });

    await expect(client.findEmployeeByEmail("taro@example.com")).rejects.toBeInstanceOf(Error);
    expect(await receivedGetCount(origin, employeesPath())).toBe(3);
  });

  it("試行ごとのタイムアウトを超える遅延は、再試行しても全体のタイムアウトで止まる", async () => {
    await addStub(origin, {
      request: { method: "GET", urlPath: employeesPath() },
      response: { ...ok(taro), fixedDelayMilliseconds: 3000 },
    });

    const started = performance.now();
    const error = await client.findEmployeeByEmail("taro@example.com").catch((e: unknown) => e);
    const elapsed = performance.now() - started;

    expect(isTimeoutError(error)).toBe(true);
    // 全体の 5 秒を大きく超えない。試行は 2 秒で切れるので、少なくとも 2 回は再試行している。
    expect(elapsed).toBeLessThan(6000);
    expect(await receivedGetCount(origin, employeesPath())).toBeGreaterThanOrEqual(2);
  });
});

describe("テナント", () => {
  it("別のテナントの接頭辞に要求が飛ばない", async () => {
    const other = `tenant-${randomUUID()}`;
    const otherEmployee: Employee = { ...taro, employeeNumber: "E2001" };
    await addStub(origin, {
      request: { method: "GET", urlPath: employeesPath() },
      response: ok(taro),
    });
    await addStub(origin, {
      request: { method: "GET", urlPath: `/${other}/employees` },
      response: ok(otherEmployee),
    });
    const otherClient = createHrSystemClient({ baseUrl: `${origin}/${other}` });

    expect(await client.findEmployeeByEmail("taro@example.com")).toEqual(taro);
    expect(await otherClient.findEmployeeByEmail("taro@example.com")).toEqual(otherEmployee);
    expect(await receivedGetCount(origin, employeesPath())).toBe(1);
    expect(await receivedGetCount(origin, `/${other}/employees`)).toBe(1);
  });
});
