// The checks of the idempotency key of the writers
// (./idempotency.ts), each called alone on a small repository held in memory: a case breaks one file of
// a repository that passes, and expects the message that names the problem.
import { describe, expect, it } from "vite-plus/test";
import { failuresOf, repo } from "./fixtures/repo.ts";
import { headerNamesAgree, writersUseIdempotencyKey } from "./idempotency.ts";

describe("ADR 0040: a writer of a module goes through withIdempotencyKey", () => {
  const violations = failuresOf(writersUseIdempotencyKey, headerNamesAgree);
  const store = "packages/claim/src/application/submit-claim.ts";
  const importing = (names: string): string =>
    `import { ${names} } from "@agent-software-factory/shared-kernel/${names.includes("withIdempotencyKey") ? "idempotency-db" : "tenant-db"}";\nexport {};\n`;
  const failure = (path: string): string =>
    `${path} opens a transaction but does not use withIdempotencyKey. A write of an HTTP request goes through withIdempotencyKey of @agent-software-factory/shared-kernel/idempotency-db; a writer that is not one (a consumer, a batch) says why with a line \`// idempotency-exempt: <reason>\` (docs/adr/0040).`;

  it("passes a file that opens a transaction and uses withIdempotencyKey", () => {
    expect(
      violations(repo({ [store]: importing("inTenantTransaction, withIdempotencyKey") })),
    ).toEqual([]);
  });

  it("names a file that opens a transaction without withIdempotencyKey", () => {
    expect(violations(repo({ [store]: importing("inTenantTransaction") }))).toEqual([
      failure(store),
    ]);
  });

  it("reads an import over several lines, and beginTenantTransaction", () => {
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

  it("does not take a mention in a comment for the use", () => {
    expect(
      violations(repo({ [store]: `// withIdempotencyKey\n${importing("inTenantTransaction")}` })),
    ).toEqual([failure(store)]);
  });

  it("passes a file with a line that says why it is exempt", () => {
    expect(
      violations(
        repo({
          [store]: `// idempotency-exempt: a consumer of the queue, deduplicated by processed_message\n${importing("inTenantTransaction")}`,
        }),
      ),
    ).toEqual([]);
  });

  it("does not take an exemption without a reason", () => {
    expect(
      violations(repo({ [store]: `// idempotency-exempt:\n${importing("inTenantTransaction")}` })),
    ).toEqual([failure(store)]);
  });

  it("passes a file that does not open a transaction", () => {
    expect(violations(repo({ [store]: importing("Database") }))).toEqual([]);
  });

  it("reads only the application and infrastructure layers, without tests and fixtures", () => {
    const text = importing("inTenantTransaction");
    expect(
      violations(
        repo({
          "packages/claim/src/domain/rule.ts": text,
          "packages/claim/src/application/submit-claim.test.ts": text,
          "packages/claim/src/application/__fixtures__/bypass.ts": text,
          "packages/shared-kernel/src/messaging/consumer.ts": text,
          "apps/api/src/db/idempotency.ts": text,
        }),
      ),
    ).toEqual([]);
  });

  describe("the header name of apps/web is the one of shared-kernel", () => {
    const api = "packages/shared-kernel/src/idempotency-http/idempotency-http.ts";
    const web = "apps/web/src/lib/use-idempotent-mutation.ts";
    const declare = (name: string): string => `export const IDEMPOTENCY_KEY_HEADER = "${name}";\n`;
    const mismatch = (webName: string, apiName: string): string =>
      `${web} has IDEMPOTENCY_KEY_HEADER ${JSON.stringify(webName)}, but ${api} has ${JSON.stringify(apiName)}. apps/web does not import shared-kernel, so keep the two the same (docs/adr/0040).`;

    it("passes the same name", () => {
      expect(
        violations(repo({ [api]: declare("Idempotency-Key"), [web]: declare("Idempotency-Key") })),
      ).toEqual([]);
    });

    it("names a web that declares another name", () => {
      expect(
        violations(repo({ [api]: declare("Idempotency-Key"), [web]: declare("X-Key") })),
      ).toEqual([mismatch("X-Key", "Idempotency-Key")]);
    });

    it("names a web whose declaration is gone", () => {
      expect(
        violations(repo({ [api]: declare("Idempotency-Key"), [web]: "export {};\n" })),
      ).toEqual([
        `${web} has IDEMPOTENCY_KEY_HEADER undefined, but ${api} has "Idempotency-Key". apps/web does not import shared-kernel, so keep the two the same (docs/adr/0040).`,
      ]);
    });
  });
});
