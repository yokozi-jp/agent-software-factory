// Detection-power fixture (#230) for no-restricted-imports in apps/web/src (root vite.config.ts,
// docs/web-frontend/component-design.md): a file in another directory is imported with `@/`, not `../`. If the
// rule is turned off, or its `files` stop reaching apps/web/src/, the disable comment is unused and `vp check`
// fails (reportUnusedDisableDirectives). Knip skips __fixtures__/, and nothing imports this file.

// oxlint-disable-next-line no-restricted-imports -- fixture: a parent directory is imported with `@/`
import type { Route } from "../routes/login.tsx";

export type IndexRoute = typeof Route;
