// The packages under packages/ (docs/adr/0026): where the package.json of each is, and their names. The checks of the
// roles (roles.ts), of the modules (modules.ts) and of the lint fixtures (lint-fixtures.ts) all start from them.
import { Tree } from "./tree.ts";

export const manifest = (name: string): string => `packages/${name}/package.json`;

// The names of the packages under packages/, from their package.json. The events package of a module,
// packages/<module>/events/package.json, is not one.
export const packageNames = (tree: Tree): string[] =>
  tree.paths.flatMap((path) => /^packages\/([^/]+)\/package\.json$/.exec(path)?.[1] ?? []);
