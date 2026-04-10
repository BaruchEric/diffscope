import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/web"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
  },
  server: {
    open: true,
    proxy: {
      "/api": {
        target: "http://localhost:41111",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
