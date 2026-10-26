// Vitest setupFiles: runs in every test worker before the test files load (vite.config.ts).
//
// Isolation (docs/tooling/ci.md ("スクリプトのテスト")). Tests also run from Git hooks, where git exports
// GIT_DIR, GIT_INDEX_FILE and the like. Left set, they make every git command a test starts act on the
// repository that runs the hook, whatever its working directory: on 2026-10-23 a test committed into this
// repository and pushed main that way. githooks(5) says to unset them before running git in another
// repository, and the pre-commit framework does the same (`no_git_env`). So this file:
//   1. unsets every repository-local git variable (`git rev-parse --local-env-vars`),
//   2. ignores the user's and the system's git config, and allows only local transports,
//   3. gives git an identity, since there is no user config to read one from.
// sandbox() and gitIn() in sandbox.ts do the rest. isolation.test.ts proves the whole.
import { execFileSync } from "node:child_process";

// --local-env-vars lists the variables only; it does not read a repository, so GIT_DIR cannot misdirect it.
for (const name of execFileSync("git", ["rev-parse", "--local-env-vars"], {
  encoding: "utf8",
}).split("\n")) {
  if (name !== "") delete process.env[name];
}
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  // A push or fetch to a URL fails instead of reaching GitHub.
  GIT_ALLOW_PROTOCOL: "file",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
});
