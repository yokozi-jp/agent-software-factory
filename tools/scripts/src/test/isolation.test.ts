// Test isolation for the unit project, run by the `test` target (isolation.ts says how).
import { leavesTheRepositoryUntouched } from "./isolation.ts";

leavesTheRepositoryUntouched("unit");
