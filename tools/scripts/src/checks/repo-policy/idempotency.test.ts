// The checks of the idempotency key of the writers
// (./idempotency.ts), each called alone on a small repository held in memory: a case breaks one file of
// a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import { failuresOf, repo } from "./fixtures/repo.ts";
import { headerNamesAgree, writersUseIdempotencyKey } from "./idempotency.ts";

describe("ADR 0040: モジュールの書き込み手が withIdempotencyKey を通ること", () => {
  const violations = failuresOf(writersUseIdempotencyKey, headerNamesAgree);
  const store = "packages/claim/src/application/submit-claim.ts";
  const importing = (names: string): string =>
    `import { ${names} } from "@agent-software-factory/shared-kernel/${names.includes("withIdempotencyKey") ? "idempotency-db" : "tenant-db"}";\nexport {};\n`;
  const failure = (path: string): string =>
    `${path} opens a transaction but does not use withIdempotencyKey. A write of an HTTP request goes through withIdempotencyKey of @agent-software-factory/shared-kernel/idempotency-db; a writer that is not one (a consumer, a batch) says why with a line \`// idempotency-exempt: <reason>\` (docs/adr/0040).`;

  it("transaction を開いて withIdempotencyKey を使うファイルを通すこと", () => {
    expect(
      violations(repo({ [store]: importing("inTenantTransaction, withIdempotencyKey") })),
    ).toEqual([]);
  });

  it("withIdempotencyKey なしで transaction を開くファイルを挙げること", () => {
    expect(violations(repo({ [store]: importing("inTenantTransaction") }))).toEqual([
      failure(store),
    ]);
  });

  it("複数行の import と beginTenantTransaction を読むこと", () => {
    const path = "packages/closing/src/infrastructure/close.ts";
    expect(
      violations(
        repo({
          [path]:
            'import {\n  Database,\n  beginTenantTransaction,\n} from "@agent-software-factory/shared-kernel/tenant-db";\n',
        }),
      ),
    ).toEqual([failure(path)]);
  });

  it("コメントの中の言及を、使用と取り違えないこと", () => {
    expect(
      violations(repo({ [store]: `// withIdempotencyKey\n${importing("inTenantTransaction")}` })),
    ).toEqual([failure(store)]);
  });

  it("免除の理由を述べる行のあるファイルを通すこと", () => {
    expect(
      violations(
        repo({
          [store]: `// idempotency-exempt: a consumer of the queue, deduplicated by processed_message\n${importing("inTenantTransaction")}`,
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["an indented line", `  // idempotency-exempt: a consumer\n`],
    ["a tab and spaces after the slashes", `//\t  idempotency-exempt: a consumer\n`],
    ["spaces before the reason", `// idempotency-exempt:    a consumer\n`],
    ["a reason right after the colon", `// idempotency-exempt:a consumer\n`],
    ["a line after other lines", `// a writer\n\n// idempotency-exempt: a consumer\n`],
  ])("%s と書いた免除を通すこと", (_, line) => {
    expect(violations(repo({ [store]: `${line}${importing("inTenantTransaction")}` }))).toEqual([]);
  });

  it("コードの行の末尾にある免除と、コメントではない免除を採らないこと", () => {
    for (const line of [
      "const x = 1; // idempotency-exempt: a consumer\n",
      "x // idempotency-exempt: a consumer\n",
      "/ idempotency-exempt: a consumer\n",
    ])
      expect(violations(repo({ [store]: `${line}${importing("inTenantTransaction")}` }))).toEqual([
        failure(store),
      ]);
  });

  it("理由のない免除を採らないこと", () => {
    expect(
      violations(repo({ [store]: `// idempotency-exempt:\n${importing("inTenantTransaction")}` })),
    ).toEqual([failure(store)]);
  });

  it("transaction を開かないファイルを通すこと", () => {
    expect(violations(repo({ [store]: importing("Database") }))).toEqual([]);
  });

  it("テストと fixture を除き、application と infrastructure の層だけを読むこと", () => {
    const text = importing("inTenantTransaction");
    expect(
      violations(
        repo({
          "packages/claim/src/domain/rule.ts": text,
          "packages/claim/src/application/submit-claim.test.ts": text,
          "packages/claim/src/application/__fixtures__/bypass.ts": text,
          "packages/shared-kernel/src/messaging/consumer.ts": text,
          "apps/api/src/db/idempotency.ts": text,
          "vendor/packages/claim/src/application/submit-claim.ts": text,
          "packages/claim/src/application/submit-claim.tsx": text,
          "packages/claim/src/application/submit-claim.ts.md": text,
        }),
      ),
    ).toEqual([]);
  });

  describe("apps/web の header 名が shared-kernel のものと同じであること", () => {
    const api = "packages/shared-kernel/src/idempotency-http/idempotency-http.ts";
    const web = "apps/web/src/lib/use-idempotent-mutation.ts";
    const declare = (name: string): string => `export const IDEMPOTENCY_KEY_HEADER = "${name}";\n`;
    const mismatch = (webName: string, apiName: string): string =>
      `${web} has IDEMPOTENCY_KEY_HEADER ${JSON.stringify(webName)}, but ${api} has ${JSON.stringify(apiName)}. apps/web does not import shared-kernel, so keep the two the same (docs/adr/0040).`;

    it("同じ名前を通すこと", () => {
      expect(
        violations(repo({ [api]: declare("Idempotency-Key"), [web]: declare("Idempotency-Key") })),
      ).toEqual([]);
    });

    it("別の名前を宣言する web を挙げること", () => {
      expect(
        violations(repo({ [api]: declare("Idempotency-Key"), [web]: declare("X-Key") })),
      ).toEqual([mismatch("X-Key", "Idempotency-Key")]);
    });

    it.each([
      ["no space", 'export const IDEMPOTENCY_KEY_HEADER="Idempotency-Key";\n'],
      ["many spaces", 'export const IDEMPOTENCY_KEY_HEADER   =   "Idempotency-Key";\n'],
    ])("等号の前後に %s のある宣言を読むこと", (_, text) => {
      expect(violations(repo({ [api]: text, [web]: text }))).toEqual([]);
      expect(violations(repo({ [api]: declare("Idempotency-Key"), [web]: text }))).toEqual([]);
    });

    it("宣言のなくなった api を挙げ、どちらにもないときは両方を挙げること", () => {
      expect(
        violations(repo({ [api]: "export {};\n", [web]: declare("Idempotency-Key") })),
      ).toEqual([
        `${web} has IDEMPOTENCY_KEY_HEADER "Idempotency-Key", but ${api} has undefined. apps/web does not import shared-kernel, so keep the two the same (docs/adr/0040).`,
      ]);
      expect(violations(repo({ [api]: "export {};\n", [web]: "export {};\n" }))).toEqual([
        `${web} has IDEMPOTENCY_KEY_HEADER undefined, but ${api} has undefined. apps/web does not import shared-kernel, so keep the two the same (docs/adr/0040).`,
      ]);
    });

    it("宣言のなくなった web を挙げること", () => {
      expect(
        violations(repo({ [api]: declare("Idempotency-Key"), [web]: "export {};\n" })),
      ).toEqual([
        `${web} has IDEMPOTENCY_KEY_HEADER undefined, but ${api} has "Idempotency-Key". apps/web does not import shared-kernel, so keep the two the same (docs/adr/0040).`,
      ]);
    });
  });
});
