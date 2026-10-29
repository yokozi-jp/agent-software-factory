import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    setupFiles: ["./test/temporal.ts"],
    // コードがプロセスの TZ に頼っていれば、東京とも本番 (UTC) とも違う夏時間のあるタイムゾーンで見つかる。
    // 効いていることは src/time.test.ts が確かめる (Vitest の既定の pool は forks)。
    env: { TZ: "America/New_York" },
  },
});
