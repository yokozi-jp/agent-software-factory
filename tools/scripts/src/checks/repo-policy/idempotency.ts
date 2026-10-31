// Check of the writers of the modules: each goes through withIdempotencyKey (docs/adr/0040, Issue #324).
import { Tree } from "./tree.ts";

// The layers that open a transaction for a write (the use case, and the repository that a use case calls).
const writerFile = /^packages\/[^/]+\/src\/(?:application|infrastructure)\/.+\.ts$/;
const isTestOrFixture = (path: string): boolean =>
  path.endsWith(".test.ts") || path.includes("/__fixtures__/");

// An import of the function, from the package name of shared-kernel. A mention in a comment does not count.
const importsFromSharedKernel = (name: string): RegExp =>
  new RegExp(
    `import\\s*\\{[^}]*\\b(?:${name})\\b[^}]*\\}\\s*from\\s*["']@agent-software-factory/shared-kernel["']`,
  );
const opensTransaction = importsFromSharedKernel("inTenantTransaction|beginTenantTransaction");
const usesIdempotency = importsFromSharedKernel("withIdempotencyKey");
// The way out for a writer that is not an HTTP request (a consumer of a queue, a batch): the line says why.
const exempt = /^\s*\/\/\s*idempotency-exempt:[ \t]*\S/m;

// ADR 0040: every POST and PATCH writes through `withIdempotencyKey`, or a second request with the same key runs the
// business write again. Hono cannot see a forgotten call, so a file of a module that opens a transaction
// (`inTenantTransaction`) has to use `withIdempotencyKey` too, or say why it does not with a line
// `// idempotency-exempt: <reason>`. A file is the unit because the check reads text, not calls: it stops the file
// that never mentions the function, not one that mentions it and forgets a branch. The behaviour of the function
// itself is tested against PostgreSQL (apps/api/src/db/idempotency.test.ts).
export function writersUseIdempotencyKey(tree: Tree): string[] {
  return tree.paths
    .filter((path) => writerFile.test(path) && !isTestOrFixture(path))
    .filter((path) => {
      const text = tree.read(path);
      return opensTransaction.test(text) && !usesIdempotency.test(text) && !exempt.test(text);
    })
    .map(
      (path) =>
        `${path} opens a transaction but does not use withIdempotencyKey. A write of an HTTP request goes through withIdempotencyKey of @agent-software-factory/shared-kernel; a writer that is not one (a consumer, a batch) says why with a line \`// idempotency-exempt: <reason>\` (docs/adr/0040).`,
    );
}
