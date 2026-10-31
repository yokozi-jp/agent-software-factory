// A small repository held in memory for the tests of the rules: the files of passing-repo, changed per case.
import { Tree } from "../tree.ts";
import type { Repo } from "../rules.ts";
import { apiDependencies, passingRepo } from "./passing-repo.ts";

export interface Options {
  // Index modes that differ from the default (100755 for *.sh, 100644 otherwise).
  readonly modes?: Record<string, string>;
  readonly untracked?: Record<string, string>;
  readonly viteHooks?: boolean;
}

// A repository with the files of `base`, changed by `files` (undefined removes a file).
export function repo(files: Record<string, string | undefined> = {}, options: Options = {}): Repo {
  const merged = new Map<string, string>();
  for (const [path, text] of Object.entries({ ...passingRepo, ...files }))
    if (text !== undefined) merged.set(path, text);
  const tracked = new Map(
    [...merged.keys()].map((path) => [
      path,
      options.modes?.[path] ?? (path.endsWith(".sh") ? "100755" : "100644"),
    ]),
  );
  const untracked = Object.entries(options.untracked ?? {});
  for (const [path, text] of untracked) merged.set(path, text);
  return {
    tracked,
    untrackedSteering: untracked.map(([path]) => path),
    viteHooks: options.viteHooks ?? false,
    read: (path) => merged.get(path),
  };
}

export const json = (value: unknown): string => JSON.stringify(value, undefined, 2);

// The package.json of apps/api with `fields`, and the modules it depends on (docs/adr/0026).
export const apiManifest = (fields: Record<string, unknown> = {}): string =>
  json({ dependencies: apiDependencies, ...fields });

// Files that remove every module of the passing repository. A test of the fixtures of the overrides starts from a
// repository with no module.
export const noModules: Record<string, undefined> = {
  "packages/claim/package.json": undefined,
  "packages/approval/package.json": undefined,
  "packages/closing/package.json": undefined,
};

// The failures of these rules alone on a repository, so that a case hears about its own rule only: the files of the
// tree that do not parse, then the failures of the rules in order.
export const failuresOf =
  (...rules: ReadonlyArray<(tree: Tree) => string[]>) =>
  (repository: Repo): string[] => {
    const tree = new Tree(repository);
    const failures = rules.flatMap((rule) => rule(tree));
    return [...tree.parseErrors, ...failures];
  };
