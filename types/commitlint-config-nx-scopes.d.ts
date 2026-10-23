// @commitlint/config-nx-scopes ships no type declarations. Only the part used by commitlint.config.ts is declared.
declare module "@commitlint/config-nx-scopes" {
  import type { QualifiedRules } from "@commitlint/types";

  const config: {
    utils: {
      getProjects(context?: { cwd?: string }): string[];
    };
    rules: Partial<QualifiedRules>;
  };
  export default config;
}
