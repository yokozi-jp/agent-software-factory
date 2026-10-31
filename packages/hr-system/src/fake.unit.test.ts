import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";
import { z } from "zod";

// 境界 2: フェイクのスタブの応答の本文が、OpenAPI の schema に合う。
const openapi = z
  .object({
    paths: z.record(z.string(), z.unknown()),
    components: z.object({ schemas: z.object({ Employee: z.record(z.string(), z.unknown()) }) }),
  })
  .parse(parse(readFileSync(fileURLToPath(new URL("../openapi.yaml", import.meta.url)), "utf8")));
const mappingsDirectory = fileURLToPath(new URL("../fake/mappings/", import.meta.url));

const mappingSchema = z.object({
  name: z.string(),
  request: z.object({ method: z.string(), urlPathPattern: z.string() }),
  response: z.object({ status: z.number(), jsonBody: z.unknown().optional() }),
});
const mappings = readdirSync(mappingsDirectory)
  .filter((file) => file.endsWith(".json"))
  .map((file) =>
    mappingSchema.parse(JSON.parse(readFileSync(`${mappingsDirectory}${file}`, "utf8"))),
  );

const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  formats: { email: /^[^@\s]+@[^@\s]+$/ },
});
const validateEmployee = ajv.compile(openapi.components.schemas.Employee);

// OpenAPI の path (`/employees/{employeeNumber}/manager`) を、テナントの接頭辞を付けた正規表現にする。
const pathPatterns = Object.keys(openapi.paths).map(
  (path) => new RegExp(`^/[^/]+${path.replace(/\{[^}]+\}/g, "[^/]+")}$`),
);

describe("人事システムのフェイクのスタブ", () => {
  it("スタブがある", () => {
    expect(mappings.length).toBeGreaterThan(0);
  });

  it.each(mappings.map((mapping) => [mapping.name, mapping] as const))(
    "%s: 要求は OpenAPI の path に合い、応答の本文は Employee の schema に合う",
    (_name, mapping) => {
      // urlPathPattern の `[^/]+` (テナント) と、社員番号の固定値を、OpenAPI の path の正規表現に当てる。
      const sample = mapping.request.urlPathPattern.replace("[^/]+", "tenant-a");
      expect(pathPatterns.some((pattern) => pattern.test(sample))).toBe(true);
      expect(mapping.response.status).toBe(200);
      const valid = validateEmployee(mapping.response.jsonBody);
      // 合わないときは、どこが合わないかを失敗の表示に出す。
      expect(valid ? [] : validateEmployee.errors).toEqual([]);
    },
  );

  it("schema に合わない本文を検出できる", () => {
    expect(validateEmployee({ employeeNumber: "E1", email: "a@example.com", active: true })).toBe(
      false,
    );
    expect(
      validateEmployee({
        employeeNumber: "E1",
        email: "a@example.com",
        active: "yes",
        hasAccountingRole: false,
      }),
    ).toBe(false);
  });
});
