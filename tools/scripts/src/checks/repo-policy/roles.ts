// The role of each package under packages/ (docs/adr/0026): the tag of the dimension `type:` in the nx.tags of its
// package.json. The checks that differ by role (modules.ts, drivers.ts) ask for the role here, so that adding a package
// is giving it a tag and not writing its name in a list. Nx writes the tags in the form `dimension:value`
// (https://nx.dev/docs/features/enforce-module-boundaries), so tags of another dimension (`scope:`) can be added later
// without a change here; only `type:` tags are counted.
import { manifest, packageNames } from "./packages.ts";
import { Tree, list, record } from "./tree.ts";

// The roles of a package. The tag that names a role is `type:` and the role (tagOf):
//   module         a module of the sample feature: the layers, the Effect lint, a place in moduleOrder.
//   fixtures       module-fixtures: the shape of a module, holding the fixtures of the lint rules.
//   shared-kernel  the code the modules share.
//   ui             the shadcn/ui parts that the apps share.
//   driver         a package that wraps an external system or tool: db, hr-system, i18n, logging, telemetry (docs/adr/0054).
export const roles = ["module", "fixtures", "shared-kernel", "ui", "driver"] as const;
export type Role = (typeof roles)[number];

const dimension = "type:";
const addPackageGuide = "docs/domain-model/add-package.md";

export const tagOf = (role: Role): string => `${dimension}${role}`;

// The tags of the dimension `type:` in the package.json at `path`. A tag that is not a string, and tags that are not a
// list, are not tags.
export const typeTagsOf = (tree: Tree, path: string): string[] =>
  list(record(record(tree.parsed(path)).nx).tags).filter(
    (tag): tag is string => typeof tag === "string" && tag.startsWith(dimension),
  );

// The role of a package: the one `type:` tag it has, when that tag names a role. A package with no tag, with two or
// with a tag that names no role has none; packagesHaveOneRole says so.
export function roleOf(tree: Tree, name: string): Role | undefined {
  const [tag, ...others] = typeTagsOf(tree, manifest(name));
  return others.length === 0 ? roles.find((role) => tagOf(role) === tag) : undefined;
}

// The names of the packages that have one of the roles.
export const namesWithRole = (tree: Tree, ...wanted: Role[]): string[] =>
  packageNames(tree).filter((name) => {
    const role = roleOf(tree, name);
    return wanted.some((candidate) => candidate === role);
  });

// Every package under packages/ has exactly one tag of the dimension `type:`, and it names a role. Without the tag a
// package would be in no rule of its role, and nothing else would say so.
export function packagesHaveOneRole(tree: Tree): string[] {
  const allowed = roles.map(tagOf).join(", ");
  return packageNames(tree).flatMap((name) => {
    const path = manifest(name);
    const [tag, ...others] = typeTagsOf(tree, path);
    if (tag === undefined)
      return [
        `${path} has no tag of the dimension type: in nx.tags. A package names its role with exactly one of ${allowed} (docs/adr/0026, ${addPackageGuide}).`,
      ];
    if (others.length > 0)
      return [
        `${path} has the tags ${[tag, ...others].join(", ")} of the dimension type: in nx.tags. A package has exactly one role, one of ${allowed} (docs/adr/0026, ${addPackageGuide}).`,
      ];
    return roleOf(tree, name) === undefined
      ? [
          `${path} has the tag ${tag}, which names no role. A package names its role with exactly one of ${allowed} (docs/adr/0026, ${addPackageGuide}).`,
        ]
      : [];
  });
}
