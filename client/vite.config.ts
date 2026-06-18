import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8787";

/** Copy index.html → 404.html so GitHub Pages serves the SPA on refresh. */
function githubPagesSpaFallback() {
  return {
    name: "github-pages-spa-fallback",
    closeBundle() {
      const dist = path.resolve("dist");
      const index = path.join(dist, "index.html");
      if (fs.existsSync(index)) {
        fs.copyFileSync(index, path.join(dist, "404.html"));
      }
    },
  };
}

export default defineConfig({
  base: "/OpenFolio/",
  plugins: [react(), githubPagesSpaFallback()],
  server: {
    port: Number(process.env.VITE_PORT ?? 5000),
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
  preview: {
    port: Number(process.env.VITE_PORT ?? 5000),
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
});
