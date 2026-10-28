// Detection-power fixture that packages/ui does not resolve another package of the workspace (docs/adr/0034):
// ui declares no dependency on one, and pnpm puts only the declared ones in its node_modules. If a tsconfig `paths`
// or an alias lets it resolve, the @ts-expect-error is unused (TS2578) and `vp check` fails. Knip skips
// __fixtures__/, and nothing imports this file.

// @ts-expect-error -- fixture: ui does not depend on the app, so the name does not resolve
import "@agent-software-factory/web";
