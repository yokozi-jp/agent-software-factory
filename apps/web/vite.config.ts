import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // The router plugin must come before the React plugin.
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react()],
  server: {
    port: 5173,
    // /api を API (apps/api の既定は 3000 番) へ転送し、ブラウザからは同一オリジンに見せる。
    // 理由は docs/web-api/security.md「CORS」。パスは書き換えない。認証の Issue (#155) が
    // API を /api/* に置くため。今の API は /health だけで、/api 以下の経路はまだない。
    proxy: { "/api": "http://localhost:3000" },
  },
});
