// The rules of repo-policy: mechanical checks for the decisions recorded in docs/adr/.
// Pure functions over a Repo; cli.ts reads git and the files (of the working tree, or of the index) into it.
// This file lists the checks; each lives in a file of its own theme, and has its cases in <theme>.test.ts:
//   tooling.ts           tool settings and repository files (Nx, lefthook, betterleaks, Node.js, steering ...)
//   lint-fixtures.ts     fixtures that show a lint rule, a tsconfig flag, a layer or an Effect rule is on
//   lint-restrictions.ts the table of lint restrictions (lint-restrictions.json) and its fixtures agree
//   ci.ts                CI workflows and the ruleset of main
//   assurance-catalog.ts the assurance catalog and the configs
//   agent-permissions.ts the permission rules of the agents
//   docs-references.ts   references to docs/ from outside docs/, and to the code from docs/ and from the configs and scripts
//   roles.ts             the role of each package under packages/, from its `type:` tag in nx.tags
//   modules.ts           the dependencies between the modules, and how each resolves and lints them
//   drivers.ts           the layout of the drivers and of the modules: what src/ holds, what an entry file contains
//   ui-stories.ts        a story next to each part of packages/ui
//   coverage.ts          each project with code writes a coverage record for the merged check
//   idempotency.ts       the writers of the modules go through withIdempotencyKey
// Configuration files are read with parsers (yaml, smol-toml, JSON.parse), so quoting, comments and line
// breaks do not change the values the checks read; steering's fileMatchPattern must still be a one-line array.
// vite.config.ts is read as text, for the names of its rules and its layers only (#136, item 8). What it stops, and
// the fixtures that show it, are in lint-restrictions.json, which vite.config.ts imports and the checks parse
// (docs/adr/0050).
import { agentPermissions } from "./agent-permissions.ts";
import { catalogMatchesConfigs } from "./assurance-catalog.ts";
import { ciTargetsHaveCommands, mainNeedsEveryJob, requiredChecksRun } from "./ci.ts";
import { projectsWriteCoverage } from "./coverage.ts";
import { codePathReferences, docsReferences } from "./docs-references.ts";
import {
  driverEntriesOnlyReexport,
  driversAreTagged,
  driversDoNotUseEffect,
  driversAreInLint,
  driversHaveTheirLayout,
} from "./drivers.ts";
import { headerNamesAgree, writersUseIdempotencyKey } from "./idempotency.ts";
import {
  dbDependencies,
  eventsPackages,
  modulesAreRegistered,
  modulesDependOneWay,
  modulesHaveLayers,
  modulesLintEffect,
  noResolutionBypass,
  packageManifests,
} from "./modules.ts";
import {
  domainPurity,
  effectBoundaries,
  lintRulesHaveFixtures,
  moduleBoundaries,
  projectTsconfigs,
  tsconfigFlagsHaveFixtures,
} from "./lint-fixtures.ts";
import { lintRestrictionsAgree } from "./lint-restrictions.ts";
import {
  executableScripts,
  gitOnOtherRepositories,
  lefthookOwnsHooks,
  migrationsGoForward,
  miseLockHasOnlyLinuxX64,
  noWorkspaceInCatalog,
  nxRunsTasks,
  oneBetterleaks,
  oneNodeMajor,
  onePostgresVersion,
  shellScriptsHaveTests,
  steeringFrontmatter,
  uniqueAdrNumbers,
} from "./tooling.ts";
import { packagesHaveOneRole } from "./roles.ts";
import { Tree, type Repo } from "./tree.ts";
import { uiComponentsHaveStories } from "./ui-stories.ts";

export type { Repo };

// Runs every check on the tree: the files that do not parse, then the checks in order.
function run(tree: Tree): string[] {
  const failures = [
    ...nxRunsTasks(tree),
    ...lefthookOwnsHooks(tree),
    ...oneBetterleaks(tree),
    ...miseLockHasOnlyLinuxX64(tree),
    ...lintRulesHaveFixtures(tree),
    ...tsconfigFlagsHaveFixtures(tree),
    ...projectTsconfigs(tree),
    ...moduleBoundaries(tree),
    ...domainPurity(tree),
    ...effectBoundaries(tree),
    ...lintRestrictionsAgree(tree),
    ...packagesHaveOneRole(tree),
    ...packageManifests(tree),
    ...modulesDependOneWay(tree),
    ...eventsPackages(tree),
    ...modulesAreRegistered(tree),
    ...dbDependencies(tree),
    ...noResolutionBypass(tree),
    ...modulesLintEffect(tree),
    ...modulesHaveLayers(tree),
    ...driversAreTagged(tree),
    ...driversHaveTheirLayout(tree),
    ...driverEntriesOnlyReexport(tree),
    ...driversDoNotUseEffect(tree),
    ...driversAreInLint(tree),
    ...steeringFrontmatter(tree),
    ...gitOnOtherRepositories(tree),
    ...oneNodeMajor(tree),
    ...onePostgresVersion(tree),
    ...uniqueAdrNumbers(tree),
    ...migrationsGoForward(tree),
    ...mainNeedsEveryJob(tree),
    ...requiredChecksRun(tree),
    ...catalogMatchesConfigs(tree),
    ...agentPermissions(tree),
    ...executableScripts(tree),
    ...shellScriptsHaveTests(tree),
    ...docsReferences(tree),
    ...codePathReferences(tree),
    ...ciTargetsHaveCommands(tree),
    ...noWorkspaceInCatalog(tree),
    ...uiComponentsHaveStories(tree),
    ...projectsWriteCoverage(tree),
    ...writersUseIdempotencyKey(tree),
    ...headerNamesAgree(tree),
  ];
  return [...tree.parseErrors, ...failures];
}

// Every failure of the repository.
export const violations = (repo: Repo): string[] => run(new Tree(repo));
