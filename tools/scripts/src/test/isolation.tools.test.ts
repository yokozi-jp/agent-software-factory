// Test isolation for the tools project, run by the `test-tools` target (isolation.ts says how). The tools
// tests commit a generated token (secret-scan/cli.tools.test.ts) and push it, so this proves that both stay
// in their sandbox when a Git hook runs them.
import { leavesTheRepositoryUntouched } from "./isolation.ts";

leavesTheRepositoryUntouched("tools");
