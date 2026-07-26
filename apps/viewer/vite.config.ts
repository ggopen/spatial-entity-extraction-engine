import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

// Base path is set at build time via VITE_BASE env var (defaults to "/").
// For GitHub Pages project sites, set VITE_BASE=/repo-name/.
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE ?? "/",
  resolve: {
    alias: {
      "@seee/core": pkg("core"),
      "@seee/geometry": pkg("geometry"),
      "@seee/graph": pkg("graph"),
      "@seee/segmentation": pkg("segmentation"),
      "@seee/entity": pkg("entity"),
      "@seee/topology": pkg("topology"),
      "@seee/scene-graph": pkg("scene-graph"),
      "@seee/workers": pkg("workers"),
      "@seee/sdk": pkg("sdk"),
    },
  },
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: true,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 5173,
    // CORS proxy: the mars3d tileset sends permissive CORS headers, but we
    // expose a passthrough in case a browser blocks cross-origin fetches.
    proxy: {
      "/proxy": {
        target: "https://data.mars3d.cn",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy/, ""),
      },
    },
  },
  // Cesium is loaded from CDN via <script> tags; declare it as external.
  optimizeDeps: {
    exclude: ["cesium"],
  },
}));
