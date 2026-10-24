import nxScopes from "@commitlint/config-nx-scopes";
import { RuleConfigSeverity, type UserConfig } from "@commitlint/types";

// Conventional Commits (docs/repository/commit-conventions.md).
// - Scope is optional (config-conventional does not set `scope-empty`).
// - When a scope is given, it must be an Nx project name (`api`, `web`, ...) or one of the repo areas below.
// - Subject language is not restricted, so Japanese subjects are fine.

// Areas outside the Nx projects. Keep in sync with the list in docs/repository/commit-conventions.md.
const repoScopes = ["docs", "ci", "hooks", "deps"];

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": (ctx) => [
      RuleConfigSeverity.Error,
      "always",
      [...nxScopes.utils.getProjects(ctx), ...repoScopes],
    ],
  },
};

export default config;
