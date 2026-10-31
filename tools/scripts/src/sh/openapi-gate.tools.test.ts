// The real Spectral and oasdiff pinned in mise.toml, through sh/openapi-lint.sh and sh/openapi-breaking.sh, with the
// ruleset of this repository (.spectral.yaml) on specs changed here in a sandbox repository (Issue #190).
// Each case starts from the spec fixture of the API and breaks one thing, so the gate fails when it stops seeing that thing.
// Reads mise.toml, mise.lock, .mise/locks/ and .spectral.yaml of the workspace, the inputs of the test-tools target
// (tools/scripts/package.json). The spec is a copy of the one that the API generates (test/fixtures/openapi/api.json), not
// apps/api/openapi.json: reading the app would make every API change affect tools/scripts (docs/tooling/ci.md).
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, miseDirs, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const lintScript = join(import.meta.dirname, "../../sh/openapi-lint.sh");
const breakingScript = join(import.meta.dirname, "../../sh/openapi-breaking.sh");
const workspace = join(import.meta.dirname, "../../../..");
const specPath = "apps/api/openapi.json";
const baseSpec = join(import.meta.dirname, "../test/fixtures/openapi/api.json");

// Only the parts of the spec that the cases touch.
interface Operation {
  operationId?: string;
  deprecated?: boolean;
  "x-sunset"?: string;
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
}
interface Schema {
  properties: Record<string, { "x-extensible-enum"?: string[] }>;
  required: string[];
}
interface Spec {
  paths: Record<string, Record<string, Operation>>;
}

let box: Sandbox;
let repo: string;
const git = (...args: string[]): string => gitIn(repo, args).trim();
const env = miseDirs();
const lint = () => runIn(repo, "sh", [lintScript], { env });
const breaking = () => runIn(repo, "sh", [breakingScript, "main"], { env });
const output = (result: { stdout: string; stderr: string }): string =>
  `${result.stdout}\n${result.stderr}`;

// The cases look up what they change and throw when it is missing, so the guard checks only the outer shape.
const isSpec = (value: unknown): value is Spec =>
  typeof value === "object" && value !== null && "paths" in value;
const committed = (): Spec => {
  const spec: unknown = JSON.parse(readFileSync(baseSpec, "utf8"));
  if (!isSpec(spec)) throw new Error("the spec fixture has no paths");
  return spec;
};
const write = (spec: Spec): void => {
  writeFileSync(join(repo, specPath), `${JSON.stringify(spec, null, 2)}\n`);
};
const operation = (spec: Spec, path: string, method: string): Operation => {
  const found = spec.paths[path]?.[method];
  if (found === undefined) throw new Error(`the spec fixture has no ${method} ${path}`);
  return found;
};
// The 200 response of GET /api/me, and the 401 response of the same operation (a Problem Details schema).
const meSchema = (spec: Spec): Schema => {
  const schema = operation(spec, "/api/me", "get").responses["200"]?.content?.["application/json"]
    ?.schema;
  if (schema === undefined) throw new Error("GET /api/me has no 200 schema");
  return schema;
};
const problemSchema = (spec: Spec): Schema => {
  const schema = operation(spec, "/api/me", "get").responses["401"]?.content?.[
    "application/problem+json"
  ]?.schema;
  if (schema === undefined) throw new Error("GET /api/me has no 401 Problem Details schema");
  return schema;
};

// The base: `main` holds `base` as the spec. The working tree starts with the same spec, for the case to change.
const commitBase = (base: Spec): void => {
  write(base);
  git("add", specPath);
  git("commit", "-qm", "base", "--allow-empty");
};

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  for (const file of ["mise.toml", "mise.lock"]) cpSync(join(workspace, file), join(repo, file));
  // `mise exec` installs every missing tool in mise.toml, and Semgrep installs from .mise/locks/.
  cpSync(join(workspace, ".mise/locks"), join(repo, ".mise/locks"), { recursive: true });
  // The ruleset decides which rules run, so the test checks the same rules as the repository.
  mkdirSync(dirname(join(repo, specPath)), { recursive: true });
  cpSync(join(workspace, ".spectral.yaml"), join(repo, ".spectral.yaml"));
  commitBase(committed());
}, 300_000);
afterAll(() => {
  box.remove();
});

describe("openapi-lint.sh with the real Spectral", () => {
  it("passes the spec that the API generates", () => {
    write(committed());
    expect(lint()).toMatchObject({ status: 0 });
  }, 300_000);

  it("fails an operation without operationId", () => {
    const spec = committed();
    delete operation(spec, "/health", "get").operationId;
    write(spec);

    const result = lint();
    expect(result.status).toBe(1);
    expect(output(result)).toContain("operation-operationId");
  }, 300_000);

  it("fails a 4xx response that is not Problem Details", () => {
    const spec = committed();
    const responses = operation(spec, "/api/me", "get").responses;
    const media = responses["401"]?.content?.["application/problem+json"];
    if (media === undefined) throw new Error("GET /api/me has no 401 Problem Details response");
    responses["401"] = { content: { "application/json": media } };
    write(spec);

    const result = lint();
    expect(result.status).toBe(1);
    expect(output(result)).toContain("problem-details-error-response");
  }, 300_000);

  it("fails a 5xx Problem Details response without title", () => {
    const spec = committed();
    const schema = structuredClone(problemSchema(spec));
    delete schema.properties["title"];
    schema.required = schema.required.filter((name) => name !== "title");
    operation(spec, "/health", "get").responses["500"] = {
      content: { "application/problem+json": { schema } },
    };
    write(spec);

    const result = lint();
    expect(result.status).toBe(1);
    expect(output(result)).toContain("problem-details-error-response");
  }, 300_000);
});

describe("openapi-breaking.sh with the real oasdiff", () => {
  // Each case compares the working tree with `main`, so a case that commits a new base puts it back afterwards.
  const resetBase = (): void => {
    git("checkout", "-q", "main", "--", specPath);
    write(committed());
    git("add", specPath);
    git("commit", "-qm", "reset", "--allow-empty");
  };

  it("passes an unchanged spec", () => {
    resetBase();
    expect(breaking()).toMatchObject({ status: 0 });
  }, 300_000);

  it("fails when a property is removed from a response, and says how to go in two steps", () => {
    resetBase();
    const spec = committed();
    const schema = meSchema(spec);
    delete schema.properties["name"];
    schema.required = schema.required.filter((name) => name !== "name");
    write(spec);

    const result = breaking();
    expect(result.status).toBe(1);
    expect(output(result)).toContain("response-required-property-removed");
    expect(result.stderr).toContain("docs/web-api/versioning.md");
  }, 300_000);

  it("fails when an operation is removed that was not deprecated", () => {
    resetBase();
    const spec = committed();
    delete spec.paths["/health"];
    write(spec);

    const result = breaking();
    expect(result.status).toBe(1);
    expect(output(result)).toContain("api-path-removed-without-deprecation");
  }, 300_000);

  it("fails when a deprecated operation is removed before its sunset date", () => {
    resetBase();
    const base = committed();
    Object.assign(operation(base, "/health", "get"), {
      deprecated: true,
      "x-sunset": "2999-01-01",
    });
    commitBase(base);
    const spec = structuredClone(base);
    delete spec.paths["/health"];
    write(spec);

    const result = breaking();
    expect(result.status).toBe(1);
    expect(output(result)).toContain("api-path-removed-before-sunset");
  }, 300_000);

  it("passes when a deprecated operation is removed after its sunset date", () => {
    resetBase();
    const base = committed();
    Object.assign(operation(base, "/health", "get"), {
      deprecated: true,
      "x-sunset": "2020-01-01",
    });
    commitBase(base);
    const spec = structuredClone(base);
    delete spec.paths["/health"];
    write(spec);

    expect(breaking()).toMatchObject({ status: 0 });
  }, 300_000);

  it("passes when a value is added to the x-extensible-enum of the error type", () => {
    resetBase();
    const spec = committed();
    const type = problemSchema(spec).properties["type"];
    if (type?.["x-extensible-enum"] === undefined)
      throw new Error("the error type has no x-extensible-enum");
    type["x-extensible-enum"].push("/problems/added-by-the-test");
    write(spec);

    expect(breaking()).toMatchObject({ status: 0 });
  }, 300_000);
});
