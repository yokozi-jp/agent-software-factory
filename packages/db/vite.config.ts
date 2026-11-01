import { defineConfig } from "vite-plus";
import { ownFilesMinimum, recordCoverage } from "../../vitest-coverage.ts";

// The tests of migrate and of the type generation run against a real PostgreSQL. globalSetup starts one container for
// all the tests and runs the migrations on a template database that createTestDatabase copies (docs/adr/0025).
// vitest hides a failure of globalSetup behind `code.charCodeAt is not a function` (see apps/api/vite.config.ts), so
// when the tests fail to start, suspect the container.
export default defineConfig({
  test: {
    // コードがプロセスの TZ に頼っていれば、東京とも本番 (UTC) とも違う夏時間のあるタイムゾーンで見つかる。
    // 効いていることは packages/shared-kernel の src/time.test.ts と apps/api の src/timezone.unit.test.ts が確かめる。
    env: { TZ: "America/New_York" },
    setupFiles: ["./test/temporal.ts"],
    include: ["src/**/*.test.ts"],
    // __fixtures__/ shows that the lint rules are on; it is not a test (docs/adr/0038).
    exclude: ["**/node_modules/**", "**/__fixtures__/**"],
    globalSetup: ["./test/global-setup.ts"],
    hookTimeout: 240_000,
    testTimeout: 60_000,
    // The strength of the tests (#30, docs/tooling/ci.md ("coverage の下限")).
    coverage: {
      ...recordCoverage(),
      // A fixed minimum for every file, as in apps/api (#30). The totals that apps/api ratchets up are not set here.
      thresholds: ownFilesMinimum,
    },
  },
});
