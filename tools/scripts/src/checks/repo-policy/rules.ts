// The rules of repo-policy: mechanical checks for the decisions recorded in docs/adr/.
// Pure functions over a Repo; cli.ts reads git and the files (of the working tree, or of the index) into it.
// This file lists the checks; each lives in a file of its own theme:
//   tooling.ts           tool settings and repository files (Nx, lefthook, betterleaks, Node.js, steering ...)
//   lint-fixtures.ts     fixtures that show a lint rule, a tsconfig flag, a layer or an Effect rule is on
//   ci.ts                CI workflows and the ruleset of main
//   assurance-catalog.ts the assurance catalog and the configs
//   agent-permissions.ts the permission rules of the agents
//   docs-references.ts   references to docs/ from outside docs/, and to the code from docs/
//   modules.ts           the dependencies between the modules, and how each resolves and lints them
// Configuration files are read with parsers (yaml, smol-toml, JSON.parse), so quoting, comments and line
// breaks do not change the values the checks read; steering's fileMatchPattern must still be a one-line array.
// vite.config.ts is read as text: #136 (item 8) decided it needs no parser, since the
// fixtures planned in #43 are to check its lint rules.
import { agentPermissions } from "./agent-permissions.ts";
import { catalogMatchesConfigs } from "./assurance-catalog.ts";
import { ciTargetsHaveCommands, mainNeedsEveryJob, requiredChecksRun } from "./ci.ts";
import { docsCodePaths, docsReferences } from "./docs-references.ts";
import {
  dbDependencies,
  modulesAreRegistered,
  modulesDependOneWay,
  modulesLintEffect,
  noResolutionBypass,
  packageManifests,
} from "./modules.ts";
import {
  bypassGuards,
  withTablesGuards,
  sessionSettingGuards,
  dbBoundaries,
  domainPurity,
  effectBoundaries,
  lintRulesHaveFixtures,
  moduleBoundaries,
  projectTsconfigs,
  tsconfigFlagsHaveFixtures,
} from "./lint-fixtures.ts";
import {
  executableScripts,
  gitOnOtherRepositories,
  lefthookOwnsHooks,
  migrationsGoForward,
  noWorkspaceInCatalog,
  nxRunsTasks,
  oneBetterleaks,
  oneNodeMajor,
  steeringFrontmatter,
  uniqueAdrNumbers,
} from "./tooling.ts";
import { Tree, type Repo } from "./tree.ts";

export type { Repo };

// Every failure: the files that do not parse, then the checks in order.
export function violations(repo: Repo): string[] {
  const tree = new Tree(repo);
  const failures = [
    ...nxRunsTasks(tree),
    ...lefthookOwnsHooks(tree),
    ...oneBetterleaks(tree),
    ...lintRulesHaveFixtures(tree),
    ...tsconfigFlagsHaveFixtures(tree),
    ...projectTsconfigs(tree),
    ...moduleBoundaries(tree),
    ...domainPurity(tree),
    ...effectBoundaries(tree),
    ...dbBoundaries(tree),
    ...bypassGuards(tree),
    ...withTablesGuards(tree),
    ...sessionSettingGuards(tree),
    ...packageManifests(tree),
    ...modulesDependOneWay(tree),
    ...modulesAreRegistered(tree),
    ...dbDependencies(tree),
    ...noResolutionBypass(tree),
    ...modulesLintEffect(tree),
    ...steeringFrontmatter(tree),
    ...gitOnOtherRepositories(tree),
    ...oneNodeMajor(tree),
    ...uniqueAdrNumbers(tree),
    ...migrationsGoForward(tree),
    ...mainNeedsEveryJob(tree),
    ...requiredChecksRun(tree),
    ...catalogMatchesConfigs(tree),
    ...agentPermissions(tree),
    ...executableScripts(tree),
    ...docsReferences(tree),
    ...docsCodePaths(tree),
    ...ciTargetsHaveCommands(tree),
    ...noWorkspaceInCatalog(tree),
  ];
  return [...tree.parseErrors, ...failures];
}
