import ky, { isHTTPError } from "ky";

import type { components } from "./schema.gen.ts";

/** 人事システムの社員。契約は openapi.yaml (Employee)。 */
export type Employee = components["schemas"]["Employee"];

export interface HrSystemClient {
  /** メールアドレスで社員を引く。いなければ null。 */
  readonly findEmployeeByEmail: (email: string) => Promise<Employee | null>;
  /** 社員番号で上長を引く。社員がいない、または上長がいなければ null。 */
  readonly findManager: (employeeNumber: string) => Promise<Employee | null>;
}

// 値は docs/adr/0023 の人事システムの値。相手の性質で決めた判断で、別の外部システムに写さない。
// ky の既定は、タイムアウトで再試行せず (retryOnTimeout: false)、ジッターもない (jitter: undefined) ので明示する。
// 再試行する状態コード (408、413、429、500、502、503、504) と、429、503 の Retry-After は ky の既定のまま。
const timeoutMs = 2000;
const totalTimeoutMs = 5000;
const retry = { limit: 2, methods: ["get"], retryOnTimeout: true, jitter: true } as const;

/**
 * 人事システムのクライアントを作る。
 * baseUrl は人事システムの接続先で、テナントごとに違う (テナントごとの設定)。フェイクでは `http://host:port/<tenant_id>`。
 * 404 は null で返し、再試行しない。人事システムが止まったとき (タイムアウト、接続断、再試行しても 5xx) は、
 * ky のエラー (HTTPError、TimeoutError、NetworkError) を投げる。ログインも申請も失敗にするのは呼んだ側 (docs/adr/0022)。
 */
export function createHrSystemClient(options: { readonly baseUrl: string }): HrSystemClient {
  const http = ky.create({
    prefix: options.baseUrl,
    timeout: timeoutMs,
    totalTimeout: totalTimeoutMs,
    retry,
  });

  const getEmployee = async (
    path: string,
    searchParams?: Record<string, string>,
  ): Promise<Employee | null> => {
    try {
      return await http
        .get<Employee>(path, searchParams === undefined ? {} : { searchParams })
        .json();
    } catch (error) {
      if (isHTTPError(error) && error.response.status === 404) return null;
      throw error;
    }
  };

  return {
    findEmployeeByEmail: (email) => getEmployee("employees", { email }),
    findManager: (employeeNumber) =>
      getEmployee(`employees/${encodeURIComponent(employeeNumber)}/manager`),
  };
}
