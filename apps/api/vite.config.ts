import devServer from "@hono/vite-dev-server";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [devServer({ entry: "./src/index.ts" })],
  server: { port: 3000 },
  build: {
    // Node server bundle. Dependencies stay external and are resolved from node_modules at runtime.
    ssr: "src/server.ts",
    target: "node24",
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
