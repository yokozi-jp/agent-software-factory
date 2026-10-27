// block-generated-writes: refuse hand edits of generated files, and say how to regenerate them instead.
//   routeTree.gen.ts (apps/web/src/)                     TanStack Router's bundler plugin writes it in dev and build
//   .agents/skills/**, .kiro/skills/**, skills-lock.json  the skills CLI installs them from upstream
//   pnpm-lock.yaml                                        pnpm writes it
//   mise.lock, .mise/locks/**                             `mise lock` writes them (.mise/locks/ holds the
//                                                         dependency graphs of PyPI tools)
//   packages/*/src/infrastructure/db.gen.ts               kysely-codegen writes them from the migrations
// Only the file tools that create, replace, append or delete are checked; reads always pass.
// Tool names and path fields, checked against Kiro 2.33.1 (docs/tooling/git-hooks.md ("生成物への書き込み")),
// and the event's fields again against 2.34.0 (kas/<version>/node_modules/@kiro/agent/dist/server/
// acp-server.js): tool_name is the tool id, tool_input the tool's input. fs_write, str_replace and
// fs_append take `path`; delete_file takes `targetFile`. A relative path is resolved against the event's
// `cwd`, which Kiro sets to the first workspace root, the same root the file tools resolve against.
// Not covered: shell redirects and commands (`>`, `sed -i`, `cp`, `rm`), the `code` tool (format_code,
// rename_symbol), MCP tools, and IDE client tools such as smart_relocate. CI is the last net
// (docs/tooling/git-hooks.md ("生成物への書き込み")).
import { realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

const isDirectory = (path: string): boolean =>
  statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

// The path that <tool> (fs_write, str_replace, fs_append or delete_file) writes, relative to <root> (a
// physical path), or undefined when the input names no path or the file is outside <root> (another
// checkout is not checked). Symlinks in the existing
// directories of the path (.kiro/skills/<name> links to .agents/skills/<name>), `.` and `..` are resolved;
// the components below the deepest existing directory are kept as written.
export function writeTarget(
  tool: string,
  input: unknown,
  cwd: string,
  root: string,
): string | undefined {
  const target: unknown = Reflect.get(
    Object(input),
    tool === "delete_file" ? "targetFile" : "path",
  );
  if (typeof target !== "string" || target === "") return undefined;
  let dir = isAbsolute(target) ? target : `${cwd}/${target}`;
  let rest = "";
  while (!isDirectory(dir)) {
    rest = `/${basename(dir)}${rest}`;
    dir = dirname(dir);
  }
  const rel = relative(root, join(realpathSync(dir), rest));
  return rel === ".." || rel.startsWith("../") || isAbsolute(rel) ? undefined : rel;
}

// [why, how to regenerate] for each kind of generated file.
function regenerate(rel: string): readonly [string, string] | undefined {
  if (rel === "routeTree.gen.ts" || rel.endsWith("/routeTree.gen.ts"))
    return [
      "TanStack Router generates it from the route files.",
      "change the route files under apps/web/src/routes/ and run the build (`pnpm exec nx build web`), then commit the regenerated file.",
    ];
  if (rel === "skills-lock.json" || /^\.(agents|kiro)\/skills(\/|$)/.test(rel))
    return [
      "Agent skills are installed from upstream by the skills CLI and must match skills-lock.json.",
      "run `pnpm dlx skills update` (or `pnpm dlx skills add <source>`), then check with `node tools/scripts/src/checks/skills-lock/cli.ts`.",
    ];
  if (rel === "pnpm-lock.yaml")
    return [
      "pnpm writes it.",
      "change package.json or pnpm-workspace.yaml and run `pnpm install` (or `pnpm add`).",
    ];
  if (rel === "mise.lock" || rel.startsWith(".mise/locks/"))
    return [
      "mise writes it (docs/adr/0009).",
      "change mise.toml and run `mise lock --platform linux-x64`.",
    ];
  if (/^packages\/[^/]+\/src\/infrastructure\/db\.gen\.ts$/.test(rel))
    return [
      "kysely-codegen generates it from the migrations (docs/adr/0025).",
      "change the migrations under apps/api/db/migrations/ and run `pnpm exec nx db-types api`, then commit the regenerated file.",
    ];
  return undefined;
}

// The refusal for <tool> writing <rel> (relative to the repository root), or undefined to allow it.
export function generatedWriteRefusal(tool: string, rel: string): string | undefined {
  const reason = regenerate(rel);
  if (reason === undefined) return undefined;
  const [why, how] = reason;
  return `block-generated-writes: refused ${tool} on ${rel}. ${why} Do not edit it by hand; ${how} If the user really wants a hand edit, they start Kiro with KIRO_ALLOW_GENERATED_WRITE=1.`;
}
