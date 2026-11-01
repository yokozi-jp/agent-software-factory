import { createApp, type AppDependencies } from "../src/app.ts";
import { runtimeWithoutDatabase } from "../src/runtime.ts";

/** The app of a test whose routes do not use the database: `createApp` with the runtime that has none. */
export const appWithoutDatabase = (dependencies: Omit<AppDependencies, "runtime"> = {}) =>
  createApp({ ...dependencies, runtime: runtimeWithoutDatabase() });
