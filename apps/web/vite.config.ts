import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // The router plugin must come before the React plugin.
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react()],
  server: {
    port: 5173,
    // 本番は CloudFront が web と /api/* を同じオリジンにまとめる (ADR 0013, ADR 0022)。
    // 開発でも同じ形にするため、/api を API (apps/api の既定は 3000) へ転送する。
    // CloudFront と同じくパスは書き換えない。ブラウザからは同一オリジンに見えるので、
    // CORS の設定は要らず、SameSite=Strict の Cookie も付く。
    proxy: { "/api": "http://localhost:3000" },
  },
});
