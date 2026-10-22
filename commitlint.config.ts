import type { UserConfig } from "@commitlint/types";

// Conventional Commits.
// - config-nx-scopes: when a scope is given it must be an Nx project name (`api`, `web`, ...).
//   Scope stays optional (config-conventional does not set `scope-empty`).
// - Subject language is not restricted, so Japanese subjects are fine.
const config: UserConfig = {
  extends: ["@commitlint/config-conventional", "@commitlint/config-nx-scopes"],
};

export default config;
