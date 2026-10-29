import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // __fixtures__/ は検査の検出力を確かめるファイルで、実行するテストではない (docs/adr/0026)。
    exclude: ["**/node_modules/**", "**/__fixtures__/**"],
  },
});
