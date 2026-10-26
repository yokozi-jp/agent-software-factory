// Test isolation for the tools project, run by the `test-tools` target (isolation.ts says how). The tools
// tests commit a generated token (secret-scan/cli.tools.test.ts) and push it, so this proves that both stay
// in their sandbox when a Git hook runs them. ISOLATION_FILTER (Vitest file filters, separated by spaces)
// limits the child to some of the tools tests: secret-scan.yml runs only the secret-scan ones.
import { leavesTheRepositoryUntouched } from "./isolation.ts";

leavesTheRepositoryUntouched(
  "tools",
  (process.env.ISOLATION_FILTER ?? "").split(" ").filter(Boolean),
);
