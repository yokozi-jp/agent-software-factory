import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";
import { z } from "zod";

// 境界 2: フェイクのスタブの応答の本文が、OpenAPI の schema に合う。
const operationSchema = z.object({
  parameters: z
    .array(z.object({ name: z.string(), in: z.string(), required: z.boolean() }))
    .default([]),
  responses: z.record(z.string(), z.unknown()),
});
const openapi = z
  .object({
    paths: z.record(z.string(), z.record(z.string(), operationSchema)),
    components: z.object({ schemas: z.object({ Employee: z.record(z.string(), z.unknown()) }) }),
  })
  .parse(parse(readFileSync(fileURLToPath(new URL("../openapi.yaml", import.meta.url)), "utf8")));
const mappingsDirectory = fileURLToPath(new URL("../fake/mappings/", import.meta.url));

const mappingSchema = z.object({
  name: z.string(),
  request: z.object({
    method: z.string(),
    urlPathPattern: z.string(),
    queryParameters: z.record(z.string(), z.unknown()).default({}),
  }),
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
  formats: { email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/ },
});
const validateEmployee = ajv.compile(openapi.components.schemas.Employee);

// OpenAPI の path (`/employees/{employeeNumber}/manager`) を、テナントの接頭辞を付けた正規表現にする。
const operations = Object.entries(openapi.paths).map(([path, methods]) => ({
  pattern: new RegExp(`^/[^/]+${path.replace(/\{[^}]+\}/g, "[^/]+")}$`),
  methods,
}));

describe("人事システムのフェイクのスタブ", () => {
  it("スタブがある", () => {
    expect(mappings.length).toBeGreaterThan(0);
  });

  it.each(mappings.map((mapping) => [mapping.name, mapping] as const))(
    "%s: path、method、query、状態コードが OpenAPI に合い、200 の本文は Employee の schema に合う",
    (_name, mapping) => {
      // urlPathPattern の `[^/]+` (テナント) を固定の値にして、OpenAPI の path の正規表現に当てる。
      const sample = mapping.request.urlPathPattern.replace("[^/]+", "tenant-a");
      const operation = operations.find(({ pattern }) => pattern.test(sample))?.methods[
        mapping.request.method.toLowerCase()
      ];
      expect(operation, "OpenAPI にその path と method の操作がある").toBeDefined();
      expect(Object.keys(operation?.responses ?? {})).toContain(String(mapping.response.status));
      const required = (operation?.parameters ?? [])
        .filter((parameter) => parameter.in === "query" && parameter.required)
        .map((parameter) => parameter.name);
      expect(Object.keys(mapping.request.queryParameters)).toEqual(
        expect.arrayContaining(required),
      );
      // 200 の本文だけ schema に当てる。合わないときは、どこが合わないかを失敗の表示に出す。
      const bodyErrors =
        mapping.response.status === 200 && !validateEmployee(mapping.response.jsonBody)
          ? validateEmployee.errors
          : [];
      expect(bodyErrors).toEqual([]);
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
    expect(
      validateEmployee({
        employeeNumber: "E1",
        email: "not-an-email",
        active: true,
        hasAccountingRole: false,
      }),
    ).toBe(false);
  });
});
