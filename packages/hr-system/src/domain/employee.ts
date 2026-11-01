import type { components } from "./schema.gen.ts";

/** 人事システムの社員。契約は openapi.yaml (Employee)。 */
export type Employee = components["schemas"]["Employee"];

/**
 * 人事システムを引く口。実装は `./client` (ky)。呼ぶ側は、この型にだけ依存する (docs/adr/0054)。
 * どの関数も `signal` を受け取る。呼ぶ側が中断したとき、外へ出たリクエストも止める (docs/adr/0054 D7)。
 */
export interface HrSystemClient {
  /** メールアドレスで社員を引く。いなければ null。 */
  readonly findEmployeeByEmail: (email: string, signal?: AbortSignal) => Promise<Employee | null>;
  /** 社員番号で上長を引く。社員がいない、または上長がいなければ null。 */
  readonly findManager: (employeeNumber: string, signal?: AbortSignal) => Promise<Employee | null>;
}
